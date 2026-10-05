// 목업 Qloo로 시나리오 S1(계승어)·S2(모호한 시드)·S3(다듬기)와 넓히기·오류 경로를 끝까지 돌리는 테스트
import { describe, expect, it } from "vitest";
import { runPlan } from "@/lib/plan/runner";
import { MockQlooClient } from "@/lib/qloo/mock";
import { QlooError } from "@/lib/qloo/errors";
import { FIXTURES } from "@/lib/qloo/fixtures";
import type { Plan, PlanEvent, PlanInput } from "@/lib/plan/types";
import type { QlooClient } from "@/lib/qloo/types";

async function run(input: PlanInput, client: QlooClient = new MockQlooClient()) {
  const events: PlanEvent[] = [];
  await runPlan(input, { client, emit: (e) => events.push(e) });
  const plan = (events.find((e) => e.type === "plan") as { plan: Plan } | undefined)?.plan;
  return { events, plan };
}

const MINA: PlanInput = { language: "ko", level: "beginner", favorites: ["Minecraft", "Olivia Rodrigo", "Stranger Things"], age: 15, family: true };
const fixtureById = new Map(FIXTURES.map((f) => [f.id, f]));

describe("S1 heritage learner (Mina, Korean)", () => {
  it("builds a four-week plan only from Qloo results, in Korean, teen-safe, music every week", async () => {
    const returnedIds = new Set<string>();
    const base = new MockQlooClient();
    const recording: QlooClient = {
      mode: "mock",
      search: (q, t, n) => base.search(q, t, n),
      tags: (p) => base.tags(p),
      insights: async (p) => {
        const r = await base.insights(p);
        for (const e of r.results.entities ?? []) returnedIds.add(e.entity_id);
        return r;
      },
    };
    const { plan } = await run(MINA, recording);
    expect(plan).toBeDefined();
    expect(plan!.planner).toBe("rules");
    expect(plan!.mode).toBe("mock");
    expect(plan!.weeks).toHaveLength(4);
    const items = plan!.weeks.flatMap((w) => w.items);
    expect(items.length).toBeGreaterThanOrEqual(8);

    // every item is a Qloo entity returned by an insights call in this run
    for (const it of items) expect(returnedIds.has(it.entityId)).toBe(true);
    for (const it of items) {
      const fx = fixtureById.get(it.entityId)!;
      expect(fx.seed).toBeFalsy();
      if (it.domain !== "artist") {
        expect(fx.country).toContain("South Korea");
        expect(["G", "PG", "TV-Y", "TV-Y7", "TV-G", "TV-PG", "PG-13", "TV-14"]).toContain(fx.rating);
      } else {
        expect(fx.tags.some((t) => t.includes("k_pop") || t.includes("korean"))).toBe(true);
      }
      expect(it.activity).toBeTruthy();
    }
    for (const w of plan!.weeks) expect(w.items.some((i) => i.domain === "artist")).toBe(true);

    // explainability reaches the UI as "because you like ..."
    expect(items.filter((i) => i.because).length).toBeGreaterThan(items.length / 2);
    expect(items.some((i) => i.because?.seedName === "Stranger Things")).toBe(true);

    // ladder: tiers never go down from week to week
    const tiers = plan!.weeks.flatMap((w) => w.items.filter((i) => i.domain !== "artist").map((i) => i.tier));
    expect([...tiers].sort()).toEqual(tiers);

    // provenance and budget
    expect(plan!.calls.length).toBeLessThanOrEqual(16);
    expect(plan!.applied.join(" | ")).toMatch(/Release country: South Korea/);
    expect(plan!.applied.join(" | ")).toMatch(/Content ratings: .*TV-14/);
  });
});

