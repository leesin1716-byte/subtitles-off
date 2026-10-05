// LLM이 고른 목록을 Qloo ID 화이트리스트로 검증하고, 규칙 기반 선택과 최종 계획 조립을 맡는다

import { buildLadder } from "./ladder";
import type { PlanContext } from "./tools";
import type { Candidate, Plan } from "./types";

export interface Pick {
  entityId: string;
  reason?: string;
}

// Hangul, Kana and CJK ideographs: the planner must not write target-language text.
const NON_ENGLISH_SCRIPT = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯]/;

export function allCandidates(ctx: PlanContext): Candidate[] {
  return [...ctx.byDomain.tv_show, ...ctx.byDomain.movie, ...ctx.byDomain.artist];
}

/** Every pick must be an entity id Qloo returned in this run. */
export function validatePicks(ctx: PlanContext, picks: Pick[]): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const registry = new Map(allCandidates(ctx).map((c) => [c.entityId, c]));
  const seen = new Set<string>();
  for (const p of picks) {
    if (!registry.has(p.entityId)) errors.push(`${p.entityId} was not returned by Qloo in this run`);
    if (seen.has(p.entityId)) errors.push(`${p.entityId} is listed twice`);
    seen.add(p.entityId);
    if (p.reason && p.reason.length > 160) errors.push(`reason for ${p.entityId} is longer than 160 characters`);
    if (p.reason && NON_ENGLISH_SCRIPT.test(p.reason)) errors.push(`reason for ${p.entityId} must be in English only`);
  }
  const chosen = picks.map((p) => registry.get(p.entityId)).filter(Boolean) as Candidate[];
  const screenAvailable = ctx.byDomain.tv_show.length + ctx.byDomain.movie.length;
  const screenChosen = chosen.filter((c) => c.domain !== "artist").length;
  if (screenChosen < Math.min(3, screenAvailable)) errors.push(`pick at least ${Math.min(3, screenAvailable)} shows or films`);
  if (ctx.byDomain.artist.length > 0 && !chosen.some((c) => c.domain === "artist")) errors.push("pick at least one artist");
  if (picks.length > 12) errors.push("pick at most 12 items");
  return { ok: errors.length === 0, errors };
}

/** Rule-based shortlist: best Qloo affinity first, keeping one easy title for beginners. */
export function selectByRules(ctx: PlanContext): Pick[] {
  const byAffinity = (a: Candidate, b: Candidate) => (b.affinity ?? 0) - (a.affinity ?? 0);
  const screen = [...ctx.byDomain.tv_show, ...ctx.byDomain.movie].sort(byAffinity);
  let shortlist = screen.slice(0, 8);
  if (ctx.input.level === "beginner" && !shortlist.some((c) => c.tier === 1)) {
    const easy = screen.find((c) => c.tier === 1);
    if (easy) shortlist = [...shortlist.slice(0, 7), easy];
  }
  const artists = [...ctx.byDomain.artist].sort(byAffinity).slice(0, 4);
  return [...shortlist, ...artists].map((c) => ({ entityId: c.entityId }));
}

export function assemblePlan(ctx: PlanContext, picks: Pick[], planner: Plan["planner"], plannerNote: string): Plan {
  const registry = new Map(allCandidates(ctx).map((c) => [c.entityId, c]));
  const chosen = picks.map((p) => registry.get(p.entityId)).filter(Boolean) as Candidate[];
  const notes = Object.fromEntries(picks.filter((p) => p.reason).map((p) => [p.entityId, p.reason!]));
  const weeks = buildLadder(
    chosen.filter((c) => c.domain !== "artist"),
    chosen.filter((c) => c.domain === "artist"),
    {
      level: ctx.input.level,
      family: ctx.input.family,
      musicPerWeek: ctx.refinement.moreMusic ? 2 : 1,
      notes,
    },
  );
  return {
    language: ctx.input.language,
    languageLabel: ctx.profile.label,
    level: ctx.input.level,
    seeds: ctx.seeds,
    weeks,
    planner,
    plannerNote,
    mode: ctx.client.mode,
    calls: ctx.client.calls,
    applied: ctx.applied,
  };
}
