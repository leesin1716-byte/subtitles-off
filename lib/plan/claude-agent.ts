// Claude 실호출 경로: Anthropic SDK 수동 도구 루프로 Qloo 도구를 고르고, 키가 영구 거절되면 이 프로세스에서 끈다

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { ClaudeEffort } from "../config";
import { AGENT_MAX_STEPS, buildPrompt, composeSchema, createAgentToolbox, domainSchema, isAgentDone, SYSTEM, TOOL_TEXT, type LlmResult } from "./agent";
import type { PlanContext } from "./tools";

/** The one SDK method the planner needs, so tests can pass a recorded stand-in. */
export interface ClaudeMessagesApi {
  create(body: MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal; maxRetries?: number }): PromiseLike<BetaMessage>;
}

/** Token usage of one Claude request (one JSON line per request in `CLAUDE_USAGE_LOG`). */
export interface ClaudeUsage {
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number };
  stopReason: string | null;
  ms: number;
  purpose: "plan" | "compare";
}

export interface ClaudeAgent {
  messages: ClaudeMessagesApi;
  model: string;
  effort: ClaudeEffort;
  /** Plans Claude may start per UTC day in this server instance. */
  dailyCap: number;
  onUsage?: (u: ClaudeUsage) => void;
}

const domainProps = {
  type: "object",
  properties: { domain: { type: "string", enum: ["tv_show", "movie", "artist"] } },
  required: ["domain"],
  additionalProperties: false,
} as const;

// strict: Claude's tool input always matches the schema. The validator still checks every id.
export const CLAUDE_TOOLS: BetaToolUnion[] = [
  { name: "discover", description: TOOL_TEXT.discover, input_schema: domainProps, strict: true },
  { name: "widen", description: TOOL_TEXT.widen, input_schema: domainProps, strict: true },
  {
    name: "compose_plan",
    description: TOOL_TEXT.compose_plan,
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        picks: {
          type: "array",
          items: {
            type: "object",
            properties: { entityId: { type: "string" }, reason: { type: "string" } },
            required: ["entityId", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["picks"],
      additionalProperties: false,
    },
  },
];

// Settings Claude Opus 5.5 expects: thinking is always on (adaptive) and effort is the depth control.
// `fallbacks: "default"` lets the API retry a safety-classifier decline on the model Anthropic recommends.
const requestBase = (agent: ClaudeAgent) =>
  ({
    model: agent.model,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: agent.effort },
    fallbacks: "default",
    betas: ["server-side-fallback-2026-07-01"],
    // Caches the tools, system prompt and conversation so far for the next step of the loop.
    cache_control: { type: "ephemeral" },
  }) satisfies Partial<MessageCreateParamsNonStreaming>;

/** Process-wide switch: once the API refuses the key for good, every later plan skips Claude at once. */
const state = { offReason: null as string | null, day: "", plansToday: 0, comparesToday: 0 };

/** The API has also answered a used-up balance with 400 invalid_request_error instead of 402. */
const isCreditBalance400 = (e: unknown) => e instanceof Anthropic.APIError && e.status === 400 && /credit balance/i.test(e.message);

/**
 * 401 bad key, 402 billing (the credit ran out), 403 no access, 404 unknown model, or a 400 about the
 * credit balance: retrying will not help.
 */
export function isPermanentClaudeError(e: unknown): boolean {
  return e instanceof Anthropic.APIError && ([401, 402, 403, 404].includes(e.status as number) || isCreditBalance400(e));
}

export function claudeOffReason(): string | null {
  return state.offReason;
}

/**
 * True when Claude may take this plan (or compare baseline); counts it against the daily cap.
 * Plans and compare baselines have separate counters with the same cap, so neither is unbounded.
 */
export function takeClaudeSlot(agent: ClaudeAgent, now = new Date(), purpose: ClaudeUsage["purpose"] = "plan"): boolean {
  if (state.offReason) return false;
  const day = now.toISOString().slice(0, 10);
  if (state.day !== day) {
    state.day = day;
    state.plansToday = 0;
    state.comparesToday = 0;
  }
  const key = purpose === "plan" ? "plansToday" : "comparesToday";
  if (state[key] >= agent.dailyCap) return false;
  state[key]++;
  return true;
}

/** Tests only. */
export function resetClaudeState() {
  state.offReason = null;
  state.day = "";
  state.plansToday = 0;
  state.comparesToday = 0;
}

async function send(agent: ClaudeAgent, body: MessageCreateParamsNonStreaming, purpose: ClaudeUsage["purpose"], signal?: AbortSignal) {
  const t0 = Date.now();
  let res: BetaMessage;
  try {
    // One SDK retry for 429/5xx; the plan's own time limit (signal) bounds the total wait.
    res = await agent.messages.create(body, { signal, maxRetries: 1 });
  } catch (e) {
    if (isPermanentClaudeError(e)) {
      state.offReason = `HTTP ${(e as InstanceType<typeof Anthropic.APIError>).status}${isCreditBalance400(e) ? " (credit balance)" : ""}`;
      console.warn(`[claude] The API refused the key (${state.offReason}); plans use the next planner from now on.`);
    }
    throw e;
  }
  const u = res.usage;
  const usage: ClaudeUsage = {
    model: res.model,
    usage: {
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    },
    stopReason: res.stop_reason,
    ms: Date.now() - t0,
    purpose,
  };
  agent.onUsage?.(usage);
  return { res, usage };
}

export class ClaudeRefusalError extends Error {}

const describeCall = (b: { name: string; input: unknown }) => {
  const input = b.input as { domain?: string; picks?: unknown[] };
  return input.domain ? `${b.name}(${input.domain})` : input.picks ? `${b.name}(${input.picks.length} picks)` : b.name;
};

/** Manual tool loop: Claude calls discover / widen / compose_plan until the validator accepts a plan. */
export async function runClaudePlanner(ctx: PlanContext, agent: ClaudeAgent, signal?: AbortSignal): Promise<LlmResult> {
  const box = createAgentToolbox(ctx);
  const messages: BetaMessageParam[] = [{ role: "user", content: buildPrompt(ctx) }];
  let steps = 0;

  while (steps < AGENT_MAX_STEPS && !isAgentDone(box.state)) {
    const { res, usage } = await send(agent, { ...requestBase(agent), system: SYSTEM, tools: CLAUDE_TOOLS, messages }, "plan", signal);
    steps++;
    if (res.stop_reason === "refusal") throw new ClaudeRefusalError("Claude declined this request.");
    const calls = res.content.filter((b) => b.type === "tool_use");
    const t = usage.usage;
    ctx.emit({
      type: "trace",
      step: `Claude step ${steps}: ${calls.length ? calls.map(describeCall).join(", ") : "no tool call"}`,
      detail: `${res.model} · ${t.input_tokens + t.cache_read_input_tokens + t.cache_creation_input_tokens} in / ${t.output_tokens} out tokens · ${(usage.ms / 1000).toFixed(1)} s`,
    });
    // Append the whole response unchanged: thinking blocks stay valid only in an append-only history.
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason !== "tool_use" || !calls.length) break;

    // Parallel tool calls run together and go back in a single user message.
    const results = await Promise.all(
      calls.map(async (call): Promise<BetaToolResultBlockParam> => {
        const out = await runTool(box, call.name, call.input);
        return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out.content), ...(out.isError ? { is_error: true } : {}) };
      }),
    );
    messages.push({ role: "user", content: results });
  }

  if (box.state.fatal) throw box.state.fatal;
  return { picks: box.state.picks, steps, failures: box.state.failures };
}

