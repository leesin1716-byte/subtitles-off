// 서버 전용 LLM 모델 팩토리(Vercel AI Gateway, 키가 없으면 규칙 기반 플래너만 쓴다)
import "server-only";

import { gateway, type LanguageModel } from "ai";
import { llmEnabled, llmModelId } from "./config";

export function getModel(env: Record<string, string | undefined> = process.env): { model: LanguageModel; name: string } | undefined {
  if (!llmEnabled(env)) return undefined;
  const name = llmModelId(env);
  return { model: gateway(name), name };
}
