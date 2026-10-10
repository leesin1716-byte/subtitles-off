// 실제 API 클라이언트의 URL·헤더·재시도·오류 분류·캐시를 가짜 fetch로 검증하는 테스트
import { describe, expect, it, vi } from "vitest";
import { HttpQlooClient, RateGate } from "@/lib/qloo/http";
import { QlooError } from "@/lib/qloo/errors";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof HttpQlooClient>[0]> = {}) {
  return new HttpQlooClient({ apiKey: "test-key", fetchImpl, ...extra });
}

describe("HttpQlooClient", () => {
  it("calls the hackathon host with GET, X-Api-Key and a sorted query string", async () => {
    const fetchImpl = vi.fn(async () => json(200, { success: true, results: { entities: [] } }));
    await client(fetchImpl as unknown as typeof fetch).insights({
      "filter.type": "urn:entity:movie",
      "signal.interests.entities": ["e1", "e2"],
      take: 10,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://hackathon.api.qloo.com/v2/insights?filter.type=urn%3Aentity%3Amovie&signal.interests.entities=e1%2Ce2&take=10",
    );
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
  });

  it("validates parameters before spending a request", async () => {
    const fetchImpl = vi.fn();
    await expect(
      client(fetchImpl as unknown as typeof fetch).insights({
        "filter.type": "urn:entity:artist",
        "filter.release_country": ["Japan"],
      }),
    ).rejects.toMatchObject({ kind: "invalid_params" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, "auth"],
    [403, "unsupported_type"],
    [400, "bad_request"],
    [429, "rate_limited"],
  ])("maps HTTP %i to %s without retrying", async (status, kind) => {
    const fetchImpl = vi.fn(async () => json(status, { code: status, reason: "nope" }));
    const err = await client(fetchImpl as unknown as typeof fetch)
      .insights({ "filter.type": "urn:entity:movie", "filter.tags": ["t"] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(QlooError);
    expect(err.kind).toBe(kind);
    expect(err.message).toContain("nope");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("waits out a per-second 429 (as the host sends it) and retries", async () => {
    const limited = () =>
      new Response(JSON.stringify({ error_msg: "Rate limit exceeded" }), {
        status: 429,
        headers: { "x-second-ratelimit-limit": "5", "x-second-ratelimit-remaining": "0", "x-second-ratelimit-reset": "0.3" },
      });
    const fetchImpl = vi.fn().mockImplementationOnce(async () => limited()).mockImplementationOnce(async () => json(200, { success: true, results: [] }));
    const t = Date.now();
    await client(fetchImpl as unknown as typeof fetch).search("x", []);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(Date.now() - t).toBeGreaterThanOrEqual(300);

    const always = vi.fn(async () => limited());
    const err = await client(always as unknown as typeof fetch).search("y", []).catch((e) => e);
    expect(err).toMatchObject({ kind: "rate_limited", message: "Qloo 429: Rate limit exceeded" });
    expect(always).toHaveBeenCalledTimes(3); // first try + 2 retries
  });

  it("does not retry a 429 once the monthly quota is spent", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error_msg: "Rate limit exceeded" }), {
        status: 429,
        headers: { "x-second-ratelimit-reset": "0.3", "x-month-ratelimit-remaining": "0" },
      }),
    );
    const err = await client(fetchImpl as unknown as typeof fetch).search("z", []).catch((e) => e);
    expect(err.kind).toBe("rate_limited");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("starts at most four requests in any second, in order", async () => {
    let now = 0;
    const gate = new RateGate(4, () => now, async (ms) => void (now += ms));
    const started: number[] = [];
    await Promise.all(Array.from({ length: 9 }, () => gate.wait().then(() => started.push(now))));
    expect(started.slice(0, 4).every((t) => t === 0)).toBe(true);
    for (let i = 4; i < started.length; i++) expect(started[i] - started[i - 4]).toBeGreaterThanOrEqual(1000);
  });

  it("reads the nested error body the hackathon host actually returns", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: { reason: "No API key found in request", message: "Unauthorized", code: 401 } }));
    const err = await client(fetchImpl as unknown as typeof fetch).search("x", []).catch((e) => e);
    expect(err).toMatchObject({ kind: "auth", status: 401 });
    expect(err.message).toBe("Qloo 401: No API key found in request");
  });

  it("treats a 404 from /search as an empty result", async () => {
    const fetchImpl = vi.fn(async () => json(404, { code: 404, reason: "No results" }));
    const res = await client(fetchImpl as unknown as typeof fetch).search("zzzz", ["urn:entity:movie"]);
    expect(res).toEqual({ success: true, results: [] });
  });

  it("retries exactly once on a 5xx and then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(502, { reason: "bad gateway" }))
      .mockResolvedValueOnce(json(200, { success: true, results: [] }));
    const res = await client(fetchImpl as unknown as typeof fetch).search("x", ["urn:entity:movie"]);
    expect(res.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry on repeated server errors", async () => {
    const fetchImpl = vi.fn(async () => json(500, { reason: "boom" }));
    await expect(client(fetchImpl as unknown as typeof fetch).search("x", [])).rejects.toMatchObject({ kind: "server" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports a timeout as kind=timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error("timed out");
      e.name = "TimeoutError";
      throw e;
    });
    await expect(client(fetchImpl as unknown as typeof fetch).search("x", [])).rejects.toMatchObject({ kind: "timeout" });
  });

  it("serves an identical request from cache", async () => {
    const fetchImpl = vi.fn(async () => json(200, { success: true, results: [] }));
    const c = client(fetchImpl as unknown as typeof fetch);
    await c.search("Minecraft", ["urn:entity:videogame"]);
    await c.search("Minecraft", ["urn:entity:videogame"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("parses /v2/tags with either id or tag_id", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { success: true, results: { tags: [{ tag_id: "urn:tag:a", name: "A" }, { id: "urn:tag:b", name: "B" }] } }),
    );
    const tags = await client(fetchImpl as unknown as typeof fetch).tags({ "filter.query": "k-pop" });
    expect(tags.map((t) => t.id)).toEqual(["urn:tag:a", "urn:tag:b"]);
  });

  it("refuses to start without a key", () => {
    expect(() => new HttpQlooClient({ apiKey: "" })).toThrow(QlooError);
  });
});
