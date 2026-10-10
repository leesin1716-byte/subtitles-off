// 동명 시드 자동 확정 규칙(인기도 차)·예시 인물 ID 고정·/search types 정규화를 검증하는 테스트
import { describe, expect, it, vi } from "vitest";
import { BudgetedClient } from "@/lib/qloo/budget";
import { HttpQlooClient } from "@/lib/qloo/http";
import { MockQlooClient } from "@/lib/qloo/mock";
import { clearLeader, createContext, POPULARITY_LEAD, resolveFavorites } from "@/lib/plan/tools";
import { PERSONAS } from "@/lib/plan/personas";
import type { PlanInput } from "@/lib/plan/types";
import type { QlooClient, QlooEntity } from "@/lib/qloo/types";

const ent = (id: string, name: string, subtype: string, popularity?: number, year?: number): QlooEntity => ({
  entity_id: id,
  name,
  type: "urn:entity",
  subtype,
  popularity,
  properties: year ? { release_year: year } : {},
});

/** Search results shaped like the live 10-11 /search answers for the example favorites. */
const LIVE_LIKE: Record<string, QlooEntity[]> = {
  minecraft: [
    ent("MC-GAME", "Minecraft", "urn:entity:videogame", 0.9661, 2011),
    ent("MC-MOVIE", "A Minecraft Movie", "urn:entity:movie", 0.9986, 2025),
    ent("MC-TV", "Minecraft", "urn:entity:tv_show", undefined, 2020),
  ],
  "stranger things": [
    ent("ST-2016", "Stranger Things", "urn:entity:tv_show", 0.99987, 2016),
    ent("ST-2010", "Stranger Things", "urn:entity:movie", 0.573, 2010),
  ],
  "the office": [
    ent("OFF-US", "The Office", "urn:entity:tv_show", 0.99847, 2005),
    ent("OFF-UK", "The Office", "urn:entity:tv_show", 0.97507, 2001),
    ent("OFF-BAND", "The Office", "urn:entity:artist", 0.96556),
  ],
  "breaking bad": [
    ent("BB-SHOW", "Breaking Bad", "urn:entity:tv_show", 0.99993, 2008),
    ent("BB-BAND", "Breaking Bad", "urn:entity:artist", 0.8961),
  ],
  "olivia rodrigo": [ent("OR", "Olivia Rodrigo", "urn:entity:artist", 0.9967)],
};

const fake: QlooClient = {
  mode: "live",
  search: async (q) => ({ success: true, results: LIVE_LIKE[q.toLowerCase()] ?? [] }),
  tags: async () => [],
  insights: async () => ({ success: true, results: { entities: [] } }),
};

async function resolve(favorites: string[], choices?: Record<string, string>) {
  const input: PlanInput = { language: "ko", level: "beginner", favorites, choices };
  const ctx = createContext(input, new BudgetedClient(fake), () => {});
  return resolveFavorites(ctx);
}

describe("clearLeader (same-title results)", () => {
  it("takes the top match when its popularity lead is large", () => {
    expect(clearLeader(LIVE_LIKE["stranger things"])?.entity_id).toBe("ST-2016");
    expect(clearLeader(LIVE_LIKE["breaking bad"])?.entity_id).toBe("BB-SHOW");
  });

  it("treats a missing popularity as zero", () => {
    const sameTitle = LIVE_LIKE.minecraft.filter((e) => e.name === "Minecraft");
    expect(clearLeader(sameTitle)?.entity_id).toBe("MC-GAME");
  });

  it("returns nothing for a close call, whatever order search used", () => {
    expect(clearLeader(LIVE_LIKE["the office"])).toBeUndefined();
    expect(clearLeader([...LIVE_LIKE["the office"]].reverse())).toBeUndefined();
  });

  it("is decided by the lead threshold itself", () => {
    const pair = (lead: number) => [ent("a", "X", "urn:entity:movie", 0.5), ent("b", "X", "urn:entity:movie", 0.5 + lead)];
    expect(clearLeader(pair(POPULARITY_LEAD + 0.001))?.entity_id).toBe("b");
    expect(clearLeader(pair(POPULARITY_LEAD - 0.001))).toBeUndefined();
  });
});

describe("resolveFavorites", () => {
  it("settles Minecraft and Stranger Things without a question (the 10-11 live stop)", async () => {
    const r = await resolve(["Minecraft", "Olivia Rodrigo", "Stranger Things"]);
    expect(r.questions).toEqual([]);
    expect(r.seeds.map((s) => s.entityId)).toEqual(["MC-GAME", "OR", "ST-2016"]);
  });

  it("still asks about The Office, most popular option first", async () => {
    const r = await resolve(["The Office", "Breaking Bad"]);
    expect(r.seeds.map((s) => s.entityId)).toEqual(["BB-SHOW"]);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].options.map((o) => o.entityId)).toEqual(["OFF-US", "OFF-UK", "OFF-BAND"]);
  });

  it("a pinned id wins even over a clear leader or a close call", async () => {
    const r = await resolve(["Stranger Things", "The Office"], { "Stranger Things": "ST-2010", "The Office": "OFF-UK" });
    expect(r.questions).toEqual([]);
    expect(r.seeds.map((s) => s.entityId)).toEqual(["ST-2010", "OFF-UK"]);
  });

  it("a pinned id that search no longer returns falls back to the rules", async () => {
    const r = await resolve(["Stranger Things", "The Office"], { "Stranger Things": "GONE", "The Office": "GONE" });
    expect(r.seeds.map((s) => s.entityId)).toEqual(["ST-2016"]);
    expect(r.questions.map((q) => q.favorite)).toEqual(["The Office"]);
  });
});

describe("example people", () => {
  it("pin every example favorite that shares its title, except Sam's The Office", () => {
    const pinned = PERSONAS.flatMap((p) => Object.keys(p.input.choices ?? {}));
    expect(pinned.sort()).toEqual(
      ["Avatar: The Last Airbender", "Breaking Bad", "Minecraft", "Stranger Things", "The Legend of Zelda: Breath of the Wild"].sort(),
    );
    for (const p of PERSONAS) for (const fav of Object.keys(p.input.choices ?? {})) expect(p.input.favorites).toContain(fav);
  });

  it("live pins do not break sample mode (unknown ids fall back to the rules)", async () => {
    const ctx = createContext(PERSONAS[0].input, new BudgetedClient(new MockQlooClient()), () => {});
    const r = await resolveFavorites(ctx);
    expect(r.questions).toEqual([]);
    expect(r.seeds).toHaveLength(3);
  });
});

describe("HttpQlooClient.search", () => {
  it("fills subtype from the live `types` array", async () => {
    const body = { success: true, results: [{ entity_id: "X", name: "Minecraft", types: ["urn:entity:videogame"], popularity: 0.9 }] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await new HttpQlooClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch }).search("Minecraft", ["urn:entity:videogame"]);
    expect(res.results[0].subtype).toBe("urn:entity:videogame");
  });
});
