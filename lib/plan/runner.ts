// 계획 1건을 끝까지 실행하는 러너: 시드 확인 → 태그 → (LLM 에이전트 또는 규칙) → 검증 → 사다리

import type { LanguageModel } from "ai";
import { BudgetedClient, PLAN_CALL_BUDGET } from "../qloo/budget";
import { QlooError } from "../qloo/errors";
import type { QlooClient } from "../qloo/types";
import { runLlmPlanner, type LlmResult } from "./agent";
import { claudeOffReason, runClaudePlanner, takeClaudeSlot, type ClaudeAgent } from "./claude-agent";
import { allCandidates, assemblePlan, selectByRules } from "./compose";
import {
  createContext,
  discover,
  DOMAINS,
  findAvoidTags,
  findMusicTags,
  findTasteTags,
  resolveFavorites,
  widen,
  WIDEN_LABELS,
  type PlanContext,
} from "./tools";
import type { PlanEvent, PlanInput } from "./types";

export interface RunDeps {
  client: QlooClient;
  model?: LanguageModel;
  modelName?: string;
  /** Claude through the Anthropic API; tried before the gateway model while its key works. */
  claude?: ClaudeAgent;
  emit: (e: PlanEvent) => void;
  abortSignal?: AbortSignal;
  /** Qloo calls allowed for this plan (default PLAN_CALL_BUDGET). */
  callBudget?: number;
  /** Time the LLM agent gets before the rule planner takes over (default LLM_TIMEOUT_MS). */
  llmTimeoutMs?: number;
}

/**
 * Leaves room inside the 60 s function limit for the rule planner after an LLM timeout. Claude Opus 5.5
 * took 2 s to choose the discover calls and 13–16 s to write the final shortlist on live data (10-11).
 */
export const LLM_TIMEOUT_MS = 35_000;

const DOMAIN_LABEL = { tv_show: "TV", movie: "film", artist: "music" } as const;

export async function runPlan(input: PlanInput, deps: RunDeps): Promise<void> {
  const { emit } = deps;
  const client = new BudgetedClient(deps.client, deps.callBudget ?? PLAN_CALL_BUDGET, (call) => emit({ type: "qloo", call }));
  const ctx = createContext(input, client, emit);

  try {
    emit({ type: "trace", step: "Resolving your favorites in Qloo", detail: input.favorites.join(", ") });
    const { seeds, questions, missing } = await resolveFavorites(ctx);
    if (missing.length) emit({ type: "trace", step: "Not found in Qloo", detail: missing.join(", ") });
    if (questions.length) {
      emit({ type: "needs_input", questions });
      return;
    }
    if (!seeds.length) {
      emit({ type: "error", code: "no_seeds", message: "None of those favorites could be found. Try the exact title or artist name." });
      return;
    }
    emit({ type: "trace", step: "Favorites matched", detail: seeds.map((s) => s.name).join(", ") });

    const [music] = await Promise.all([findMusicTags(ctx), findAvoidTags(ctx), findTasteTags(ctx)]);
    if (ctx.tasteTags.length) emit({ type: "trace", step: "Taste analysis: genres Qloo links to your favorites", detail: ctx.tasteTags.join(", ") });
    recordApplied(ctx);
    emit({
      type: "trace",
      step: music.length ? "Music pinned to the language with Qloo tags" : "No music tags found for this language",
      detail: music.map((t) => t.name).join(", ") || undefined,
    });

    let picks = null as Awaited<ReturnType<typeof runLlmPlanner>>["picks"];
    let planner: "llm" | "rules" = "rules";
    let note = "Rule-based planner (no LLM configured).";

    // Claude while its key works and today's cap allows, else the gateway model, else rules only.
    const claude = deps.claude && takeClaudeSlot(deps.claude) ? deps.claude : undefined;
    const agent: { name: string; label: string; run: (signal: AbortSignal) => Promise<LlmResult> } | undefined =
      claude
        ? { name: claude.model, label: `Claude agent (${claude.model})`, run: (signal) => runClaudePlanner(ctx, claude, signal) }
        : deps.model
          ? { name: deps.modelName ?? "LLM", label: "LLM agent", run: (signal) => runLlmPlanner(ctx, deps.model!, signal) }
          : undefined;
    if (deps.claude && !claude) {
      emit({ type: "trace", step: "Claude skipped", detail: claudeOffReason() ? `API refused the key (${claudeOffReason()})` : "daily Claude plan cap reached" });
    }

    if (agent) {
      emit({ type: "trace", step: `Agent planning with ${agent.name}` });
      const llmSignal = AbortSignal.any(
        [deps.abortSignal, AbortSignal.timeout(deps.llmTimeoutMs ?? LLM_TIMEOUT_MS)].filter((s): s is AbortSignal => !!s),
      );
      try {
        const r = await agent.run(llmSignal);
        if (r.picks) {
          picks = r.picks;
          planner = "llm";
          note = `${agent.label} chose ${r.picks.length} items from Qloo results in ${r.steps} steps; code set the weekly order.`;
        } else {
          note = `${agent.label} did not produce a valid plan (${r.failures} rejected); fell back to the rule-based planner.`;
          emit({ type: "trace", step: "Falling back to rules", detail: note });
        }
      } catch (e) {
        if (e instanceof QlooError) throw e;
        if (deps.abortSignal?.aborted) return; // the browser went away
        const timedOut = llmSignal.aborted;
        note = timedOut ? `${agent.label} ran out of time; used the rule-based planner.` : "LLM unavailable; used the rule-based planner.";
        emit({ type: "trace", step: timedOut ? "LLM planner timed out, using rules" : "LLM planner failed, using rules", detail: (e as Error)?.message?.slice(0, 160) });
      }
    }

    if (!picks) {
      await discoverByRules(ctx);
      picks = selectByRules(ctx);
    }
    if (!allCandidates(ctx).length || !picks.length) {
      emit({
        type: "error",
        code: "empty",
        message: `Qloo found nothing in ${ctx.profile.label} for these favorites and filters. Try other favorites or remove an exclusion.`,
      });
      return;
    }
    emit({ type: "trace", step: "Building the four-week ladder", detail: "difficulty from genre rules, easiest first" });
    emit({ type: "plan", plan: { ...assemblePlan(ctx, picks, planner, note), llmConfigured: Boolean(deps.model || deps.claude) } });
  } catch (e) {
    emit(toErrorEvent(e));
  }
}

