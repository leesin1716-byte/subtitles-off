// 서버 전용 계획 캐시 저장소(Vercel Runtime Cache, 로컬에서는 메모리로 대체된다)
import "server-only";

import { getCache } from "@vercel/functions";
import type { PlanStore } from "./plan-cache";

export function getPlanStore(): PlanStore {
  return getCache({ namespace: "subtitles-off" });
}
