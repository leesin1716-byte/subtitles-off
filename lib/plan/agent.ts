// LLM 플래너: AI SDK tool calling 루프로 Qloo 발견·넓히기·최종 선택을 스스로 진행한다

import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { QlooError } from "../qloo/errors";
import { validatePicks, type Pick } from "./compose";
import { discover, widen, WIDEN_LABELS, type PlanContext } from "./tools";
import type { Candidate } from "./types";

export const AGENT_MAX_STEPS = 8;

export const SYSTEM = `You are the planning agent of "Subtitles Off", which builds a four-week language immersion plan from things a learner already loves.
Rules:
- Use the tools. Call discover for tv_show, movie and artist. If a domain returns fewer than 3 candidates, call widen for that domain.
- Then call compose_plan once with 6 to 10 picks: at least 3 shows or films and 2 artists when available. Prefer high affinity, spread the picks across the learner's different favorites, and include at least one easy (tier 1) title for beginners.
- Only use entityId values returned by the tools. Never invent titles.
- reason: one short English sentence (max 20 words) linking the pick to the learner's favorites. Never write text in the target language. Never promise learning outcomes.
- Week order and difficulty are decided by code after you submit; do not describe a schedule.
If compose_plan returns errors, fix them and call it again.`;

export const domainSchema = z.object({ domain: z.enum(["tv_show", "movie", "artist"]) });

function summarize(list: Candidate[]) {
  return [...list]
    .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))
    .slice(0, 12)
    .map((c) => ({
      entityId: c.entityId,
      name: c.name,
      year: c.year,
      tier: c.tier,
      affinity: c.affinity !== undefined ? Number(c.affinity.toFixed(2)) : undefined,
      because: c.because ? `${c.because.seedName} ${Math.round(c.because.score * 100)}%` : undefined,
      genres: c.tags.filter((t) => t.id.includes("genre")).slice(0, 3).map((t) => t.name),
    }));
}

export function buildPrompt(ctx: PlanContext): string {
  const lines = [
    `Target language: ${ctx.profile.label}. Level: ${ctx.input.level}.`,
    ctx.ageBucket ? `Learner age band: ${ctx.ageBucket}.` : "",
    ctx.ratings ? `Content ratings are already limited to: ${ctx.ratings.join(", ")}.` : "",
    ctx.input.family ? "Family mode: the learner is reconnecting with relatives who speak the language." : "",
    `Favorites resolved in Qloo: ${ctx.seeds.map((s) => `${s.name} (${s.subtype.replace("urn:entity:", "")})`).join(", ")}.`,
    ctx.avoidGenres.length ? `Avoid genres: ${ctx.avoidGenres.join(", ")}.` : "",
    ctx.input.refinement ? `The learner asked: "${ctx.input.refinement.replace(/"/g, "'")}"` : "",
    ctx.musicTags.length ? `Music is limited to Qloo tags: ${ctx.musicTags.map((t) => t.name).join(", ")}.` : "No music tags were found for this language, so artists may be empty.",
  ];
  return lines.filter(Boolean).join("\n");
}

export interface LlmResult {
  picks: Pick[] | null;
  steps: number;
  failures: number;
}

/** What the agent's tools have done so far in one plan; the loop stops on any of these. */
export interface AgentState {
  picks: Pick[] | null;
  failures: number;
  fatal: QlooError | null;
  budgetHits: number;
}

export const isAgentDone = (s: AgentState) => s.picks !== null || s.failures >= 2 || s.fatal !== null || s.budgetHits >= 2;

/**
 * The three planning tools, independent of the model provider. Both the AI SDK loop (gateway)
 * and the Claude loop call these, so validation and tracing are the same on either path.
 */
export function createAgentToolbox(ctx: PlanContext) {
  const state: AgentState = { picks: null, failures: 0, fatal: null, budgetHits: 0 };

  const guard = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await fn();
    } catch (e) {
      // Running out of the per-plan call budget is not fatal: the agent (or the rule planner) composes from what it has.
      if (e instanceof QlooError && e.kind === "budget_exceeded") {
        state.budgetHits++;
        ctx.emit({ type: "trace", step: "Qloo call budget reached", detail: "composing from the candidates already found" });
        return { error: "The Qloo call budget for this plan is used up. Call compose_plan now with the candidates you already have." };
      }
      if (e instanceof QlooError && (e.kind === "auth" || e.kind === "rate_limited")) {
        state.fatal = e;
      }
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };

  return {
    state,
    discover: (domain: z.infer<typeof domainSchema>["domain"]) =>
      guard(async () => {
        ctx.emit({ type: "trace", step: `Agent: discover ${domain}` });
        return { candidates: summarize(await discover(ctx, domain)) };
      }),
    widen: (domain: z.infer<typeof domainSchema>["domain"]) =>
      guard(async () => {
        const r = await widen(ctx, domain);
        if (!r) return { message: "Nothing left to widen for this domain." };
        ctx.emit({ type: "trace", step: `Agent: widen ${domain}`, detail: WIDEN_LABELS[r.stage] });
        return { stage: r.stage, candidates: summarize(r.candidates) };
      }),
    compose: (picks: Pick[]) => {
      const v = validatePicks(ctx, picks);
      if (v.ok) {
        state.picks = picks;
        ctx.emit({ type: "trace", step: "Validator: plan accepted", detail: `${picks.length} picks, all Qloo entity ids` });
        return { ok: true as const };
      }
      state.failures++;
      ctx.emit({ type: "trace", step: "Validator: plan rejected", detail: v.errors.join("; ") });
      return { ok: false as const, errors: v.errors };
    },
  };
}

export const TOOL_TEXT = {
  discover:
    "Ask Qloo for taste-matched candidates in one domain for the target language. Returns up to 12 candidates with entityId, affinity, difficulty tier and which favorite drove the match.",
  widen: "Use only when a domain returned fewer than 3 candidates. Relaxes the Qloo query one stage and returns the merged candidates.",
  compose_plan: "Submit the final shortlist of 6 to 10 entity ids with a short English reason each.",
} as const;

export const composeSchema = z.object({
  picks: z.array(z.object({ entityId: z.string(), reason: z.string().optional() })).min(1).max(12),
});

export async function runLlmPlanner(ctx: PlanContext, model: LanguageModel, abortSignal?: AbortSignal): Promise<LlmResult> {
  const box = createAgentToolbox(ctx);
  const { state } = box;

  const tools = {
    discover: tool({ description: TOOL_TEXT.discover, inputSchema: domainSchema, execute: async ({ domain }) => box.discover(domain) }),
    widen: tool({ description: TOOL_TEXT.widen, inputSchema: domainSchema, execute: async ({ domain }) => box.widen(domain) }),
    compose_plan: tool({ description: TOOL_TEXT.compose_plan, inputSchema: composeSchema, execute: async ({ picks }) => box.compose(picks) }),
  };

  const result = await generateText({
    model,
    system: SYSTEM,
    prompt: buildPrompt(ctx),
    tools,
    stopWhen: [
      stepCountIs(AGENT_MAX_STEPS),
      () => isAgentDone(state),
    ],
    maxRetries: 1,
    abortSignal,
  });

  if (state.fatal) throw state.fatal;
  return { picks: state.picks, steps: result.steps.length, failures: state.failures };
}