describe("S2 adult learner with an ambiguous favorite (Sam, Spanish)", () => {
  const SAM: PlanInput = { language: "es", level: "intermediate", favorites: ["The Office", "Arctic Monkeys", "Breaking Bad"], age: 34 };

  it("asks which 'The Office' before spending any Insights call", async () => {
    const { events, plan } = await run(SAM);
    expect(plan).toBeUndefined();
    const q = events.find((e) => e.type === "needs_input") as Extract<PlanEvent, { type: "needs_input" }>;
    expect(q.questions[0].favorite).toBe("The Office");
    expect(q.questions[0].options.map((o) => o.entityId).sort()).toEqual(["mock-the-office-uk", "mock-the-office-us"]);
    expect(events.some((e) => e.type === "qloo" && e.call.endpoint === "/v2/insights")).toBe(false);
  });

  it("uses the chosen entity and spans several Spanish-speaking countries", async () => {
    const { plan } = await run({ ...SAM, choices: { "The Office": "mock-the-office-us" } });
    expect(plan!.seeds.find((s) => s.query === "The Office")!.entityId).toBe("mock-the-office-us");
    const countries = new Set(
      plan!.weeks.flatMap((w) => w.items).filter((i) => i.domain !== "artist").flatMap((i) => fixtureById.get(i.entityId)!.country ?? []),
    );
    expect(countries.size).toBeGreaterThanOrEqual(2);
    const names = plan!.weeks.flatMap((w) => w.items.map((i) => i.name));
    expect(names).toContain("Paquita Salas");
  });
});

describe("S3 refinement", () => {
  it("removes violent genres and already-seen titles and adds music", async () => {
    const before = (await run(MINA)).plan!;
    const { plan } = await run({ ...MINA, refinement: "No violence please. She already watched Signal. More music." });
    const items = plan!.weeks.flatMap((w) => w.items);
    for (const it of items) {
      const genres = it.tags.map((t) => t.name);
      for (const bad of ["Thriller", "Horror", "Crime", "War", "Action"]) expect(genres).not.toContain(bad);
    }
    expect(items.map((i) => i.name)).not.toContain("Signal");
    for (const w of plan!.weeks) expect(w.items.filter((i) => i.domain === "artist").length).toBe(2);
    expect(plan!.applied.join(" ")).toMatch(/Avoiding: .*Qloo tags excluded/);
    expect(before.weeks.flatMap((w) => w.items).length).toBeGreaterThan(0);
  });
});

describe("widening and failure states", () => {
  it("widens a thin domain step by step and says so in the trace", async () => {
    // French with a strict age cap leaves very few TV shows → widen kicks in
    const { events, plan } = await run({ language: "fr", level: "beginner", favorites: ["The Office", "Olivia Rodrigo"], age: 10, choices: { "The Office": "mock-the-office-us" } });
    expect(plan).toBeDefined();
    expect(events.some((e) => e.type === "trace" && e.step.startsWith("Widened"))).toBe(true);
  });

  it("reports when no favorite can be found", async () => {
    const { events } = await run({ language: "ko", level: "beginner", favorites: ["qqqzzz", "xxyyzz"] });
    expect(events.at(-1)).toMatchObject({ type: "error", code: "no_seeds" });
  });

  it("turns a rejected key into a clear error", async () => {
    const broken: QlooClient = {
      mode: "live",
      search: async () => {
        throw new QlooError("auth", "Qloo 401", 401);
      },
      tags: async () => [],
      insights: async () => ({ success: true, results: {} }),
    };
    const { events } = await run(MINA, broken);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "qloo_auth" });
  });

  it("keeps every run within the 16-call budget even for five favorites", async () => {
    const { plan } = await run({
      language: "ja",
      level: "beginner",
      favorites: ["Zelda", "Phoebe Bridgers", "Avatar", "Minecraft", "Stranger Things"],
      avoid: "horror",
    });
    expect(plan!.calls.length).toBeLessThanOrEqual(16);
    expect(plan!.weeks.flatMap((w) => w.items).some((i) => i.name === "Joe Hisaishi")).toBe(true);
  });
});
