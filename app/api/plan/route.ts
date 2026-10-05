// 계획 생성 API: 입력 검증·IP 한도 뒤 에이전트 진행 이벤트를 NDJSON으로 흘려보낸다
import { getModel } from "@/lib/llm";
import { runPlan } from "@/lib/plan/runner";
import { planInputSchema, type PlanEvent } from "@/lib/plan/types";
import { getQlooClient } from "@/lib/qloo/server";
import { clientIp, RateLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const limiter = new RateLimiter();

export async function POST(request: Request) {
  const qloo = getQlooClient();
  if (!qloo.ok) return Response.json({ code: "config", message: qloo.reason }, { status: 503 });

  const rate = limiter.check(clientIp(request.headers));
  if (!rate.allowed) {
    return Response.json(
      { code: "rate_limited", message: `Too many plans from this connection. Try again in ${rate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "bad_request", message: "Body must be JSON." }, { status: 400 });
  }
  const parsed = planInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ code: "bad_request", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }

  const llm = getModel();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: PlanEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      await runPlan(parsed.data, {
        client: qloo.client,
        model: llm?.model,
        modelName: llm?.name,
        emit,
        abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]),
      });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
