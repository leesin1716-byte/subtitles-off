// Qloo 호출 오류를 상태 코드별로 분류하는 오류 클래스

export type QlooErrorKind =
  | "auth" // 401: bad key or wrong base URL
  | "unsupported_type" // 403: entity type not enabled for this key
  | "bad_request" // 400: e.g. "at least one valid signal or filter is required"
  | "not_found" // 404: no results
  | "rate_limited" // 429
  | "server" // 5xx
  | "timeout"
  | "network"
  | "invalid_params" // caught locally before sending (unsupported parameter for the type)
  | "budget_exceeded"; // per-plan call budget used up

export class QlooError extends Error {
  constructor(
    public readonly kind: QlooErrorKind,
    message: string,
    public readonly status?: number,
    /** 429 only: how long the host says to wait (x-second-ratelimit-reset). Absent when the monthly quota is used up. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "QlooError";
  }

  get retryable(): boolean {
    return this.kind === "server" || this.kind === "timeout" || this.kind === "network";
  }
}

export function classifyStatus(status: number): QlooErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "unsupported_type";
  if (status === 400) return "bad_request";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "server";
}
