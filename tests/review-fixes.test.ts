// 심사 리뷰 반영분(예산 소진·LLM 시간 초과·태그 판정·회피 태그·취향 태그·다듬기·영어 검증·비교 해석) 회귀 테스트
import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { runPlan } from "@/lib/plan/runner";
import { pickSearchHit, runCompare } from "@/lib/plan/compare";
import { isNotEnglish } from "@/lib/plan/compose";
import { parseRefinement } from "@/lib/plan/refine";
import { addSeen, MAX_SEEN } from "@/lib/plan/share";
import { createContext, findAvoidTags, genreTagId, isMusicTag } from "@/lib/plan/tools";
import { BudgetedClient } from "@/lib/qloo/budget";
import { QlooError } from "@/lib/qloo/errors";
import { MockQlooClient } from "@/lib/qloo/mock";
import type { Plan, PlanEvent, PlanInput } from "@/lib/plan/types";
import type { QlooClient, QlooEntity } from "@/lib/qloo/types";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
let seq = 0;
const toolStep = (calls: { name: string; input: unknown }[]) => ({
  content: calls.map((c) => ({ type: "tool-call" as const, toolCallId: `rf-${++seq}`, toolName: c.name, input: JSON.stringify(c.input) })),
  finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
  usage,
  warnings: [],
});
const textStep = (text: string) => ({ content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: "stop" }, usage, warnings: [] });

const MINA: PlanInput = { language: "ko", level: "beginner", favorites: ["Minecraft", "Olivia Rodrigo", "Stranger Things"], age: 15, family: true };

async function run(input: PlanInput, extra: Partial<Parameters<typeof runPlan>[1]> = {}) {
  const events: PlanEvent[] = [];
  await runPlan(input, { client: new MockQlooClient(), emit: (e) => events.push(e), ...extra });
  return { events, plan: (events.find((e) => e.type === "plan") as { plan: Plan } | undefined)?.plan };
}

describe("I1: running out of the Qloo call budget inside the LLM loop", () => {
  it("is not fatal: the plan is composed from what was found", async () => {
    // 3 searches + 2 music-tag calls + 1 taste call + 3 discovers = 9; one widen fits, the next two do not.
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolStep([
          { name: "discover", input: { domain: "tv_show" } },
          { name: "discover", input: { domain: "movie" } },
          { name: "discover", input: { domain: "artist" } },
        ]),
        toolStep([
          { name: "widen", input: { domain: "tv_show" } },
          { name: "widen", input: { domain: "movie" } },
          { name: "widen", input: { domain: "artist" } },
        ]),
        textStep("ok"),
      ],
    });
    const { events, plan } = await run(MINA, { model, modelName: "mock", callBudget: 10 });
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(events.some((e) => e.type === "trace" && e.step === "Qloo call budget reached" && /composing from/.test(e.detail ?? ""))).toBe(true);
    expect(plan).toBeDefined();
    expect(plan!.planner).toBe("rules");
    expect(plan!.calls.length).toBe(10);
    expect(plan!.weeks.flatMap((w) => w.items).length).toBeGreaterThan(3);
  });

  it("the rule planner also stops discovering cleanly when the budget is gone", async () => {
    const { events, plan } = await run(MINA, { callBudget: 7 });
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(plan!.calls.length).toBe(7);
  });
});

describe("I3: the LLM gets its own time limit", () => {
  it("falls back to rules when the LLM does not answer in time", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: (opts) =>
        new Promise((_, reject) => opts.abortSignal?.addEventListener("abort", () => reject(new Error("aborted by timeout")))),
    });
    const started = Date.now();
    const { plan } = await run(MINA, { model, modelName: "slow", llmTimeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(plan!.planner).toBe("rules");
    expect(plan!.plannerNote).toMatch(/ran out of time/);
    expect(plan!.llmConfigured).toBe(true);
  });
});

