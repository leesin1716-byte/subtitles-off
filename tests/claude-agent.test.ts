// 녹화한 Claude 응답으로 실호출 경로(도구 루프·요청 설정·영구 거절 전환·거절·시간 초과·일일 상한·비교 기준선)를 검증하는 테스트
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { claudeDailyPlanCap, claudeEffort, claudeEnabled, claudeModelId } from "@/lib/config";
import { runHealth } from "@/lib/health";
import { claudeOffReason, resetClaudeState, type ClaudeAgent, type ClaudeMessagesApi, type ClaudeUsage } from "@/lib/plan/claude-agent";
import { runCompare } from "@/lib/plan/compare";
import { runPlan } from "@/lib/plan/runner";
import type { Plan, PlanEvent, PlanInput } from "@/lib/plan/types";
import { MockQlooClient } from "@/lib/qloo/mock";

const MINA: PlanInput = { language: "ko", level: "beginner", favorites: ["Minecraft", "Olivia Rodrigo", "Stranger Things"], age: 15, family: true };
const VALID = [
  { entityId: "mock-reply-1988", reason: "A warm 1980s neighbourhood story, like the friendships in Stranger Things." },
  { entityId: "mock-running-man", reason: "Variety show games for a Minecraft fan." },
  { entityId: "mock-uncanny-counter", reason: "Supernatural team action with a small-town feel." },
  { entityId: "mock-twenty-five-twenty-one", reason: "Coming-of-age drama with a pop soundtrack." },
  { entityId: "mock-newjeans", reason: "Bright pop hooks for an Olivia Rodrigo fan." },
  { entityId: "mock-iu", reason: "Gentle ballads that are easy to sing along to." },
];

let seq = 0;
const usage = { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 800 };
function reply(content: unknown[], stop: string): BetaMessage {
  return { id: `msg_${++seq}`, type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, usage } as unknown as BetaMessage;
}
const toolUse = (name: string, input: unknown) => ({ type: "tool_use", id: `toolu_${++seq}`, name, input });
const thinking = { type: "thinking", thinking: "", signature: "sig-abc" };

/** Replays recorded responses in order and keeps every request body. */
function recorded(responses: (BetaMessage | Error | ((signal?: AbortSignal) => Promise<BetaMessage>))[]) {
  const bodies: MessageCreateParamsNonStreaming[] = [];
  const api: ClaudeMessagesApi = {
    async create(body, options) {
      bodies.push(structuredClone(body));
      const next = responses.shift();
      if (!next) throw new Error("no more recorded responses");
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next(options?.signal) : next;
    },
  };
  return { api, bodies };
}

function agentWith(api: ClaudeMessagesApi, extra: Partial<ClaudeAgent> = {}): ClaudeAgent & { usages: ClaudeUsage[] } {
  const usages: ClaudeUsage[] = [];
  return { messages: api, model: "claude-opus-5-5", effort: "low", dailyCap: 60, onUsage: (u) => usages.push(u), usages, ...extra };
}

async function run(input: PlanInput, deps: { claude?: ClaudeAgent; model?: MockLanguageModelV4; llmTimeoutMs?: number }) {
  const events: PlanEvent[] = [];
  await runPlan(input, { client: new MockQlooClient(), claude: deps.claude, model: deps.model, modelName: "mock-llm", llmTimeoutMs: deps.llmTimeoutMs, emit: (e) => events.push(e) });
  return { events, plan: (events.find((e) => e.type === "plan") as { plan: Plan } | undefined)?.plan };
}

const billing = () => Anthropic.APIError.generate(402, { type: "error", error: { type: "billing_error", message: "credit balance is too low" } }, undefined, new Headers());

beforeEach(() => resetClaudeState());

