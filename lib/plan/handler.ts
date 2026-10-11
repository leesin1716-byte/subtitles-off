// /api/plan 요청 처리(설정 확인·입력 검증·캐시 재생·IP 한도·NDJSON 스트리밍)와 예시 계획 예열을 묶은 테스트 가능한 핸들러

import type { LanguageModel } from "ai";
import type { QlooClient } from "../qloo/types";
import type { ClaudeAgent } from "./claude-agent";
import type { RateLimiter } from "../ratelimit";
import { clientIp } from "../ratelimit";
import { PERSONAS } from "./personas";
import { planCacheKey, readCachedPlan, replayEvents, writeCachedPlan, type PlanStore } from "./plan-cache";
import { runPlan } from "./runner";
import { planInputSchema, type PlanEvent, type PlanInput } from "./types";

export interface PlanDeps {
  getClient: () => { ok: true; client: QlooClient } | { ok: false; reason: string };
  getModel: () => { model: LanguageModel; name: string } | undefined;
  getClaude?: () => ClaudeAgent | undefined;
  store: PlanStore;
}

export interface PlanHandlerDeps extends PlanDeps {
  limiter: RateLimiter;
}

const scopeOf = (client: QlooClient, llm: unknown) => `${client.mode}:${llm ? "llm" : "rules"}`;

/** Friendly 400 text instead of raw validation output. */
export function describeInputError(paths: string[]): string {
  if (paths.some((p) => p.startsWith("excludeIds"))) return "Too many titles have been removed from this plan. Start a fresh plan to continue.";
  if (paths.some((p) => p.startsWith("favorites"))) return "Add two to five favorites, each under 80 characters.";
  if (paths.some((p) => p.startsWith("refinement") || p.startsWith("avoid"))) return "That request is too long. Keep it under 300 characters.";
  if (paths.some((p) => p.startsWith("age"))) return "Age must be a whole number between 5 and 110.";
  return "Some of the plan settings were not valid. Please check them and try again.";
}

/** Runs one plan, forwarding every event, and stores the finished plan in the cache. */
export async function buildPlan(
  input: PlanInput,
  deps: {
    client: QlooClient;
    llm?: { model: LanguageModel; name: string };
    claude?: ClaudeAgent;
    store: PlanStore;
    emit?: (e: PlanEvent) => void;
    abortSignal?: AbortSignal;
  },
): Promise<PlanEvent[]> {
  const events: PlanEvent[] = [];
  await runPlan(input, {
    client: deps.client,
    model: deps.llm?.model,
    modelName: deps.llm?.name,
    claude: deps.claude,
    abortSignal: deps.abortSignal,
    emit: (e) => {
      events.push(e);
      deps.emit?.(e);
    },
  });
  await writeCachedPlan(deps.store, planCacheKey(input, scopeOf(deps.client, deps.llm ?? deps.claude)), input, events);
  return events;
}

function ndjson(produce: (emit: (e: PlanEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: PlanEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await produce(emit);
      } catch {
        emit({ type: "error", code: "internal", message: "Something went wrong while building the plan." });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

export async function handlePlanRequest(request: Request, deps: PlanHandlerDeps): Promise<Response> {
  const qloo = deps.getClient();
  if (!qloo.ok) return Response.json({ code: "config", message: qloo.reason }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "bad_request", message: "Body must be JSON." }, { status: 400 });
  }
  const parsed = planInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ code: "bad_request", message: describeInputError(parsed.error.issues.map((i) => i.path.join("."))) }, { status: 400 });
  }

  const llm = deps.getModel();
  const claude = deps.getClaude?.();
  const cached = await readCachedPlan(deps.store, planCacheKey(parsed.data, scopeOf(qloo.client, llm ?? claude)));
  // Cache hits cost no Qloo or LLM calls, so they do not count against the per-IP limit.
  if (cached) return ndjson(async (emit) => replayEvents(cached).forEach(emit));

  const rate = deps.limiter.check(clientIp(request.headers));
  if (!rate.allowed) {
    return Response.json(
      { code: "rate_limited", message: `Too many new plans from this connection. Try again in ${rate.retryAfterSec}s, or open one of the examples.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  return ndjson(async (emit) => {
    await buildPlan(parsed.data, { client: qloo.client, llm, claude, store: deps.store, emit, abortSignal: request.signal });
  });
}

export type WarmStatus = "cached" | "built" | `failed: ${string}`;

/** Makes sure the three example plans are in the cache (used by the daily health cron). */
export async function warmPersonaPlans(deps: PlanDeps): Promise<Record<string, WarmStatus>> {
  const qloo = deps.getClient();
  if (!qloo.ok) return Object.fromEntries(PERSONAS.map((p) => [p.id, `failed: config` as WarmStatus]));
  const llm = deps.getModel();
  const claude = deps.getClaude?.();
  const entries = await Promise.all(
    PERSONAS.map(async (p): Promise<[string, WarmStatus]> => {
      let input: PlanInput = p.input;
      let status: WarmStatus = "cached";
      // Two rounds: an example with an ambiguous favorite (Sam's "The Office") is warmed with Qloo's first match too.
      for (let round = 0; round < 2; round++) {
        const hit = await readCachedPlan(deps.store, planCacheKey(input, scopeOf(qloo.client, llm ?? claude)));
        const events = hit?.events ?? (await buildPlan(input, { client: qloo.client, llm, claude, store: deps.store }));
        if (!hit) status = "built";
        const err = events.find((e) => e.type === "error");
        if (err && err.type === "error") return [p.id, `failed: ${err.code}`];
        const q = events.find((e) => e.type === "needs_input");
        if (!q || q.type !== "needs_input") return [p.id, events.some((e) => e.type === "plan") ? status : "failed: no plan"];
        input = { ...input, choices: { ...input.choices, ...Object.fromEntries(q.questions.map((x) => [x.favorite, x.options[0].entityId])) } };
      }
      return [p.id, "failed: no plan"];
    }),
  );
  return Object.fromEntries(entries);
}
