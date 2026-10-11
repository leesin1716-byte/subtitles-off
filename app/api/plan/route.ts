// 계획 생성 API: 설정 확인·입력 검증·캐시 재생·IP 한도 뒤 에이전트 진행 이벤트를 NDJSON으로 흘려보낸다
import { getClaude, getModel } from "@/lib/llm";
import { handlePlanRequest } from "@/lib/plan/handler";
import { getPlanStore } from "@/lib/plan/plan-store";
import { getQlooClient } from "@/lib/qloo/server";
import { RateLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const limiter = new RateLimiter();

export async function POST(request: Request) {
  return handlePlanRequest(request, { getClient: getQlooClient, getModel, getClaude, store: getPlanStore(), limiter });
}
