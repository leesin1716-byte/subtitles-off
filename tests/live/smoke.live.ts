// 키가 온 날 바로 돌리는 실 API 점검: 문서에 예시가 없는 응답 모양 다섯 가지와 실제 계획 1건을 통과/실패로 찍는다
import { beforeAll, describe, expect, it } from "vitest";
import { runPlan } from "@/lib/plan/runner";
import { createContext, genreTagId, isMusicTag, resolveFavorites } from "@/lib/plan/tools";
import { BudgetedClient } from "@/lib/qloo/budget";
import { PERSONAS } from "@/lib/plan/personas";
import { DEFAULT_BASE_URL, HttpQlooClient, sharedGate } from "@/lib/qloo/http";
import { toQueryString } from "@/lib/qloo/params";
import { extractContributions, parseTags } from "@/lib/qloo/parse";
import type { Plan, PlanEvent } from "@/lib/plan/types";
import type { QueryParams } from "@/lib/qloo/types";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* no local env file: rely on the shell */
}
const key = process.env.QLOO_API_KEY?.trim();
const base = (process.env.QLOO_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

/** Raw GET, so the log shows the exact response shape (never the key). */
async function raw(path: string, params: QueryParams): Promise<Record<string, unknown>> {
  await sharedGate.wait(); // same 4-per-second pacing as the app's client (the host allows 5)
  const res = await fetch(`${base}${path}?${toQueryString(params)}`, { headers: { "X-Api-Key": key!, accept: "application/json" } });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}
const show = (label: string, v: unknown) => console.log(`\n[${label}]\n${JSON.stringify(v, null, 2).slice(0, 1500)}`);

describe.skipIf(!key)("live Qloo smoke checks", () => {
  let seedId = "";

  beforeAll(async () => {
    const r = (await raw("/search", { query: "Stranger Things", types: ["urn:entity:tv_show"], take: 1 })) as { results: { entity_id: string }[] };
    seedId = r.results[0]?.entity_id ?? "";
    show("search: Stranger Things (first result)", r.results[0]);
  });

  it("1. /search resolves a favorite to an entity id", () => {
    expect(seedId).toMatch(/^[A-Za-z0-9-]+$/);
  });

  it("2. /v2/tags finds music genre tags for Korean (isMusicTag keeps them)", async () => {
    const body = await raw("/v2/tags", { "filter.query": "k-pop", take: 10 });
    show("tags: k-pop (raw)", body);
    const tags = parseTags(body);
    show("tags: k-pop (parsed, music only)", tags.filter(isMusicTag));
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.filter(isMusicTag).length).toBeGreaterThan(0);
  });

  it("3. avoid genres: documented ids exist (filter.results.tags)", async () => {
    const built = ["Thriller", "Crime", "Horror", "War", "Action"].map(genreTagId);
    const body = await raw("/v2/tags", { "filter.results.tags": built, take: built.length });
    const found = parseTags(body).map((t) => t.id);
    show("tags: avoid ids confirmed", { asked: built, found });
    expect(found.filter((id) => built.includes(id)).length).toBeGreaterThanOrEqual(3);
  });

  it("4. explainability names which favorite drove each result", async () => {
    const client = new HttpQlooClient({ apiKey: key!, baseUrl: base });
    const r = await client.insights({
      "filter.type": "urn:entity:tv_show",
      "signal.interests.entities": [seedId],
      "feature.explainability": true,
      take: 5,
    });
    const first = r.results.entities?.[0];
    show("insights: explainability of the first result", first?.query);
    const withReason = (r.results.entities ?? []).filter((e) => extractContributions(e).length > 0);
    expect(withReason.length).toBeGreaterThan(0);
  });

  it("5. release_country takes country names and filters to them", async () => {
    const client = new HttpQlooClient({ apiKey: key!, baseUrl: base });
    const r = await client.insights({
      "filter.type": "urn:entity:tv_show",
      "signal.interests.entities": [seedId],
      "filter.release_country": ["South Korea"],
      take: 8,
    });
    const countries = (r.results.entities ?? []).map((e) => ({ name: e.name, release_country: e.properties?.release_country }));
    show("insights: release_country=South Korea", countries);
    expect(countries.length).toBeGreaterThan(0);
    expect(countries.every((c) => (c.release_country ?? []).includes("South Korea"))).toBe(true);
  });

  it("6. filter.exclude.tags removes horror and thriller", async () => {
    const client = new HttpQlooClient({ apiKey: key!, baseUrl: base });
    const avoid = ["Horror", "Thriller"].map(genreTagId);
    const r = await client.insights({
      "filter.type": "urn:entity:tv_show",
      "signal.interests.entities": [seedId],
      "filter.exclude.tags": avoid,
      take: 10,
    });
    const leaked = (r.results.entities ?? []).filter((e) => (e.tags ?? []).some((t) => avoid.includes(t.id)));
    show("insights: excluded horror/thriller, leaks", leaked.map((e) => e.name));
    expect(r.results.entities?.length ?? 0).toBeGreaterThan(0);
    expect(leaked).toEqual([]);
  });

  it("7. taste analysis (filter.type=urn:tag) returns genre tags", async () => {
    const body = await raw("/v2/insights", {
      "filter.type": "urn:tag",
      "filter.tag.types": "urn:tag:genre:media",
      "signal.interests.entities": [seedId],
      take: 6,
    });
    show("insights: taste tags", parseTags(body));
    expect(parseTags(body).length).toBeGreaterThan(0);
  });

  it("8. a full plan for the first example person (rule planner, live data)", async () => {
    const events: PlanEvent[] = [];
    await runPlan(PERSONAS[0].input, { client: new HttpQlooClient({ apiKey: key!, baseUrl: base }), emit: (e) => events.push(e) });
    const plan = (events.find((e) => e.type === "plan") as { plan: Plan } | undefined)?.plan;
    show("plan: summary", {
      error: events.find((e) => e.type === "error"),
      question: events.find((e) => e.type === "needs_input"),
      calls: plan?.calls.length,
      applied: plan?.applied,
      tasteTags: plan?.tasteTags,
      items: plan?.weeks.flatMap((w) => w.items.map((i) => `${w.week} ${i.domain} ${i.name} (${i.year ?? "?"}) ${i.because ? `because ${i.because.seedName}` : ""}`)),
    });
    expect(plan).toBeDefined();
    const items = plan!.weeks.flatMap((w) => w.items);
    expect(items.some((i) => i.domain === "artist")).toBe(true);
    expect(items.some((i) => i.because)).toBe(true);
  });
  it("9. same-title favorites settle by popularity without pins; only a close call asks", async () => {
    const client = new HttpQlooClient({ apiKey: key!, baseUrl: base });
    const resolveUnpinned = (i: number) =>
      resolveFavorites(createContext({ ...PERSONAS[i].input, choices: undefined }, new BudgetedClient(client), () => {}));
    const [mina, sam] = await Promise.all([resolveUnpinned(0), resolveUnpinned(1)]);
    show("resolve without pins", {
      mina: mina.seeds.map((s) => `${s.name} ${s.subtype} ${s.year ?? ""} ${s.entityId}`),
      sam: sam.seeds.map((s) => `${s.name} ${s.subtype} ${s.year ?? ""} ${s.entityId}`),
      samQuestions: sam.questions,
    });
    expect(mina.questions).toEqual([]);
    // The popularity rule lands on the same entities the example pins name.
    expect(mina.seeds.map((s) => s.entityId)).toEqual(expect.arrayContaining(Object.values(PERSONAS[0].input.choices ?? {})));
    expect(sam.questions.map((q) => q.favorite)).toEqual(["The Office"]);
  });
});

describe.runIf(!key)("live Qloo smoke checks", () => {
  it("skipped: set QLOO_API_KEY (or put it in .env.local) to run", () => {
    expect(key || undefined).toBeUndefined();
  });
});
