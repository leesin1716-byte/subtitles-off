// 에이전트 도구의 실제 동작: 시드 해석, 음악·장르 태그 찾기, 분야별 발견, 결과가 적을 때 넓히기

import type { BudgetedClient } from "../qloo/budget";
import { ageToBucket, type AgeBucket } from "../qloo/params";
import { extractContributions } from "../qloo/parse";
import type { EntityType, QlooEntity, QueryParams } from "../qloo/types";
import { tierOf } from "./ladder";
import { LANGUAGES, ratingsForAge, type LanguageProfile } from "./languages";
import { genresFromAvoid, parseRefinement, type Refinement } from "./refine";
import type { AmbiguityQuestion, Candidate, Domain, PlanEvent, PlanInput, Seed } from "./types";

export const SEARCH_TYPES: EntityType[] = [
  "urn:entity:artist",
  "urn:entity:tv_show",
  "urn:entity:movie",
  "urn:entity:videogame",
  "urn:entity:book",
  "urn:entity:podcast",
];
export const DOMAINS: Domain[] = ["tv_show", "movie", "artist"];
export const MAX_WIDEN_STAGE = 3;
const TAKE = 12;

export interface PlanContext {
  input: PlanInput;
  refinement: Refinement;
  client: BudgetedClient;
  emit: (e: PlanEvent) => void;
  profile: LanguageProfile;
  seeds: Seed[];
  musicTags: { id: string; name: string }[];
  avoidGenres: string[];
  excludeTagIds: string[];
  ratings?: string[];
  ageBucket?: AgeBucket;
  excludeIds: Set<string>;
  byDomain: Record<Domain, Candidate[]>;
  stage: Record<Domain, number>;
  discovered: Set<Domain>;
  applied: string[];
}

