// 호출 예산·캐시·모드 설정 테스트
import { describe, expect, it } from "vitest";
import { BudgetedClient } from "@/lib/qloo/budget";
import { TtlCache } from "@/lib/qloo/cache";
import { MockQlooClient } from "@/lib/qloo/mock";
import { llmEnabled, resolveQlooMode } from "@/lib/config";

describe("BudgetedClient", () => {
  it("stops at the per-plan budget and records provenance", async () => {
    const seen: string[] = [];
    const c = new BudgetedClient(new MockQlooClient(), 3, (r) => seen.push(`${r.n}:${r.endpoint}`));
    await c.search("Minecraft", []);
    await c.tags({ "filter.query": "pop" });
    await c.insights({ "filter.type": "urn:entity:artist", "signal.interests.entities": ["mock-minecraft"] });
    await expect(c.search("again", [])).rejects.toMatchObject({ kind: "budget_exceeded" });
    expect(seen).toEqual(["1:/search", "2:/v2/tags", "3:/v2/insights"]);
    expect(c.remaining).toBe(0);
  });
});

describe("TtlCache", () => {
  it("expires entries after the TTL and evicts the oldest beyond capacity", () => {
    let t = 0;
    const cache = new TtlCache<number>(100, 2, () => t);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // a becomes most recent
    cache.set("c", 3); // evicts b
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    t = 150;
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("resolveQlooMode", () => {
  it("defaults to live with a key and mock without one (non-production)", () => {
    expect(resolveQlooMode({ QLOO_API_KEY: "k" })).toEqual({ ok: true, mode: "live" });
    expect(resolveQlooMode({})).toEqual({ ok: true, mode: "mock" });
  });
  it("honours QLOO_MODE outside production", () => {
    expect(resolveQlooMode({ QLOO_API_KEY: "k", QLOO_MODE: "mock" })).toEqual({ ok: true, mode: "mock" });
    expect(resolveQlooMode({ QLOO_MODE: "live" }).ok).toBe(false);
  });
  it("never falls back to sample data in production", () => {
    expect(resolveQlooMode({ VERCEL_ENV: "production" }).ok).toBe(false);
    expect(resolveQlooMode({ VERCEL_ENV: "production", QLOO_API_KEY: "k", QLOO_MODE: "mock" }).ok).toBe(false);
    expect(resolveQlooMode({ VERCEL_ENV: "production", QLOO_API_KEY: "k" })).toEqual({ ok: true, mode: "live" });
  });
});

describe("llmEnabled", () => {
  it("needs a gateway credential and respects LLM_MODE=off", () => {
    expect(llmEnabled({})).toBe(false);
    expect(llmEnabled({ AI_GATEWAY_API_KEY: "x" })).toBe(true);
    expect(llmEnabled({ VERCEL_OIDC_TOKEN: "x" })).toBe(true);
    // on Vercel the OIDC token may arrive only as a request header
    expect(llmEnabled({ VERCEL: "1" })).toBe(true);
    expect(llmEnabled({ VERCEL: "1", LLM_MODE: "off" })).toBe(false);
    expect(llmEnabled({ AI_GATEWAY_API_KEY: "x", LLM_MODE: "off" })).toBe(false);
  });
});
