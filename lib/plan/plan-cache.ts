// 계획 결과 캐시: 같은 입력이면 저장된 이벤트를 다시 흘려보내고, 예시 인물 계획은 심사 기간 내내 보관한다

import { PERSONAS } from "./personas";
import type { PlanEvent, PlanInput } from "./types";

/** Matches the Vercel Runtime Cache interface (@vercel/functions getCache), so tests can pass a Map-backed store. */
export interface PlanStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, options?: { ttl?: number; tags?: string[] }): Promise<void>;
}

export interface CachedPlan {
  events: PlanEvent[];
  createdAt: string;
}

/** Ordinary plans: one day. */
export const PLAN_TTL_SEC = 24 * 60 * 60;
/** Example people: long enough to outlast the judging period even if the Qloo key stops working. */
export const PERSONA_TTL_SEC = 45 * 24 * 60 * 60;

const norm = (s: string | undefined) => s?.trim().toLowerCase().replace(/\s+/g, " ") || undefined;

/** Same inputs (ignoring case, spacing and favorite order) give the same key. `scope` separates live/mock and LLM/rules. */
export function planCacheKey(input: PlanInput, scope: string): string {
  const key = {
    l: input.language,
    v: input.level,
    f: input.favorites.map((f) => norm(f)!).sort(),
    a: input.age,
    fam: input.family ? 1 : undefined,
    x: norm(input.avoid),
    r: norm(input.refinement),
    c: input.choices ? Object.entries(input.choices).map(([k, v]) => `${norm(k)}=${v}`).sort() : undefined,
    s: input.excludeIds?.length ? [...input.excludeIds].sort() : undefined,
  };
  // v2: plans carry `ratings` for the compare panel's age-rating row; v1 entries lack it.
  return `plan:v2:${scope}:${JSON.stringify(key)}`;
}

/** An example person's input, including the follow-up run after they answer "which one do you mean?". */
export function isPersonaInput(input: PlanInput): boolean {
  const k = planCacheKey({ ...input, choices: undefined }, "");
  return PERSONAS.some((p) => planCacheKey({ ...p.input, choices: undefined }, "") === k);
}

/** Finished plans and ambiguity questions are kept; anything that ended in an error is not. */
export function isCacheable(events: PlanEvent[]): boolean {
  return events.some((e) => e.type === "plan" || e.type === "needs_input") && !events.some((e) => e.type === "error");
}

export async function readCachedPlan(store: PlanStore, key: string): Promise<CachedPlan | null> {
  try {
    const v = (await store.get(key)) as CachedPlan | null;
    if (!v || !Array.isArray(v.events) || typeof v.createdAt !== "string" || !isCacheable(v.events)) return null;
    return v;
  } catch {
    return null; // a cache outage must never break planning
  }
}

export async function writeCachedPlan(store: PlanStore, key: string, input: PlanInput, events: PlanEvent[], now = new Date()): Promise<boolean> {
  if (!isCacheable(events)) return false;
  try {
    const value: CachedPlan = { events, createdAt: now.toISOString() };
    await store.set(key, value, { ttl: isPersonaInput(input) ? PERSONA_TTL_SEC : PLAN_TTL_SEC, tags: ["plan"] });
    return true;
  } catch {
    return false;
  }
}

/** Events to stream for a cache hit: a trace line first, and the plan marked with its original build time. */
export function replayEvents(cached: CachedPlan): PlanEvent[] {
  return [
    { type: "trace", step: "Served from the plan cache", detail: `built ${cached.createdAt.slice(0, 16).replace("T", " ")} UTC; no new Qloo calls for this view` },
    ...cached.events.map((e) => (e.type === "plan" ? { ...e, plan: { ...e.plan, servedFromCache: cached.createdAt } } : e)),
  ];
}

/** In-memory store for tests and local runs. */
export class MemoryPlanStore implements PlanStore {
  readonly data = new Map<string, unknown>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: unknown) {
    this.data.set(key, value);
  }
}
