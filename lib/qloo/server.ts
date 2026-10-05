// 서버 전용 Qloo 클라이언트 팩토리(키는 서버 환경변수에서만 읽는다)
import "server-only";

import { resolveQlooMode } from "../config";
import { TtlCache } from "./cache";
import { HttpQlooClient } from "./http";
import { MockQlooClient } from "./mock";
import type { QlooClient } from "./types";

// Module-level so warm serverless instances reuse cached Qloo answers across requests.
const sharedCache = new TtlCache<unknown>();
let cachedClient: QlooClient | undefined;

export type ClientResult = { ok: true; client: QlooClient } | { ok: false; reason: string };

export function getQlooClient(env: Record<string, string | undefined> = process.env): ClientResult {
  const resolved = resolveQlooMode(env);
  if (!resolved.ok) return resolved;
  if (cachedClient && cachedClient.mode === resolved.mode) return { ok: true, client: cachedClient };
  cachedClient =
    resolved.mode === "live"
      ? new HttpQlooClient({ apiKey: env.QLOO_API_KEY!.trim(), baseUrl: env.QLOO_BASE_URL, cache: sharedCache })
      : new MockQlooClient();
  return { ok: true, client: cachedClient };
}
