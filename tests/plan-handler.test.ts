// /api/plan 핸들러(503·400·429·캐시 재생), 예시 계획 예열, 상태 점검, 스트림 리더, 운영 첫 화면을 검증하는 테스트
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { handlePlanRequest, warmPersonaPlans, type PlanDeps } from "@/lib/plan/handler";
import { isPersonaInput, MemoryPlanStore, planCacheKey } from "@/lib/plan/plan-cache";
import { readPlanStream } from "@/lib/plan/stream";
import { deepCheckAllowed, runHealth } from "@/lib/health";
import { getQlooClient } from "@/lib/qloo/server";
import { MockQlooClient } from "@/lib/qloo/mock";
import { QlooError } from "@/lib/qloo/errors";
import { RateLimiter } from "@/lib/ratelimit";
import { PERSONAS } from "@/lib/plan/personas";
import type { PlanEvent, PlanInput } from "@/lib/plan/types";

const MINA = PERSONAS[0].input;
const OTHER: PlanInput = { language: "fr", level: "beginner", favorites: ["Phoebe Bridgers", "Olivia Rodrigo"] };

function deps(over: Partial<Parameters<typeof handlePlanRequest>[1]> = {}) {
  const client = new MockQlooClient();
  return {
    getClient: () => ({ ok: true as const, client }),
    getModel: () => undefined,
    store: new MemoryPlanStore(),
    limiter: new RateLimiter([{ windowMs: 60_000, max: 1 }]),
    ...over,
  };
}

const post = (body: unknown, ip = "203.0.113.7") =>
  new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function events(res: Response): Promise<PlanEvent[]> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PlanEvent);
}

describe("POST /api/plan handler", () => {
  it("answers 503 on a production deployment without a Qloo key (no sample-data fallback)", async () => {
    const res = await handlePlanRequest(post(MINA), deps({ getClient: () => getQlooClient({ VERCEL_ENV: "production" }) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "config" });
  });

  it("answers 400 with a friendly message for bad input", async () => {
    const d = deps();
    expect((await handlePlanRequest(post("{not json"), d)).status).toBe(400);
    const tooMany = await handlePlanRequest(post({ ...MINA, excludeIds: Array.from({ length: 31 }, (_, i) => `id-${i}`) }), d);
    expect(tooMany.status).toBe(400);
    const body = (await tooMany.json()) as { message: string };
    expect(body.message).toMatch(/Start a fresh plan/);
    expect(body.message).not.toMatch(/too_big|Too big|<=/);
    expect(((await (await handlePlanRequest(post({ ...MINA, favorites: ["one"] }), d)).json()) as { message: string }).message).toMatch(/two to five/);
  });

  it("streams a plan, then 429s a new plan from the same IP, but replays a cached plan without counting it", async () => {
    const d = deps();
    const first = await events(await handlePlanRequest(post(MINA), d));
    expect(first.some((e) => e.type === "plan")).toBe(true);

    const limited = await handlePlanRequest(post(OTHER), d);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);

    // same plan again (favorites reordered, different case): served from the cache, not rate-limited
    const again = await handlePlanRequest(post({ ...MINA, favorites: ["stranger things", "Minecraft", "Olivia Rodrigo"] }), d);
    expect(again.status).toBe(200);
    const replay = await events(again);
    expect(replay[0]).toMatchObject({ type: "trace", step: "Served from the plan cache" });
    const plan = replay.find((e) => e.type === "plan");
    expect(plan && plan.type === "plan" && plan.plan.servedFromCache).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not cache plans that ended in an error", async () => {
    const failing = new MockQlooClient();
    failing.insights = async () => {
      throw new QlooError("rate_limited", "Qloo 429", 429);
    };
    const d = deps({ getClient: () => ({ ok: true, client: failing }), limiter: new RateLimiter([{ windowMs: 60_000, max: 10 }]) });
    const ev = await events(await handlePlanRequest(post(MINA), d));
    expect(ev.at(-1)).toMatchObject({ type: "error", code: "qloo_rate_limited" });
    expect((d.store as MemoryPlanStore).data.size).toBe(0);
  });
});

describe("plan cache keys", () => {
  it("treats example people (and their follow-up choice) as long-lived", () => {
    expect(isPersonaInput(MINA)).toBe(true);
    expect(isPersonaInput({ ...PERSONAS[1].input, choices: { "The Office": "mock-the-office-us" } })).toBe(true);
    expect(isPersonaInput(OTHER)).toBe(false);
    expect(planCacheKey(MINA, "live:llm")).not.toBe(planCacheKey(MINA, "mock:rules"));
  });
});

