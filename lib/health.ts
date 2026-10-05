// 매일 도는 상태 점검: Qloo 실호출 1회, LLM 설정 여부, 예시 계획 3개 예열 결과를 모아 돌려준다

import { llmEnabled, resolveQlooMode } from "./config";
import { warmPersonaPlans, type PlanDeps, type WarmStatus } from "./plan/handler";
import type { QlooClient } from "./qloo/types";

type Env = Record<string, string | undefined>;

export interface HealthReport {
  ok: boolean;
  mode: string;
  llm: "configured" | "off";
  qloo?: { ok: boolean; ms: number; detail: string };
  examples?: Record<string, WarmStatus>;
  checkedAt: string;
}

/** Deep checks call Qloo, so they need the cron secret. Without one set, only non-production allows them. */
export function deepCheckAllowed(headers: Headers, env: Env): boolean {
  const secret = env.CRON_SECRET?.trim();
  if (secret) return headers.get("authorization") === `Bearer ${secret}`;
  return env.VERCEL_ENV !== "production";
}

export async function runHealth(opts: {
  env: Env;
  deep: boolean;
  freshClient: () => { ok: true; client: QlooClient } | { ok: false; reason: string };
  planDeps: PlanDeps;
  now?: () => Date;
}): Promise<HealthReport> {
  const now = opts.now ?? (() => new Date());
  const mode = resolveQlooMode(opts.env);
  const report: HealthReport = {
    ok: mode.ok,
    mode: mode.ok ? mode.mode : `not configured: ${mode.reason}`,
    llm: llmEnabled(opts.env) ? "configured" : "off",
    checkedAt: now().toISOString(),
  };
  if (!opts.deep || !mode.ok) return report;

  const fresh = opts.freshClient();
  if (fresh.ok) {
    const started = Date.now();
    try {
      const r = await fresh.client.search("Stranger Things", ["urn:entity:tv_show"], 1);
      report.qloo = { ok: r.results.length > 0, ms: Date.now() - started, detail: r.results[0]?.name ?? "no results" };
    } catch (e) {
      report.qloo = { ok: false, ms: Date.now() - started, detail: e instanceof Error ? e.message.slice(0, 200) : String(e) };
    }
  }
  report.examples = await warmPersonaPlans(opts.planDeps);
  report.ok = Boolean(report.qloo?.ok) && Object.values(report.examples).every((s) => !s.startsWith("failed"));
  return report;
}
