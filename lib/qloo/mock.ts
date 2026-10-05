// 키 없이 개발·테스트하기 위한 목업 클라이언트(공식 응답 형태를 따르고 표본 fixture만 돌려준다)

import { assertInsightsParams } from "./params";
import { FIXTURES, TAGS, fixtureToEntity, type Fixture } from "./fixtures";
import type {
  EntityType,
  InsightsResponse,
  QlooClient,
  QlooEntity,
  QlooTagResult,
  QueryParams,
  SearchResponse,
} from "./types";

const list = (v: unknown): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v.map(String) : String(v).split(",").filter(Boolean);

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/** Small deterministic background affinity for pairs without a hand-written link. */
function backgroundLink(a: string, b: string): number {
  let h = 2166136261;
  for (const ch of a + "|" + b) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return 0.02 + ((h >>> 0) % 1000) / 1000 * 0.1;
}

function linkOf(fx: Fixture, seedId: string): number {
  const key = seedId.replace(/^mock-/, "");
  return fx.links?.[key] ?? backgroundLink(fx.id, seedId);
}

export class MockQlooClient implements QlooClient {
  readonly mode = "mock" as const;

  constructor(private readonly fixtures: Fixture[] = FIXTURES) {}

  async search(query: string, types: EntityType[], take = 3): Promise<SearchResponse> {
    const q = norm(query);
    if (!q) return { success: true, duration: 1, results: [] };
    const hits = this.fixtures
      .filter((fx) => types.length === 0 || types.includes(fx.subtype))
      .map((fx) => {
        const n = norm(fx.name);
        const score = n === q ? 3 : n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0;
        return { fx, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.fx.popularity - a.fx.popularity)
      .slice(0, take)
      .map((x) => fixtureToEntity(x.fx));
    return { success: true, duration: 1, results: hits };
  }

  async tags(params: QueryParams): Promise<QlooTagResult[]> {
    const q = norm(String(params["filter.query"] ?? ""));
    const types = list(params["filter.tag.types"]);
    const only = list(params["filter.results.tags"]);
    const take = Number(params.take ?? 20);
    return Object.entries(TAGS)
      .filter(([id]) => only.length === 0 || only.includes(id))
      .filter(([id, name]) => !q || norm(name).includes(q) || norm(id).includes(q))
      .filter(([id]) => types.length === 0 || types.some((t) => id.startsWith(t)))
      .slice(0, take)
      .map(([id, name]) => ({ id, name, types: [id.split(":").slice(0, 4).join(":")] }));
  }

  async insights(params: QueryParams): Promise<InsightsResponse> {
    assertInsightsParams(params);
    const type = String(params["filter.type"]);
    if (type === "urn:tag") return this.tagInsights(params);
    const countries = list(params["filter.release_country"]);
    const ratings = list(params["filter.content_rating"]);
    const mustTags = list(params["filter.tags"]);
    const excludeIds = new Set(list(params["filter.exclude.entities"]));
    const excludeTags = new Set(list(params["filter.exclude.tags"]));
    const onlyIds = list(params["filter.results.entities"]);
    const seeds = list(params["signal.interests.entities"]);
    const signalTags = list(params["signal.interests.tags"]);
    const explain = String(params["feature.explainability"]) === "true";
    const take = Number(params.take ?? 20);

    const pool = this.fixtures.filter((fx) => {
      if (fx.subtype !== type) return false;
      if (onlyIds.length) return onlyIds.includes(fx.id);
      if (fx.seed) return false;
      if (countries.length && !(fx.country ?? []).some((c) => countries.includes(c))) return false;
      if (ratings.length && !(fx.rating && ratings.includes(fx.rating))) return false;
      if (mustTags.length && !fx.tags.some((t) => mustTags.includes(t))) return false;
      if (excludeIds.has(fx.id)) return false;
      if (fx.tags.some((t) => excludeTags.has(t))) return false;
      return true;
    });

    const scored = pool.map((fx) => {
      const contributions = seeds.map((s) => ({ entity_id: s, raw: linkOf(fx, s) }));
      const seedPart = contributions.length
        ? contributions.reduce((a, c) => a + c.raw, 0) / contributions.length
        : 0;
      const tagPart = signalTags.filter((t) => fx.tags.includes(t)).length * 0.15;
      const affinity = Math.min(1, Number((seedPart + tagPart + fx.popularity * 0.05).toFixed(4)));
      const total = contributions.reduce((a, c) => a + c.raw, 0) || 1;
      const entity: QlooEntity = fixtureToEntity(fx);
      entity.query = { affinity };
      if (explain && contributions.length) {
        entity.query.explainability = {
          "signal.interests.entities": contributions
            .map((c) => ({ entity_id: c.entity_id, score: Number((c.raw / total).toFixed(3)) }))
            .filter((c) => c.score >= 0.1)
            .sort((a, b) => b.score - a.score),
        };
      }
      return entity;
    });
    scored.sort((a, b) => (b.query?.affinity ?? 0) - (a.query?.affinity ?? 0));
    return { success: true, results: { entities: scored.slice(0, take) }, duration: 2 };
  }

  /** Taste analysis: tags weighted by how strongly linked fixtures carry them (doc shape: results.tags[].tag_id). */
  private tagInsights(params: QueryParams): InsightsResponse {
    const seeds = list(params["signal.interests.entities"]);
    const types = list(params["filter.tag.types"]);
    const take = Number(params.take ?? 20);
    const weight = new Map<string, number>();
    for (const fx of this.fixtures) {
      const w = fx.seed ? (seeds.includes(fx.id) ? 1 : 0) : seeds.reduce((a, s) => a + (fx.links?.[s.replace(/^mock-/, "")] ?? 0), 0);
      if (w <= 0) continue;
      for (const t of fx.tags) weight.set(t, (weight.get(t) ?? 0) + w);
    }
    const tags = [...weight.entries()]
      .filter(([id]) => types.length === 0 || types.some((t) => id.startsWith(t + ":")))
      .sort((a, b) => b[1] - a[1])
      .slice(0, take)
      .map(([id, w]) => ({
        tag_id: id,
        name: TAGS[id] ?? id,
        types: ["urn:entity:movie", "urn:entity:tv_show"],
        subtype: id.split(":").slice(0, 4).join(":"),
        query: { affinity: Number(Math.min(1, w / 3).toFixed(3)) },
      }));
    return { success: true, results: { tags }, duration: 2 };
  }
}
