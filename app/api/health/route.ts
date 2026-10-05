// 상태 점검 API: 공개 호출은 설정만 보고, 크론 비밀값이 맞으면 Qloo 실호출과 예시 계획 예열까지 한다
import { getModel } from "@/lib/llm";
import { deepCheckAllowed, runHealth } from "@/lib/health";
import { getPlanStore } from "@/lib/plan/plan-store";
import { getQlooClient, getUncachedQlooClient } from "@/lib/qloo/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const deep = deepCheckAllowed(request.headers, process.env);
  const report = await runHealth({
    env: process.env,
    deep,
    freshClient: getUncachedQlooClient,
    planDeps: { getClient: getQlooClient, getModel, store: getPlanStore() },
  });
  // A failing deep check shows up in the runtime logs, where the daily cron result can be read.
  if (deep && !report.ok) console.error("HEALTH FAIL", JSON.stringify(report));
  return Response.json(report, { status: report.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
