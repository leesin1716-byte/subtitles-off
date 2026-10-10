// 실제 Qloo 해커톤 API를 GET으로 부르는 클라이언트(초당 한도 준수, 재시도, 타임아웃, 오류 분류, 캐시)

import { TtlCache } from "./cache";
import { QlooError, classifyStatus } from "./errors";
import { assertInsightsParams, toQueryString } from "./params";
import { parseTags } from "./parse";
import type {
  EntityType,
  InsightsResponse,
  QlooClient,
  QlooTagResult,
  QueryParams,
  SearchResponse,
} from "./types";

export const DEFAULT_BASE_URL = "https://hackathon.api.qloo.com";

export interface HttpClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  cache?: TtlCache<unknown>;
  /** Request pacing; defaults to one gate shared by every client in this process. */
  gate?: RateGate;
}

/**
 * The hackathon host allows 5 requests per second per key (x-second-ratelimit-limit: 5, plus
 * x-month-ratelimit-limit: 10000; measured 10-11) and answers a burst with 429. A plan fans out
 * parallel calls, so requests start at most `perSecond` times in any rolling second. 4, not 5,
 * leaves a slot for the cron or a second function instance using the same key.
 */
export class RateGate {
  private starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly perSecond = 4,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Resolves when this request may start. Callers are served in order. */
  wait(): Promise<void> {
    const turn = this.queue.then(async () => {
      for (;;) {
        const t = this.now();
        this.starts = this.starts.filter((s) => t - s < 1000);
        if (this.starts.length < this.perSecond) {
          this.starts.push(t);
          return;
        }
        await this.sleep(1000 - (t - this.starts[0]) + 5);
      }
    });
    this.queue = turn;
    return turn;
  }
}

export const sharedGate = new RateGate();
/** Retries after a per-second 429 (the host's reset is under a second). */
const RATE_LIMIT_RETRIES = 2;

export class HttpQlooClient implements QlooClient {
  readonly mode = "live" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly gate: RateGate;
  private readonly cache: TtlCache<unknown>;

  constructor(private readonly opts: HttpClientOptions) {
    if (!opts.apiKey) throw new QlooError("auth", "Qloo API key is missing");
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.cache = opts.cache ?? new TtlCache();
    this.gate = opts.gate ?? sharedGate;
  }

  async search(query: string, types: EntityType[], take = 3): Promise<SearchResponse> {
    try {
      const res = await this.get<SearchResponse>("/search", { query, types, take });
      // Live /search gives the type only as `types: [...]` (no `subtype`, checked 10-11); the planner reads `subtype`.
      return { ...res, results: (res.results ?? []).map((e) => ({ ...e, subtype: e.subtype ?? e.types?.[0] ?? "" })) };
    } catch (e) {
      // /search may answer "no results" with a 404 body; treat it as an empty list.
      if (e instanceof QlooError && e.kind === "not_found") return { success: true, results: [] };
      throw e;
    }
  }

  async tags(params: QueryParams): Promise<QlooTagResult[]> {
    try {
      return parseTags(await this.get<unknown>("/v2/tags", params));
    } catch (e) {
      if (e instanceof QlooError && e.kind === "not_found") return [];
      throw e;
    }
  }

  async insights(params: QueryParams): Promise<InsightsResponse> {
    assertInsightsParams(params);
    try {
      return await this.get<InsightsResponse>("/v2/insights", params);
    } catch (e) {
      if (e instanceof QlooError && e.kind === "not_found") return { success: true, results: { entities: [] } };
      throw e;
    }
  }

  private async get<T>(path: string, params: QueryParams): Promise<T> {
    const url = `${this.baseUrl}${path}?${toQueryString(params)}`;
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached as T;

    let lastError: QlooError | undefined;
    let failures = 0;
    let rateLimited = 0;
    for (;;) {
      try {
        await this.gate.wait();
        const json = await this.once(url);
        this.cache.set(url, json);
        return json as T;
      } catch (e) {
        lastError = e instanceof QlooError ? e : new QlooError("network", String(e));
        if (lastError.kind === "rate_limited" && lastError.retryAfterMs !== undefined && rateLimited < RATE_LIMIT_RETRIES) {
          rateLimited++;
          await new Promise((r) => setTimeout(r, lastError!.retryAfterMs));
          continue;
        }
        if (!lastError.retryable || ++failures >= 2) throw lastError;
      }
    }
  }

  private async once(url: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        headers: { "X-Api-Key": this.opts.apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new QlooError("timeout", `Qloo did not answer within ${this.timeoutMs} ms`);
      }
      throw new QlooError("network", `Network error calling Qloo: ${(e as Error)?.message ?? e}`);
    }
    if (!res.ok) {
      let reason = res.statusText;
      try {
        // Observed on the hackathon host: {"error":{"reason":"No API key found in request","message":"Unauthorized","code":401}}
        type ErrBody = { reason?: string; message?: string; error_msg?: string };
        const body = (await res.json()) as ErrBody & { error?: string | ErrBody };
        const inner = typeof body.error === "object" ? body.error : undefined;
        reason = inner?.reason ?? inner?.message ?? body.reason ?? body.message ?? body.error_msg ?? (typeof body.error === "string" ? body.error : reason);
      } catch {
        /* non-JSON error body */
      }
      // Per-second 429: {"error_msg":"Rate limit exceeded"} with x-second-ratelimit-reset (seconds, under 1).
      // Only that one is retried; a 429 without it (or with the monthly quota at 0) is final.
      let retryAfterMs: number | undefined;
      const reset = Number(res.headers.get("x-second-ratelimit-reset") ?? NaN);
      if (res.status === 429 && Number.isFinite(reset) && res.headers.get("x-month-ratelimit-remaining") !== "0") {
        retryAfterMs = Math.min(2000, Math.max(250, reset * 1000 + 50));
      }
      throw new QlooError(classifyStatus(res.status), `Qloo ${res.status}: ${reason}`, res.status, retryAfterMs);
    }
    return res.json();
  }
}
