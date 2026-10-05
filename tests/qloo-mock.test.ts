// 목업 클라이언트가 공식 응답 형태를 따르고 가짜 ID만 쓰는지 확인하는 테스트
import { describe, expect, it } from "vitest";
import { MockQlooClient } from "@/lib/qloo/mock";
import { extractContributions, parseTags } from "@/lib/qloo/parse";
import { FIXTURES } from "@/lib/qloo/fixtures";

const mock = new MockQlooClient();

describe("MockQlooClient", () => {
  it("returns /search in the documented envelope", async () => {
    const res = await mock.search("Stranger Things", ["urn:entity:tv_show"]);
    expect(res.success).toBe(true);
    expect(Array.isArray(res.results)).toBe(true);
    const e = res.results[0];
    expect(e).toMatchObject({ name: "Stranger Things", type: "urn:entity", subtype: "urn:entity:tv_show" });
    expect(e.entity_id.startsWith("mock-")).toBe(true);
  });

  it("returns several candidates for an ambiguous title", async () => {
    const res = await mock.search("The Office", ["urn:entity:tv_show"]);
    expect(res.results.filter((r) => r.name === "The Office")).toHaveLength(2);
  });

  it("returns /v2/insights as { success, results: { entities } } with affinity and explainability", async () => {
    const res = await mock.insights({
      "filter.type": "urn:entity:tv_show",
      "filter.release_country": ["South Korea"],
      "signal.interests.entities": ["mock-stranger-things", "mock-olivia-rodrigo"],
      "feature.explainability": true,
      take: 5,
    });
    expect(res.success).toBe(true);
    const list = res.results.entities!;
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(5);
    for (const e of list) {
      expect(e.properties?.release_country).toContain("South Korea");
      expect(typeof e.query?.affinity).toBe("number");
      const contrib = extractContributions(e);
      expect(contrib.length).toBeGreaterThan(0);
      for (const c of contrib) expect(c.score).toBeGreaterThanOrEqual(0.1);
    }
    const affinities = list.map((e) => e.query!.affinity!);
    expect([...affinities].sort((a, b) => b - a)).toEqual(affinities);
  });

  it("applies content rating, exclusions and tag filters", async () => {
    const res = await mock.insights({
      "filter.type": "urn:entity:tv_show",
      "filter.release_country": ["South Korea"],
      "filter.content_rating": ["TV-Y7", "TV-PG", "TV-14"],
      "filter.exclude.tags": ["urn:tag:genre:media:thriller"],
      "signal.interests.entities": ["mock-stranger-things"],
    });
    expect(res.results.entities!.length).toBeGreaterThan(0);
    for (const e of res.results.entities!) {
      expect(["TV-Y7", "TV-PG", "TV-14"]).toContain(e.properties?.content_rating);
      expect(e.tags!.map((t) => t.id)).not.toContain("urn:tag:genre:media:thriller");
    }
    const artists = await mock.insights({
      "filter.type": "urn:entity:artist",
      "filter.tags": ["urn:tag:genre:music:k_pop"],
      "signal.interests.entities": ["mock-olivia-rodrigo"],
    });
    expect(artists.results.entities!.length).toBeGreaterThan(0);
    expect(artists.results.entities!.every((e) => e.tags!.some((t) => t.id === "urn:tag:genre:music:k_pop"))).toBe(true);
  });

  it("scores only the requested entities with filter.results.entities", async () => {
    const res = await mock.insights({
      "filter.type": "urn:entity:tv_show",
      "filter.results.entities": ["mock-money-heist", "mock-paquita-salas"],
      "signal.interests.entities": ["mock-the-office-us"],
    });
    expect(res.results.entities!.map((e) => e.entity_id).sort()).toEqual(["mock-money-heist", "mock-paquita-salas"]);
    expect(res.results.entities![0].entity_id).toBe("mock-paquita-salas");
  });

  it("finds language genre tags", async () => {
    const tags = await mock.tags({ "filter.query": "k-pop" });
    expect(tags[0].id).toBe("urn:tag:genre:music:k_pop");
    expect(parseTags({ results: { tags } })).toHaveLength(tags.length);
  });

  it("uses fake ids and no images in every fixture", () => {
    for (const fx of FIXTURES) expect(fx.id).toMatch(/^mock-[a-z0-9-]+$/);
    const ids = FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(FIXTURES)).not.toMatch(/https?:\/\//);
  });
});

describe("extractContributions", () => {
  const base = { name: "x", entity_id: "x", type: "urn:entity" as const, subtype: "urn:entity:movie" };
  it("accepts the plausible shapes and ignores warnings", () => {
    expect(
      extractContributions({
        ...base,
        query: { explainability: { "signal.interests.entities": [{ entity_id: "a", score: 0.2 }, { entity_id: "b", score: 0.7 }] } },
      }),
    ).toEqual([
      { entityId: "b", score: 0.7 },
      { entityId: "a", score: 0.2 },
    ]);
    expect(extractContributions({ ...base, query: { explainability: [{ entity_id: "a", score: 0.5 }] } })).toEqual([
      { entityId: "a", score: 0.5 },
    ]);
    expect(extractContributions({ ...base, query: { explainability: { a: 0.4 } } })).toEqual([{ entityId: "a", score: 0.4 }]);
    expect(extractContributions({ ...base, query: { explainability: { warning: "n/a" } } })).toEqual([]);
    expect(extractContributions(base)).toEqual([]);
  });
});
