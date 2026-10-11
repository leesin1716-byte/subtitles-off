// 환경변수로 Qloo 모드(live/mock)와 LLM 사용 여부를 정하는 설정 해석기

export type QlooMode = "live" | "mock";

export type ModeResolution =
  | { ok: true; mode: QlooMode }
  | { ok: false; reason: string };

type Env = Record<string, string | undefined>;

/**
 * - Production (VERCEL_ENV=production) must run on live Qloo. A missing key is an error,
 *   never a silent fallback to sample data.
 * - Elsewhere: QLOO_MODE wins; by default live when a key is present, otherwise mock.
 */
export function resolveQlooMode(env: Env): ModeResolution {
  const key = env.QLOO_API_KEY?.trim();
  const requested = env.QLOO_MODE?.trim().toLowerCase();
  const production = env.VERCEL_ENV === "production";

  if (production) {
    if (!key) return { ok: false, reason: "QLOO_API_KEY is not set on this production deployment." };
    if (requested === "mock") return { ok: false, reason: "Sample-data mode is disabled in production." };
    return { ok: true, mode: "live" };
  }
  if (requested === "mock") return { ok: true, mode: "mock" };
  if (requested === "live") {
    return key ? { ok: true, mode: "live" } : { ok: false, reason: "QLOO_MODE=live but QLOO_API_KEY is not set." };
  }
  return { ok: true, mode: key ? "live" : "mock" };
}

/**
 * On Vercel the AI Gateway authenticates with the OIDC token, which @vercel/oidc reads from the
 * `x-vercel-oidc-token` request header first and only then from process.env. The env var can be
 * absent at runtime, so running on Vercel (VERCEL=1) counts as "LLM available". If the gateway
 * still refuses, the runner falls back to the rule planner and says so in the plan note.
 */
export function llmEnabled(env: Env): boolean {
  if (env.LLM_MODE?.trim().toLowerCase() === "off") return false;
  return Boolean(env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim() || env.VERCEL === "1");
}

export function llmModelId(env: Env): string {
  return env.AI_MODEL?.trim() || "openai/gpt-4.1-mini";
}

/**
 * Claude through the Anthropic API takes the agent step when ANTHROPIC_API_KEY is set. When the key
 * stops working (expired credit, revoked key) the planner switches it off and falls back on its own.
 */
export function claudeEnabled(env: Env): boolean {
  if (env.LLM_MODE?.trim().toLowerCase() === "off") return false;
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

export function claudeModelId(env: Env): string {
  return env.CLAUDE_MODEL?.trim() || "claude-opus-5-5";
}

export type ClaudeEffort = "low" | "medium" | "high";

/** Effort is Claude Opus 5.5's depth and latency control; a planning step fits in "low". */
export function claudeEffort(env: Env): ClaudeEffort {
  const e = env.CLAUDE_EFFORT?.trim().toLowerCase();
  return e === "medium" || e === "high" ? e : "low";
}

/** New Claude-planned plans per server instance per UTC day; past it, plans use the next planner. */
export function claudeDailyPlanCap(env: Env): number {
  const n = Number(env.CLAUDE_DAILY_PLAN_CAP);
  return Number.isInteger(n) && n >= 0 && env.CLAUDE_DAILY_PLAN_CAP?.trim() ? n : 60;
}