describe("Claude planner (Anthropic API tool loop)", () => {
  it("lets Claude run parallel discovers, fixes a rejected plan and gets an agent-selected plan", async () => {
    const { api, bodies } = recorded([
      reply([thinking, toolUse("discover", { domain: "tv_show" }), toolUse("discover", { domain: "movie" }), toolUse("discover", { domain: "artist" })], "tool_use"),
      reply([toolUse("compose_plan", { picks: [{ entityId: "mock-made-up-show", reason: "Invented." }, ...VALID] })], "tool_use"),
      reply([toolUse("compose_plan", { picks: VALID })], "tool_use"),
    ]);
    const claude = agentWith(api);
    const { plan, events } = await run(MINA, { claude });

    expect(plan!.planner).toBe("llm");
    expect(plan!.plannerNote).toMatch(/Claude agent \(claude-opus-5-5\) chose 6 items/);
    expect(plan!.llmConfigured).toBe(true);
    expect(new Set(plan!.weeks.flatMap((w) => w.items.map((i) => i.entityId)))).toEqual(new Set(VALID.map((p) => p.entityId)));
    expect(events.some((e) => e.type === "trace" && e.step === "Validator: plan rejected" && /mock-made-up-show/.test(e.detail ?? ""))).toBe(true);
    expect(events.some((e) => e.type === "trace" && /^Claude step 1: discover\(tv_show\), discover\(movie\), discover\(artist\)/.test(e.step))).toBe(true);
    // The loop stops as soon as the validator accepts; usage is reported per request.
    expect(bodies).toHaveLength(3);
    expect(claude.usages.map((u) => u.purpose)).toEqual(["plan", "plan", "plan"]);

    const first = bodies[0];
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.thinking).toEqual({ type: "adaptive" });
    expect(first.output_config).toEqual({ effort: "low" });
    expect(first.fallbacks).toBe("default");
    expect(first.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(first.tool_choice).toBeUndefined(); // forced tool use is a 400 on this model
    expect(first.tools!.every((t) => "strict" in t && t.strict === true)).toBe(true);
    // No personal name reaches the model, only taste signals.
    expect(JSON.stringify(first.messages)).toContain("Stranger Things");
    expect(JSON.stringify(first.messages)).not.toMatch(/Mina/);

    // Append-only: each request starts with the previous one unchanged, thinking block included.
    const second = bodies[1].messages;
    expect(second.slice(0, 1)).toEqual(first.messages);
    expect(second[1]).toEqual({ role: "assistant", content: expect.arrayContaining([thinking]) });
    // All three parallel tool results come back in one user message.
    const results = second[2].content as { type: string; tool_use_id: string }[];
    expect(second[2].role).toBe("user");
    expect(results.map((r) => r.type)).toEqual(["tool_result", "tool_result", "tool_result"]);
    expect(bodies[2].messages.slice(0, 3)).toEqual(second);
  });

  it("switches Claude off for good on a billing error and lets the gateway model take later plans", async () => {
    const { api, bodies } = recorded([billing()]);
    const claude = agentWith(api);
    const first = await run(MINA, { claude });
    expect(first.plan!.planner).toBe("rules");
    expect(first.plan!.plannerNote).toMatch(/LLM unavailable/);
    expect(claudeOffReason()).toBe("HTTP 402");

    const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("gateway down"); } });
    const second = await run(MINA, { claude, model });
    expect(bodies).toHaveLength(1); // Claude was not asked again
    expect(second.events.some((e) => e.type === "trace" && e.step === "Claude skipped" && /HTTP 402/.test(e.detail ?? ""))).toBe(true);
    expect(second.events.some((e) => e.type === "trace" && e.step === "Agent planning with mock-llm")).toBe(true);
    expect(second.plan!.planner).toBe("rules");
  });

  it("keeps Claude on after a passing error (rate limit) but plans that request by rules", async () => {
    const rate = Anthropic.APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, undefined, new Headers());
    const { api } = recorded([rate]);
    const { plan } = await run(MINA, { claude: agentWith(api) });
    expect(plan!.planner).toBe("rules");
    expect(claudeOffReason()).toBeNull();
  });

  it("falls back to rules when Claude declines (refusal stop reason)", async () => {
    const { api } = recorded([reply([], "refusal")]);
    const { plan, events } = await run(MINA, { claude: agentWith(api) });
    expect(plan!.planner).toBe("rules");
    expect(events.some((e) => e.type === "trace" && e.step === "LLM planner failed, using rules" && /declined/.test(e.detail ?? ""))).toBe(true);
  });

  it("falls back to rules when Claude runs past the planner's time limit", async () => {
    const hang = (signal?: AbortSignal) =>
      new Promise<BetaMessage>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));
    const { api } = recorded([hang]);
    const { plan } = await run(MINA, { claude: agentWith(api), llmTimeoutMs: 50 });
    expect(plan!.planner).toBe("rules");
    expect(plan!.plannerNote).toMatch(/Claude agent \(claude-opus-5-5\) ran out of time/);
  });

  it("uses rules when Claude stops without composing a plan", async () => {
    const { api } = recorded([reply([{ type: "text", text: "Here are some ideas." }], "end_turn")]);
    const { plan } = await run(MINA, { claude: agentWith(api) });
    expect(plan!.planner).toBe("rules");
    expect(plan!.plannerNote).toMatch(/did not produce a valid plan/);
  });

  it("stops starting Claude plans past the daily cap", async () => {
    const { api, bodies } = recorded([billing()]);
    const claude = agentWith(api, { dailyCap: 0 });
    const { events, plan } = await run(MINA, { claude });
    expect(bodies).toHaveLength(0);
    expect(plan!.planner).toBe("rules");
    expect(events.some((e) => e.type === "trace" && e.step === "Claude skipped" && /cap/.test(e.detail ?? ""))).toBe(true);
  });
});

