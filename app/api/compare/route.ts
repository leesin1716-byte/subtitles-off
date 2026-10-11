// 비교 패널 API: 일반 LLM 목록과 계획 항목을 같은 Qloo 시드로 다시 채점한다
import { getClaude, getModel } from "@/lib/llm";
import { compareInputSchema, runCompare } from "@/lib/plan/compare";
import { getQlooClient } from "@/lib/qloo/server";
import { clientIp, RateLimiter } from "@/lib/ratelimit";
import { toErrorEvent } from "@/lib/plan/runner";

export const runtime = "nodejs";
export const maxDuration = 30;

const limiter = new RateLimiter();

export async function POST(request: Request) {
  const qloo = getQlooClient();
  if (!qloo.ok) return Response.json({ code: "config", message: qloo.reason }, { status: 503 });
  const rate = limiter.check(clientIp(request.headers));
  if (!rate.allowed) {
    return Response.json({ code: "rate_limited", message: `Try again in ${rate.retryAfterSec}s.` }, { status: 429 });
  }
  const parsed = compareInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "bad_request", message: "Invalid comparison request." }, { status: 400 });
  const model = getModel()?.model;
  const claude = getClaude();
  // On live data the baseline must come from a real LLM; a canned list would be a straw man.
  if (!model && !claude && qloo.client.mode === "live") {
    return Response.json({ code: "no_llm", message: "The comparison needs an LLM, and none is configured on this deployment." }, { status: 409 });
  }
  try {
    const result = await runCompare(parsed.data, {
      client: qloo.client,
      model,
      claude,
      abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
    });
    return Response.json(result);
  } catch (e) {
    const err = toErrorEvent(e);
    return Response.json(err.type === "error" ? { code: err.code, message: err.message } : {}, { status: 502 });
  }
}
