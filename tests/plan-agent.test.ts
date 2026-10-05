// 녹화된 LLM 응답(MockLanguageModelV4)으로 에이전트 루프·검증기·폴백과 비교 패널을 검증하는 테스트
import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { runPlan } from "@/lib/plan/runner";
import { runCompare } from "@/lib/plan/compare";
import { validatePicks } from "@/lib/plan/compose";
import { createContext } from "@/lib/plan/tools";
import { MockQlooClient } from "@/lib/qloo/mock";
import { BudgetedClient } from "@/lib/qloo/budget";
import type { Plan, PlanEvent, PlanInput } from "@/lib/plan/types";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
let callSeq = 0;
const toolStep = (calls: { name: string; input: unknown }[]) => ({
  content: calls.map((c) => ({ type: "tool-call" as const, toolCallId: `call-${++callSeq}`, toolName: c.name, input: JSON.stringify(c.input) })),
  finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
  usage,
  warnings: [],
});
const textStep = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage,
  warnings: [],
});

const MINA: PlanInput = { language: "ko", level: "beginner", favorites: ["Minecraft", "Olivia Rodrigo", "Stranger Things"], age: 15, family: true };
const DISCOVER_ALL = toolStep([
  { name: "discover", input: { domain: "tv_show" } },
  { name: "discover", input: { domain: "movie" } },
  { name: "discover", input: { domain: "artist" } },
]);
const VALID_PICKS = [
  { entityId: "mock-reply-1988", reason: "A warm 1980s neighbourhood story, like the friendships in Stranger Things." },
  { entityId: "mock-running-man" },
  { entityId: "mock-uncanny-counter", reason: "Supernatural team action with a small-town feel." },
  { entityId: "mock-twenty-five-twenty-one" },
  { entityId: "mock-newjeans", reason: "Bright pop hooks for an Olivia Rodrigo fan." },
  { entityId: "mock-iu" },
];

async function run(input: PlanInput, model: MockLanguageModelV4) {
  const events: PlanEvent[] = [];
  await runPlan(input, { client: new MockQlooClient(), model, modelName: "mock-llm", emit: (e) => events.push(e) });
  return { events, plan: (events.find((e) => e.type === "plan") as { plan: Plan } | undefined)?.plan };
}

describe("LLM agent planner", () => {
  it("lets the model drive discover → compose, rejects invented ids, then accepts a valid plan", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        DISCOVER_ALL,
        toolStep([{ name: "compose_plan", input: { picks: [{ entityId: "mock-made-up-show" }, ...VALID_PICKS] } }]),
        toolStep([{ name: "compose_plan", input: { picks: VALID_PICKS } }]),
        textStep("Done."),
      ],
    });
    const { plan, events } = await run(MINA, model);
    expect(events.some((e) => e.type === "trace" && e.step === "Validator: plan rejected" && /mock-made-up-show/.test(e.detail ?? ""))).toBe(true);
    expect(plan!.planner).toBe("llm");
    const ids = plan!.weeks.flatMap((w) => w.items.map((i) => i.entityId));
    expect(ids).not.toContain("mock-made-up-show");
    expect(new Set(ids)).toEqual(new Set(VALID_PICKS.map((p) => p.entityId)));
    expect(plan!.weeks.flatMap((w) => w.items).find((i) => i.entityId === "mock-newjeans")!.note).toMatch(/Olivia Rodrigo/);
    // the loop stopped as soon as the plan was accepted
    expect(model.doGenerateCalls.length).toBe(3);
    // the prompt carries no personal name, only taste signals
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain("Stranger Things");
    expect(prompt).not.toMatch(/Mina/);
  });

  it("falls back to the rule-based planner after two rejected plans", async () => {
    const bad = toolStep([{ name: "compose_plan", input: { picks: [{ entityId: "mock-nope" }] } }]);
    const model = new MockLanguageModelV4({ doGenerate: [DISCOVER_ALL, bad, { ...bad, content: bad.content.map((c) => ({ ...c, toolCallId: "call-x" })) }, textStep("?")] });
    const { plan, events } = await run(MINA, model);
    expect(plan!.planner).toBe("rules");
    expect(plan!.plannerNote).toMatch(/fell back/);
    expect(events.filter((e) => e.type === "trace" && e.step === "Validator: plan rejected")).toHaveLength(2);
    expect(plan!.weeks.flatMap((w) => w.items).length).toBeGreaterThan(4);
  });

  it("keeps working when the LLM is unavailable", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("gateway down");
      },
    });
    const { plan } = await run(MINA, model);
    expect(plan!.planner).toBe("rules");
    expect(plan!.plannerNote).toMatch(/LLM unavailable/);
  });
});

describe("validatePicks", () => {
  it("rejects target-language text, duplicates and missing music", async () => {
    const ctx = createContext(MINA, new BudgetedClient(new MockQlooClient()), () => {});
    ctx.byDomain.tv_show = [{ entityId: "a", name: "A", domain: "tv_show", tier: 1, tags: [] }, { entityId: "b", name: "B", domain: "tv_show", tier: 2, tags: [] }, { entityId: "c", name: "C", domain: "movie", tier: 2, tags: [] }];
    ctx.byDomain.artist = [{ entityId: "m", name: "M", domain: "artist", tier: 1, tags: [] }];
    const r = validatePicks(ctx, [{ entityId: "a", reason: "할머니와 함께" }, { entityId: "a" }, { entityId: "b" }, { entityId: "c" }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/English only/);
    expect(r.errors.join(" ")).toMatch(/listed twice/);
    expect(r.errors.join(" ")).toMatch(/at least one artist/);
    expect(validatePicks(ctx, [{ entityId: "a" }, { entityId: "b" }, { entityId: "c" }, { entityId: "m", reason: "Same mood." }]).ok).toBe(true);
  });
});

describe("compare panel", () => {
  const input = {
    language: "es" as const,
    seeds: [
      { entityId: "mock-the-office-us", name: "The Office" },
      { entityId: "mock-breaking-bad", name: "Breaking Bad" },
    ],
    planItems: [
      { entityId: "mock-paquita-salas", name: "Paquita Salas", domain: "tv_show" as const },
      { entityId: "mock-el-marginal", name: "El Marginal", domain: "tv_show" as const },
      { entityId: "mock-nine-queens", name: "Nine Queens", domain: "movie" as const },
    ],
  };

  it("scores canned generic picks and plan picks with the same Qloo seeds", async () => {
    const r = await runCompare(input, { client: new MockQlooClient() });
    expect(r.baselineSource).toBe("canned");
    expect(r.baseline.map((b) => b.name)).toEqual(["Money Heist", "Elite", "Pan's Labyrinth"]);
    expect(r.baseline.every((b) => typeof b.affinity === "number")).toBe(true);
    expect(r.groundedStats.affinity!).toBeGreaterThan(r.baselineStats.affinity!);
    expect(r.calls).toBeLessThanOrEqual(10);
  });

  it("uses the LLM's own list when a model is configured and marks unknown titles", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [textStep(JSON.stringify({ titles: ["Money Heist", "Totally Unknown Show"] }))] });
    const r = await runCompare(input, { client: new MockQlooClient(), model });
    expect(r.baselineSource).toBe("llm");
    expect(r.baseline[1]).toEqual({ name: "Totally Unknown Show", found: false });
  });
});