describe("compare baseline with Claude", () => {
  const input = {
    language: "ko" as const,
    seeds: [{ entityId: "mock-stranger-things", name: "Stranger Things" }],
    planItems: [{ entityId: "mock-reply-1988", name: "Reply 1988", domain: "tv_show" as const }],
  };

  it("asks the same Claude without Qloo, with structured output, and scores its titles", async () => {
    const { api, bodies } = recorded([reply([{ type: "text", text: JSON.stringify({ titles: ["Squid Game", "Kingdom", "Parasite", "Sweet Home", "Extra"] }) }], "end_turn")]);
    const claude = agentWith(api);
    const r = await runCompare(input, { client: new MockQlooClient(), claude });
    expect(r.baselineSource).toBe("llm");
    expect(r.baseline.map((b) => b.asked ?? b.name)).toHaveLength(4);
    expect(bodies[0].output_config?.format?.type).toBe("json_schema");
    expect(bodies[0].tools).toBeUndefined();
    expect(claude.usages[0].purpose).toBe("compare");
  });

  it("falls back to the canned list when Claude fails and no gateway model is set", async () => {
    const { api } = recorded([new Error("network")]);
    const r = await runCompare(input, { client: new MockQlooClient(), claude: agentWith(api) });
    expect(r.baselineSource).toBe("canned");
  });
});

describe("Claude settings", () => {
  it("reads the key, model, effort and cap from the environment", () => {
    expect(claudeEnabled({})).toBe(false);
    expect(claudeEnabled({ ANTHROPIC_API_KEY: "k" })).toBe(true);
    expect(claudeEnabled({ ANTHROPIC_API_KEY: "k", LLM_MODE: "off" })).toBe(false);
    expect(claudeModelId({})).toBe("claude-opus-5-5");
    expect(claudeEffort({})).toBe("low");
    expect(claudeEffort({ CLAUDE_EFFORT: "medium" })).toBe("medium");
    expect(claudeEffort({ CLAUDE_EFFORT: "max" })).toBe("low");
    expect(claudeDailyPlanCap({})).toBe(60);
    expect(claudeDailyPlanCap({ CLAUDE_DAILY_PLAN_CAP: "0" })).toBe(0);
    expect(claudeDailyPlanCap({ CLAUDE_DAILY_PLAN_CAP: "-3" })).toBe(60);
  });

  it("reports Claude in the health check, including a refused key", async () => {
    const env = { QLOO_MODE: "mock", ANTHROPIC_API_KEY: "k" };
    const deps = { env, deep: false, freshClient: () => ({ ok: false as const, reason: "x" }), planDeps: { getClient: () => ({ ok: false as const, reason: "x" }), getModel: () => undefined, store: { get: async () => null, set: async () => {} } } };
    expect((await runHealth(deps)).claude).toBe("configured");
    expect((await runHealth({ ...deps, env: { QLOO_MODE: "mock" } })).claude).toBe("off");
    const { api } = recorded([billing()]);
    await run(MINA, { claude: agentWith(api) });
    expect((await runHealth(deps)).claude).toBe("refused: HTTP 402");
  });
});