describe("B4: response-shape guesses that feed core features", () => {
  it("isMusicTag accepts the id, subtype or entity-type signals", () => {
    expect(isMusicTag({ id: "urn:tag:genre:music:k_pop" })).toBe(true);
    expect(isMusicTag({ id: "urn:tag:genre:k_pop", subtype: "urn:tag:genre:music" })).toBe(true);
    expect(isMusicTag({ id: "urn:tag:genre:k_pop", types: ["urn:entity:artist"] })).toBe(true);
    expect(isMusicTag({ id: "urn:tag:genre:media:drama", types: ["urn:entity:movie", "urn:entity:tv_show"], subtype: "urn:tag:genre:media" })).toBe(false);
  });

  it("builds genre ids in the documented format", () => {
    expect(genreTagId("Horror")).toBe("urn:tag:genre:media:horror");
    expect(genreTagId("Science Fiction")).toBe("urn:tag:genre:media:science_fiction");
  });

  const avoidCtx = (client: QlooClient) =>
    createContext({ ...MINA, avoid: "violence" }, new BudgetedClient(client), () => {});

  it("confirms avoid-genre ids with one /v2/tags call (no keyword search, no first-50 lottery)", async () => {
    const calls: unknown[] = [];
    const base = new MockQlooClient();
    const client: QlooClient = { mode: "mock", search: base.search.bind(base), insights: base.insights.bind(base), tags: async (p) => (calls.push(p), base.tags(p)) };
    const ctx = avoidCtx(client);
    const ids = await findAvoidTags(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ "filter.results.tags": expect.arrayContaining(["urn:tag:genre:media:thriller", "urn:tag:genre:media:crime"]) });
    expect(ids.sort()).toEqual(["action", "crime", "horror", "thriller", "war"].map((g) => `urn:tag:genre:media:${g}`));
  });

  it("still excludes the documented ids when Qloo cannot confirm them", async () => {
    const base = new MockQlooClient();
    const failing: QlooClient = { mode: "mock", search: base.search.bind(base), insights: base.insights.bind(base), tags: async () => { throw new QlooError("bad_request", "Qloo 400: unknown parameter", 400); } };
    expect(await findAvoidTags(avoidCtx(failing))).toContain("urn:tag:genre:media:thriller");
    const unrelated: QlooClient = { ...failing, tags: async () => [{ id: "urn:tag:genre:media:comedy", name: "Comedy" }] };
    expect(await findAvoidTags(avoidCtx(unrelated))).toHaveLength(5);
  });

  it("drops results carrying an avoided tag id even when the tag name differs", async () => {
    const { plan } = await run({ ...MINA, avoid: "violence" });
    const ids = plan!.weeks.flatMap((w) => w.items).flatMap((i) => i.tags.map((t) => t.id));
    for (const g of ["thriller", "crime", "horror", "war", "action"]) expect(ids).not.toContain(`urn:tag:genre:media:${g}`);
  });
});

describe("I14: taste analysis with Insights filter.type=urn:tag", () => {
  it("adds one tag-insights call and shows the genres on the plan", async () => {
    const { plan } = await run(MINA);
    const tagCall = plan!.calls.find((c) => c.endpoint === "/v2/insights" && c.params["filter.type"] === "urn:tag");
    expect(tagCall).toBeDefined();
    expect(tagCall!.params["signal.interests.entities"]).toHaveLength(3);
    expect(plan!.tasteTags.length).toBeGreaterThan(0);
    expect(plan!.tasteTags.every((t) => !t.startsWith("urn:"))).toBe(true);
  });

  it("is never fatal", async () => {
    const base = new MockQlooClient();
    const client: QlooClient = {
      mode: "mock",
      search: base.search.bind(base),
      tags: base.tags.bind(base),
      insights: async (p) => {
        if (p["filter.type"] === "urn:tag") throw new QlooError("server", "Qloo 500", 500);
        return base.insights(p);
      },
    };
    const { plan } = await run(MINA, { client });
    expect(plan!.tasteTags).toEqual([]);
    expect(plan!.weeks).toHaveLength(4);
  });
});

