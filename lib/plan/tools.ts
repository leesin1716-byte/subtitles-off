// 에이전트 도구의 실제 동작: 시드 해석, 음악·장르 태그 찾기, 분야별 발견, 결과가 적을 때 넓히기

import type { BudgetedClient } from "../qloo/budget";
import { ageToBucket, type AgeBucket } from "../qloo/params";
import { QlooError } from "../qloo/errors";
import { extractContributions, parseTags } from "../qloo/parse";
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
/**
 * Films and shows are fetched wider, then kept only when their first release country is a target
 * country. `filter.release_country` matches any country an entity was released in: on 10-11 a
 * Japanese plan got Luca and Onward (["United States","Japan"]) and a Korean one Hotel Transylvania 3.
 * In the first 30 Korean film results 16 listed South Korea first; Spanish films only 5 of 30.
 */
const SCREEN_TAKE = 30;

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
  tasteTags: string[];
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
    tasteTags: [],
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
    tagIds: usableTags(e).map((t) => t.id),
  };
}

/**
 * Popularity lead that settles a same-title tie without asking. Qloo `popularity` is a 0–1
 * percentile, so 0.07 means the top match outranks the other by 7% of the catalogue.
 * Live /search on 10-11: Minecraft game 0.966 vs a 2020 TV entry with no popularity, Stranger
 * Things 2016 0.9999 vs 2010 0.573, Breaking Bad show 0.9999 vs a band 0.896 (lead 0.104) all clear it;
 * The Office US 0.998 vs UK 0.975 (0.023) and Avatar 2005 0.996 vs 2024 0.964 (0.033) do not,
 * and those are real either/or choices, so the person is still asked.
 */
export const POPULARITY_LEAD = 0.07;

/** The clear favourite among same-title results, or undefined when it is a real either/or. */
export function clearLeader(sameTitle: QlooEntity[]): QlooEntity | undefined {
  const [top, next] = [...sameTitle].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  if (!next) return top;
  return (top.popularity ?? 0) - (next.popularity ?? 0) >= POPULARITY_LEAD ? top : undefined;
}

