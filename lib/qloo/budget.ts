// 계획 1건당 Qloo 호출 수를 제한하고 호출 기록(provenance)을 남기는 래퍼 클라이언트

import { QlooError } from "./errors";
import type { EntityType, QlooClient, QueryParams } from "./types";

export const PLAN_CALL_BUDGET = 18;

export interface CallRecord {
  n: number;
  endpoint: "/search" | "/v2/tags" | "/v2/insights";
  params: QueryParams;
  ms: number;
  resultCount: number;
}

export class BudgetedClient implements QlooClient {
  private used = 0;
  readonly calls: CallRecord[] = [];

  constructor(
    private readonly inner: QlooClient,
    private readonly limit = PLAN_CALL_BUDGET,
    private readonly onCall?: (record: CallRecord) => void,
  ) {}

  get mode() {
    return this.inner.mode;
  }

  get remaining(): number {
    return this.limit - this.used;
  }

  async search(query: string, types: EntityType[], take = 3) {
    return this.track("/search", { query, types, take }, () => this.inner.search(query, types, take), (r) => r.results.length);
  }

  async tags(params: QueryParams) {
    return this.track("/v2/tags", params, () => this.inner.tags(params), (r) => r.length);
  }

  async insights(params: QueryParams) {
    return this.track(
      "/v2/insights",
      params,
      () => this.inner.insights(params),
      (r) => (r.results.entities ?? r.results.tags ?? []).length,
    );
  }

  private async track<T>(
    endpoint: CallRecord["endpoint"],
    params: QueryParams,
    fn: () => Promise<T>,
    count: (r: T) => number,
  ): Promise<T> {
    if (this.used >= this.limit) {
      throw new QlooError("budget_exceeded", `Qloo call budget of ${this.limit} per plan is used up`);
    }
    const n = ++this.used;
    const started = Date.now();
    const result = await fn();
    const record: CallRecord = { n, endpoint, params, ms: Date.now() - started, resultCount: count(result) };
    this.calls.push(record);
    this.onCall?.(record);
    return result;
  }
}
