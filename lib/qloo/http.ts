// 실제 Qloo 해커톤 API를 GET으로 부르는 클라이언트(재시도 1회, 타임아웃, 오류 분류, 캐시)

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
}

export class HttpQlooClient implements QlooClient {
  readonly mode = "live" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: TtlCache<unknown>;

  constructor(private readonly opts: HttpClientOptions) {
    if (!opts.apiKey) throw new QlooError("auth", "Qloo API key is missing");
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.cache = opts.cache ?? new TtlCache();
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
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const json = await this.once(url);
        this.cache.set(url, json);
        return json as T;
      } catch (e) {
        lastError = e instanceof QlooError ? e : new QlooError("network", String(e));
        if (!lastError.retryable) throw lastError;
      }
    }
    throw lastError!;
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
        type ErrBody = { reason?: string; message?: string };
        const body = (await res.json()) as ErrBody & { error?: string | ErrBody };
        const inner = typeof body.error === "object" ? body.error : undefined;
        reason = inner?.reason ?? inner?.message ?? body.reason ?? body.message ?? (typeof body.error === "string" ? body.error : reason);
      } catch {
        /* non-JSON error body */
      }
      throw new QlooError(classifyStatus(res.status), `Qloo ${res.status}: ${reason}`, res.status);
    }
    return res.json();
  }
}