/**
 * /search each favorite. A pinned choice wins; among results that share the exact title the clear
 * popularity leader is taken; only a close call becomes a question (options most popular first).
 */
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
    const leader = exact.length >= 2 ? clearLeader(exact) : undefined;
    if (leader) {
      seeds.push(toSeed(fav, leader));
      continue;
    }
    if (exact.length >= 2) {
      questions.push({
        favorite: fav,
        options: [...exact].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).map((e) => ({
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

/**
 * Music genre tags. The docs show tag ids like `urn:tag:genre:media:horror` and, on tag results,
 * `subtype` = tag type and `types` = entity types the tag applies to. Accept any of those signals so
 * one wrong guess about the id format does not silently drop every artist.
 */
export const isMusicTag = (t: { id: string; types?: string[]; subtype?: string }) =>
  t.id.includes(":music") ||
  (t.subtype ?? "").includes("music") ||
  (t.types ?? []).some((x) => x.includes("music") || x === "urn:entity:artist");

/** Artists have no country filter in Qloo, so the language is pinned with music genre tags. */
export async function findMusicTags(ctx: PlanContext): Promise<{ id: string; name: string }[]> {
  const lists = await Promise.all(
    ctx.profile.musicTagQueries.slice(0, 2).map((q) => ctx.client.tags({ "filter.query": q, take: 10 })),
  );
  const seen = new Set<string>();
  ctx.musicTags = lists
    .flat()
    .filter(isMusicTag)
    .filter((t) => ctx.profile.musicTagName.test(t.name))
    .filter((t) => !seen.has(t.id) && seen.add(t.id))
    .slice(0, 6)
    .map((t) => ({ id: t.id, name: t.name }));
  return ctx.musicTags;
}

/** Documented id format for media genre tags, e.g. "Science Fiction" → urn:tag:genre:media:science_fiction. */
export const genreTagId = (name: string) => `urn:tag:genre:media:${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

/**
 * Genre tags to exclude. Ids are built from the documented format, then confirmed with one
 * /v2/tags call (filter.results.tags). Confirmed ids win; if the check finds none (or fails),
 * the built ids are sent anyway, and the local filter also drops any result carrying them.
 */
export async function findAvoidTags(ctx: PlanContext): Promise<string[]> {
  if (!ctx.avoidGenres.length) return [];
  const built = ctx.avoidGenres.map(genreTagId);
  const wanted = new Set(ctx.avoidGenres.map((g) => g.toLowerCase()));
  let confirmed: string[] = [];
  try {
    const tags = await ctx.client.tags({ "filter.results.tags": built, take: built.length });
    confirmed = tags.filter((t) => built.includes(t.id) || wanted.has(t.name.toLowerCase())).map((t) => t.id);
  } catch (e) {
    if (e instanceof QlooError && (e.kind === "auth" || e.kind === "rate_limited" || e.kind === "budget_exceeded")) throw e;
  }
  ctx.excludeTagIds = confirmed.length ? [...new Set(confirmed)] : built;
  ctx.emit({
    type: "trace",
    step: "Genres to avoid mapped to Qloo tags",
    detail: confirmed.length ? `${confirmed.length} of ${built.length} confirmed by Qloo` : "not confirmed by Qloo; using the documented ids",
  });
  return ctx.excludeTagIds;
}

/**
 * Taste analysis (Insights with filter.type=urn:tag): the genre tags Qloo associates with the
 * favorites. Shown on the plan as "your taste, as Qloo sees it". Never fatal.
 */
export async function findTasteTags(ctx: PlanContext): Promise<string[]> {
  if (!ctx.seeds.length) return [];
  try {
    const res = await ctx.client.insights({
      "filter.type": "urn:tag",
      "filter.tag.types": "urn:tag:genre:media",
      "signal.interests.entities": ctx.seeds.map((s) => s.entityId),
      take: 6,
    });
    ctx.tasteTags = parseTags(res).map((t) => t.name).filter(Boolean).slice(0, 5);
  } catch (e) {
    if (e instanceof QlooError && (e.kind === "auth" || e.kind === "rate_limited")) throw e;
    ctx.tasteTags = [];
  }
  return ctx.tasteTags;
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
    take: domain === "artist" ? TAKE : SCREEN_TAKE,
  };
  if (domain === "artist") {
    if (!ctx.musicTags.length) return null;
    return { ...common, "filter.tags": ctx.musicTags.map((t) => t.id), "operator.filter.tags": "union" };
  }
  return { ...common, "filter.release_country": targetCountries(ctx, stage), "filter.content_rating": ctx.ratings };
}

const targetCountries = (ctx: PlanContext, stage: number) =>
  stage >= 1 ? [...ctx.profile.countries, ...ctx.profile.widenCountries] : ctx.profile.countries;

/** First listed release country (Insights gives an array; /search has shown a plain string). */
export function firstCountry(e: QlooEntity): string | undefined {
  return releaseCountries(e)[0];
}

/** Release countries as a list: Insights sends an array, live /search a single string (10-11). */
export function releaseCountries(e: QlooEntity): string[] {
  const rc: unknown = e.properties?.release_country;
  if (Array.isArray(rc)) return rc.filter((c): c is string => typeof c === "string");
  return typeof rc === "string" ? rc.split(",").map((c) => c.trim()).filter(Boolean) : [];
}

/** Entity tags with an id and a name. Live artists also carry bare `{ type: "urn:tag:voice_type:qloo" }` entries (10-11). */
function usableTags(e: QlooEntity): { id: string; name: string }[] {
  return (e.tags ?? []).flatMap((t) => (typeof t?.id === "string" && typeof t?.name === "string" ? [{ id: t.id, name: t.name }] : []));
}

/**
 * Keeps titles whose first release country is a target (unknown country counts as a match), up to
 * TAKE. If fewer than 3 qualify, the Qloo order is kept as it was so a thin language still gets a plan.
 */
export function preferHomeCountry(entities: QlooEntity[], countries: string[]): QlooEntity[] {
  const home = entities.filter((e) => {
    const c = firstCountry(e);
    return c === undefined || countries.includes(c);
  });
  return (home.length >= 3 ? home : entities).slice(0, TAKE);
}

export function toCandidate(e: QlooEntity, domain: Domain, seeds: Seed[]): Candidate {
  const top = extractContributions(e)[0];
  const seed = top ? seeds.find((s) => s.entityId === top.entityId) : undefined;
  const tags = usableTags(e);
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
  const avoidIds = new Set([...ctx.excludeTagIds, ...ctx.avoidGenres.map(genreTagId)]);
  if (avoid.length && c.tags.some((t) => avoid.includes(t.name.toLowerCase()) || avoidIds.has(t.id))) return false;
  const seen = ctx.refinement.seenTitles.map(norm);
  if (seen.some((s) => s && norm(c.name) === s)) return false;
  return true;
}

async function fetchDomain(ctx: PlanContext, domain: Domain, stage: number): Promise<Candidate[]> {
  const params = buildParams(ctx, domain, stage);
  if (!params) return [];
  const res = await ctx.client.insights(params);
  const entities = res.results.entities ?? [];
  const fresh = (domain === "artist" ? entities : preferHomeCountry(entities, targetCountries(ctx, stage))).map((e) => toCandidate(e, domain, ctx.seeds)).filter((c) => passesLocalFilters(ctx, c));
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