export function createContext(input: PlanInput, client: BudgetedClient, emit: (e: PlanEvent) => void): PlanContext {
  const refinement = parseRefinement(input.refinement);
  const age = input.age ?? refinement.age;
  const avoidGenres = [...new Set([...genresFromAvoid(input.avoid), ...refinement.avoidGenres])];
  return {
    input,
    refinement,
    client,
    emit,
    profile: LANGUAGES[input.language],
    seeds: [],
    musicTags: [],
    avoidGenres,
    excludeTagIds: [],
    ratings: ratingsForAge(age, refinement.familySafe),
    ageBucket: age !== undefined ? ageToBucket(age) : undefined,
    excludeIds: new Set(input.excludeIds ?? []),
    byDomain: { tv_show: [], movie: [], artist: [] },
    stage: { tv_show: 0, movie: 0, artist: 0 },
    discovered: new Set(),
    applied: [],
  };
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

function toSeed(query: string, e: QlooEntity): Seed {
  return {
    query,
    entityId: e.entity_id,
    name: e.name,
    subtype: e.subtype,
    year: e.properties?.release_year,
    disambiguation: e.disambiguation,
    tagIds: (e.tags ?? []).map((t) => t.id),
  };
}

/** /search each favorite; ask the person when two results share the exact title. */
export async function resolveFavorites(
  ctx: PlanContext,
): Promise<{ seeds: Seed[]; questions: AmbiguityQuestion[]; missing: string[] }> {
  const seeds: Seed[] = [];
  const questions: AmbiguityQuestion[] = [];
  const missing: string[] = [];
  const results = await Promise.all(
    ctx.input.favorites.map(async (fav) => ({ fav, res: await ctx.client.search(fav, SEARCH_TYPES, 3) })),
  );
  for (const { fav, res } of results) {
    const list = res.results;
    if (!list.length) {
      missing.push(fav);
      continue;
    }
    const chosenId = ctx.input.choices?.[fav];
    const chosen = chosenId ? list.find((e) => e.entity_id === chosenId) : undefined;
    if (chosen) {
      seeds.push(toSeed(fav, chosen));
      continue;
    }
    const exact = list.filter((e) => norm(e.name) === norm(fav));
    if (exact.length >= 2) {
      questions.push({
        favorite: fav,
        options: exact.map((e) => ({
          entityId: e.entity_id,
          name: e.name,
          subtype: e.subtype,
          year: e.properties?.release_year,
          disambiguation: e.disambiguation,
        })),
      });
      continue;
    }
    seeds.push(toSeed(fav, exact[0] ?? list[0]));
  }
  ctx.seeds = seeds;
  return { seeds, questions, missing };
}

const isMusicTag = (t: { id: string; types?: string[] }) =>
  t.id.includes(":music") || (t.types ?? []).some((x) => x.includes("music"));

/** Artists have no country filter in Qloo, so the language is pinned with music genre tags. */
export async function findMusicTags(ctx: PlanContext): Promise<{ id: string; name: string }[]> {
  const lists = await Promise.all(
    ctx.profile.musicTagQueries.slice(0, 2).map((q) => ctx.client.tags({ "filter.query": q, take: 10 })),
  );
  const seen = new Set<string>();
  ctx.musicTags = lists
    .flat()
    .filter(isMusicTag)
    .filter((t) => !seen.has(t.id) && seen.add(t.id))
    .slice(0, 6)
    .map((t) => ({ id: t.id, name: t.name }));
  return ctx.musicTags;
}

/** Looks up Qloo genre tag ids for the genres to avoid (one call), so Qloo can exclude them. */
export async function findAvoidTags(ctx: PlanContext): Promise<string[]> {
  if (!ctx.avoidGenres.length) return [];
  const wanted = new Set(ctx.avoidGenres.map((g) => g.toLowerCase()));
  const tags = await ctx.client.tags({ "filter.tag.types": "urn:tag:genre:media", take: 50 });
  ctx.excludeTagIds = tags.filter((t) => wanted.has(t.name.toLowerCase())).map((t) => t.id);
  return ctx.excludeTagIds;
}

export function buildParams(ctx: PlanContext, domain: Domain, stage: number): QueryParams | null {
  const seedIds = ctx.seeds.map((s) => s.entityId);
  const seedTags = [...new Set(ctx.seeds.flatMap((s) => s.tagIds))].slice(0, 5);
  const useEntities = stage < 2;
  const useTags = stage === 2 && seedTags.length > 0;
  const common: QueryParams = {
    "filter.type": `urn:entity:${domain}`,
    "filter.exclude.entities": [...seedIds, ...ctx.excludeIds],
    "filter.exclude.tags": ctx.excludeTagIds.length ? ctx.excludeTagIds : undefined,
    "signal.interests.entities": useEntities ? seedIds : undefined,
    "signal.interests.tags": useTags ? seedTags : undefined,
    "signal.demographics.age": ctx.ageBucket,
    "feature.explainability": useEntities ? true : undefined,
    take: TAKE,
  };
  if (domain === "artist") {
    if (!ctx.musicTags.length) return null;
    return { ...common, "filter.tags": ctx.musicTags.map((t) => t.id), "operator.filter.tags": "union" };
  }
  const countries = stage >= 1 ? [...ctx.profile.countries, ...ctx.profile.widenCountries] : ctx.profile.countries;
  return { ...common, "filter.release_country": countries, "filter.content_rating": ctx.ratings };
}

export function toCandidate(e: QlooEntity, domain: Domain, seeds: Seed[]): Candidate {
  const top = extractContributions(e)[0];
  const seed = top ? seeds.find((s) => s.entityId === top.entityId) : undefined;
  const tags = (e.tags ?? []).map((t) => ({ id: t.id, name: t.name }));
  return {
    entityId: e.entity_id,
    name: e.name,
    domain,
    year: e.properties?.release_year,
    rating: e.properties?.content_rating,
    imageUrl: e.properties?.image?.url,
    tags,
    affinity: e.query?.affinity,
    because: seed && top ? { seedName: seed.name, score: top.score } : undefined,
    tier: domain === "artist" ? 1 : tierOf(tags.filter((t) => t.id.includes("genre")).map((t) => t.name)),
  };
}

/** Safety net on top of filter.exclude.tags: drop anything whose genre names match an avoided genre. */
function passesLocalFilters(ctx: PlanContext, c: Candidate): boolean {
  if (ctx.excludeIds.has(c.entityId) || ctx.seeds.some((s) => s.entityId === c.entityId)) return false;
  const avoid = ctx.avoidGenres.map((g) => g.toLowerCase());
  if (avoid.length && c.tags.some((t) => avoid.includes(t.name.toLowerCase()))) return false;
  const seen = ctx.refinement.seenTitles.map(norm);
  if (seen.some((s) => s && norm(c.name) === s)) return false;
  return true;
}

async function fetchDomain(ctx: PlanContext, domain: Domain, stage: number): Promise<Candidate[]> {
  const params = buildParams(ctx, domain, stage);
  if (!params) return [];
  const res = await ctx.client.insights(params);
  const fresh = (res.results.entities ?? []).map((e) => toCandidate(e, domain, ctx.seeds)).filter((c) => passesLocalFilters(ctx, c));
  const known = new Set(ctx.byDomain[domain].map((c) => c.entityId));
  ctx.byDomain[domain] = [...ctx.byDomain[domain], ...fresh.filter((c) => !known.has(c.entityId))];
  return ctx.byDomain[domain];
}

export async function discover(ctx: PlanContext, domain: Domain): Promise<Candidate[]> {
  ctx.discovered.add(domain);
  return fetchDomain(ctx, domain, ctx.stage[domain]);
}

/** Next widening stage: 1 wider country set, 2 seed genre tags instead of seed entities, 3 filters only. */
export async function widen(ctx: PlanContext, domain: Domain): Promise<{ stage: number; candidates: Candidate[] } | null> {
  let next = ctx.stage[domain] + 1;
  if (next === 1 && (domain === "artist" || ctx.profile.widenCountries.length === 0)) next = 2;
  if (next === 2 && ctx.seeds.every((s) => s.tagIds.length === 0)) next = 3;
  if (next > MAX_WIDEN_STAGE) return null;
  ctx.stage[domain] = next;
  const candidates = await fetchDomain(ctx, domain, next);
  return { stage: next, candidates };
}

export const WIDEN_LABELS: Record<number, string> = {
  1: "added neighbouring countries for the language",
  2: "switched from your exact favorites to their Qloo genre tags",
  3: "kept only the language and safety filters",
};