async function runTool(box: ReturnType<typeof createAgentToolbox>, name: string, input: unknown): Promise<{ content: unknown; isError?: boolean }> {
  if (name === "discover" || name === "widen") {
    const p = domainSchema.safeParse(input);
    if (!p.success) return { content: { error: "domain must be tv_show, movie or artist" }, isError: true };
    const out = name === "discover" ? await box.discover(p.data.domain) : await box.widen(p.data.domain);
    return { content: out, isError: "error" in out };
  }
  if (name === "compose_plan") {
    const p = composeSchema.safeParse(input);
    if (!p.success) return { content: { ok: false, errors: ["picks must hold 1 to 12 items with entityId and reason"] }, isError: true };
    return { content: box.compose(p.data.picks) };
  }
  return { content: { error: `Unknown tool ${name}` }, isError: true };
}

const titlesSchema = z.object({ titles: z.array(z.string()) });

/** The compare panel's baseline: the same Claude, asked without Qloo, answering from what it already knows. */
export async function askGenericClaude(agent: ClaudeAgent, prompt: string, signal?: AbortSignal): Promise<string[]> {
  const { res } = await send(
    agent,
    {
      ...requestBase(agent),
      max_tokens: 4000,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: { type: "object", properties: { titles: { type: "array", items: { type: "string" } } }, required: ["titles"], additionalProperties: false },
        },
      },
      messages: [{ role: "user", content: prompt }],
    },
    "compare",
    signal,
  );
  if (res.stop_reason === "refusal") throw new ClaudeRefusalError("Claude declined this request.");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return titlesSchema.parse(JSON.parse(text)).titles.slice(0, 4);
}