/** Deterministic path: discover every domain not yet discovered, widen thin ones. */
async function discoverByRules(ctx: PlanContext): Promise<void> {
  const pending = DOMAINS.filter((d) => !ctx.discovered.has(d)).slice(0, Math.max(0, ctx.client.remaining));
  await Promise.all(
    pending.map(async (d) => {
      const list = await discover(ctx, d);
      ctx.emit({ type: "trace", step: `Discovered ${DOMAIN_LABEL[d]}`, detail: `${list.length} candidates` });
    }),
  );
  for (const d of DOMAINS) {
    if (d === "artist" && !ctx.musicTags.length) continue;
    while (ctx.byDomain[d].length < 3 && ctx.client.remaining > 0) {
      const r = await widen(ctx, d);
      if (!r) break;
      ctx.emit({ type: "trace", step: `Widened ${DOMAIN_LABEL[d]}`, detail: `${WIDEN_LABELS[r.stage]} → ${r.candidates.length} candidates` });
    }
    if (ctx.byDomain[d].length < 3 && ctx.client.remaining <= 0) {
      ctx.emit({ type: "trace", step: "Qloo call budget reached", detail: "continuing with what was found" });
      break;
    }
  }
}

function recordApplied(ctx: PlanContext) {
  const a = ctx.applied;
  a.push(`Release country: ${ctx.profile.countries.join(", ")}`);
  if (ctx.ratings) a.push(`Content ratings: ${ctx.ratings.join(", ")}`);
  if (ctx.ageBucket) a.push(`Age signal: ${ctx.ageBucket.replaceAll("_", " ")}`);
  if (ctx.musicTags.length) a.push(`Music tags: ${ctx.musicTags.map((t) => t.name).join(", ")}`);
  if (ctx.avoidGenres.length) {
    a.push(`Avoiding: ${ctx.avoidGenres.join(", ")}${ctx.excludeTagIds.length ? ` (${ctx.excludeTagIds.length} Qloo tags excluded)` : ""}`);
  }
  if (ctx.excludeIds.size || ctx.refinement.seenTitles.length) {
    a.push(`Removed: ${[...ctx.refinement.seenTitles, ...(ctx.excludeIds.size ? [`${ctx.excludeIds.size} titles`] : [])].join(", ")}`);
  }
}

export function toErrorEvent(e: unknown): PlanEvent {
  if (e instanceof QlooError) {
    const messages: Partial<Record<QlooError["kind"], [string, string]>> = {
      auth: ["qloo_auth", "The Qloo API key was rejected. The site owner needs to check the key."],
      rate_limited: ["qloo_rate_limited", "Qloo is rate-limiting us right now. Please try again in a minute."],
      budget_exceeded: ["budget", "This plan needed more Qloo calls than allowed. Try fewer favorites."],
      timeout: ["qloo_timeout", "Qloo took too long to answer. Please try again."],
      unsupported_type: ["qloo_forbidden", "Qloo refused one of the requested content types."],
    };
    const [code, message] = messages[e.kind] ?? ["qloo_error", `Qloo request failed: ${e.message}`];
    return { type: "error", code, message };
  }
  return { type: "error", code: "internal", message: "Something went wrong while building the plan." };
}