describe("I4: seen titles", () => {
  it("does not treat 'we watched together' as a title", () => {
    expect(parseRefinement("We watched together last week and she loved it").seenTitles).toEqual([]);
    expect(parseRefinement("Something we watched with grandma").seenTitles).toEqual([]);
  });
  it("reads titles after 'already' and quoted titles", () => {
    expect(parseRefinement("She already watched Squid Game and Kingdom.").seenTitles).toEqual(["Squid Game", "Kingdom"]);
    expect(parseRefinement('We watched "Parasite" and "Okja" last month').seenTitles).toEqual(["Parasite", "Okja"]);
    expect(parseRefinement("already seen “Reply 1988”").seenTitles).toEqual(["Reply 1988"]);
  });
});

describe("I5: 'Seen it' many times", () => {
  it("keeps the newest 30 removals and never duplicates", () => {
    let list: string[] | undefined;
    for (let i = 0; i < 40; i++) list = addSeen(list, `id-${i}`);
    expect(list).toHaveLength(MAX_SEEN);
    expect(list![0]).toBe("id-10");
    expect(addSeen(["a", "b"], "a")).toEqual(["b", "a"]);
  });
});

describe("I6: planner reasons must be English", () => {
  it("rejects Spanish and French sentences and CJK text", () => {
    expect(isNotEnglish("Una serie divertida para los fans de The Office y muy fácil de seguir.")).toBe(true);
    expect(isNotEnglish("Une comédie légère pour les fans de Stranger Things, avec des amis.")).toBe(true);
    expect(isNotEnglish("할머니와 함께")).toBe(true);
  });
  it("accepts English with foreign titles in it", () => {
    expect(isNotEnglish("Like La La Land, a bittersweet musical with the same mood.")).toBe(false);
    expect(isNotEnglish("For fans of Amélie: whimsical, warm and easy to follow.")).toBe(false);
    expect(isNotEnglish("Same eerie small-town mystery as Stranger Things.")).toBe(false);
  });
});

describe("I7: compare panel resolves generic titles carefully and adds independent measures", () => {
  const e = (id: string, name: string, country: string[], year: number): QlooEntity => ({
    entity_id: id,
    name,
    type: "urn:entity",
    subtype: "urn:entity:tv_show",
    properties: { release_country: country, release_year: year },
  });

  it("prefers the same-named title from a country of the target language", () => {
    const hits = [e("us", "Kingdom", ["United States"], 2014), e("kr", "Kingdom", ["South Korea"], 2019)];
    expect(pickSearchHit("Kingdom", hits, ["South Korea"])!.entity_id).toBe("kr");
    expect(pickSearchHit("Lupin", [e("x", "Lupin the Third", ["Japan"], 1971), e("y", "Lupin", ["United States"], 2004)], ["France"])!.entity_id).toBe("y");
    expect(pickSearchHit("Nothing", [], ["France"])).toBeUndefined();
  });

  it("reports language match, favorites covered and popularity next to affinity", async () => {
    const r = await runCompare(
      {
        language: "es",
        seeds: [
          { entityId: "mock-the-office-us", name: "The Office" },
          { entityId: "mock-breaking-bad", name: "Breaking Bad" },
        ],
        planItems: [
          { entityId: "mock-paquita-salas", name: "Paquita Salas", domain: "tv_show" },
          { entityId: "mock-el-marginal", name: "El Marginal", domain: "tv_show" },
          { entityId: "mock-nine-queens", name: "Nine Queens", domain: "movie" },
        ],
      },
      { client: new MockQlooClient() },
    );
    expect(r.groundedStats.languageMatch).toBe(1);
    expect(r.groundedStats.favoritesCovered).toBeGreaterThanOrEqual(1);
    expect(r.seedCount).toBe(2);
    expect(typeof r.baselineStats.popularity).toBe("number");
    expect(r.baselineStats.popularity!).toBeGreaterThan(r.groundedStats.popularity!);
    for (const item of r.baseline.filter((b) => b.found)) expect(item.year).toBeTypeOf("number");
  });
});