describe("warmPersonaPlans (daily cron)", () => {
  it("builds all three examples once, including Sam's follow-up after the ambiguity question", async () => {
    const store = new MemoryPlanStore();
    const client = new MockQlooClient();
    const d: PlanDeps = { getClient: () => ({ ok: true, client }), getModel: () => undefined, store };
    expect(await warmPersonaPlans(d)).toEqual({ mina: "built", sam: "built", jordan: "built" });
    expect(store.data.size).toBe(4); // Sam: the question and the plan for Qloo's first match
    expect(await warmPersonaPlans(d)).toEqual({ mina: "cached", sam: "cached", jordan: "cached" });
  });
});

describe("health check", () => {
  it("only runs deep (Qloo-calling) checks with the cron secret in production", () => {
    const h = (auth?: string) => new Headers(auth ? { authorization: auth } : {});
    expect(deepCheckAllowed(h(), { VERCEL_ENV: "production" })).toBe(false);
    expect(deepCheckAllowed(h("Bearer s3cret"), { VERCEL_ENV: "production", CRON_SECRET: "s3cret" })).toBe(true);
    expect(deepCheckAllowed(h("Bearer wrong"), { VERCEL_ENV: "production", CRON_SECRET: "s3cret" })).toBe(false);
    expect(deepCheckAllowed(h(), {})).toBe(true);
  });

  it("reports Qloo reachability and warms the examples", async () => {
    const client = new MockQlooClient();
    const planDeps: PlanDeps = { getClient: () => ({ ok: true, client }), getModel: () => undefined, store: new MemoryPlanStore() };
    const report = await runHealth({ env: { QLOO_MODE: "mock" }, deep: true, freshClient: () => ({ ok: true, client }), planDeps });
    expect(report.ok).toBe(true);
    expect(report.qloo).toMatchObject({ ok: true, detail: "Stranger Things" });
    expect(report.llm).toBe("off");

    const down = new MockQlooClient();
    down.search = async () => {
      throw new QlooError("auth", "Qloo 401: key expired", 401);
    };
    const bad = await runHealth({ env: { QLOO_MODE: "mock" }, deep: true, freshClient: () => ({ ok: true, client: down }), planDeps });
    expect(bad.ok).toBe(false);
    expect(bad.qloo!.detail).toMatch(/401/);
  });
});

describe("readPlanStream (browser side)", () => {
  const enc = new TextEncoder();
  const streamOf = (chunks: string[], fail = false) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        if (fail) c.error(new TypeError("network error"));
        else c.close();
      },
    });

  it("handles events split across chunks and reports the outcome", async () => {
    const seen: PlanEvent[] = [];
    const out = await readPlanStream(streamOf(['{"type":"trace","st', 'ep":"a"}\n{"type":"needs_input","questions":[]}']), (e) => seen.push(e));
    expect(out).toBe("needs_input");
    expect(seen.map((e) => e.type)).toEqual(["trace", "needs_input"]);
  });

  it("turns a dropped connection into an error instead of hanging on 'Building…'", async () => {
    const seen: PlanEvent[] = [];
    const out = await readPlanStream(streamOf(['{"type":"trace","step":"a"}\n'], true), (e) => seen.push(e));
    expect(out).toBe("error");
    expect(seen.at(-1)).toMatchObject({ type: "error", code: "incomplete" });
  });

  it("turns a broken line or a missing final event into an error", async () => {
    const seen: PlanEvent[] = [];
    expect(await readPlanStream(streamOf(["{oops\n"]), (e) => seen.push(e))).toBe("error");
    expect(seen.at(-1)).toMatchObject({ code: "incomplete" });
    const seen2: PlanEvent[] = [];
    expect(await readPlanStream(streamOf(['{"type":"trace","step":"a"}\n']), (e) => seen2.push(e))).toBe("error");
    expect(seen2.at(-1)).toMatchObject({ code: "incomplete" });
  });
});

describe("production first screen without a key", () => {
  it("renders the not-configured page and no planner", async () => {
    const saved = { ...process.env };
    try {
      process.env.VERCEL_ENV = "production";
      delete process.env.QLOO_API_KEY;
      delete process.env.QLOO_MODE;
      const { default: Home } = await import("@/app/page");
      const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) } as Parameters<typeof Home>[0]));
      expect(html).toContain("This demo is not configured");
      expect(html).not.toContain("Build the four-week plan");
      expect(html).not.toContain("Sample data — not live Qloo");
    } finally {
      process.env = saved;
    }
  });
});
