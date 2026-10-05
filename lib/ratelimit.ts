// IP당 분·일 요청 한도(서버리스 인스턴스 메모리 기준, 최선 노력)

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

export const DEFAULT_RULES: RateLimitRule[] = [
  { windowMs: 60_000, max: 6 },
  { windowMs: 24 * 60 * 60_000, max: 200 },
];

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly rules: RateLimitRule[] = DEFAULT_RULES,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and returns whether it is allowed, plus seconds to wait when it is not. */
  check(key: string): { allowed: boolean; retryAfterSec: number } {
    const t = this.now();
    const longest = Math.max(...this.rules.map((r) => r.windowMs));
    const list = (this.hits.get(key) ?? []).filter((x) => x > t - longest);
    for (const rule of this.rules) {
      const inWindow = list.filter((x) => x > t - rule.windowMs);
      if (inWindow.length >= rule.max) {
        this.hits.set(key, list);
        return { allowed: false, retryAfterSec: Math.ceil((inWindow[0] + rule.windowMs - t) / 1000) };
      }
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.hits.delete(this.hits.keys().next().value as string);
    return { allowed: true, retryAfterSec: 0 };
  }
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
