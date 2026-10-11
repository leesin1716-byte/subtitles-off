// 서버 전용 LLM 팩토리(Claude는 Anthropic API 키, 그 밖은 Vercel AI Gateway, 둘 다 없으면 규칙 기반 플래너만 쓴다)
import "server-only";

import { appendFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { gateway, type LanguageModel } from "ai";
import { claudeDailyPlanCap, claudeEffort, claudeEnabled, claudeModelId, llmEnabled, llmModelId } from "./config";
import type { ClaudeAgent, ClaudeUsage } from "./plan/claude-agent";

type Env = Record<string, string | undefined>;

export function getModel(env: Env = process.env): { model: LanguageModel; name: string } | undefined {
  if (!llmEnabled(env)) return undefined;
  const name = llmModelId(env);
  return { model: gateway(name), name };
}

let claude: { key: string; agent: ClaudeAgent } | undefined;

/** Token counts of every Claude request go to the server log; CLAUDE_USAGE_LOG also appends them as JSONL. */
function logUsage(env: Env) {
  const file = env.CLAUDE_USAGE_LOG?.trim();
  return (u: ClaudeUsage) => {
    const t = u.usage;
    console.info(
      `[claude] ${u.purpose} ${u.model} in=${t.input_tokens} out=${t.output_tokens} cache_w=${t.cache_creation_input_tokens} cache_r=${t.cache_read_input_tokens} ${u.ms}ms stop=${u.stopReason}`,
    );
    if (!file) return;
    try {
      appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...u })}\n`);
    } catch (e) {
      // A log that cannot be written (read-only disk) must not fail a plan Claude already answered.
      console.warn(`[claude] usage log not written: ${(e as Error).message}`);
    }
  };
}

export function getClaude(env: Env = process.env): ClaudeAgent | undefined {
  if (!claudeEnabled(env)) return undefined;
  const key = env.ANTHROPIC_API_KEY!.trim();
  if (claude?.key !== key) {
    claude = {
      key,
      agent: {
        // The planner's own time limit is the real bound; this only stops a hung connection.
        messages: new Anthropic({ apiKey: key, timeout: 30_000 }).beta.messages,
        model: claudeModelId(env),
        effort: claudeEffort(env),
        dailyCap: claudeDailyPlanCap(env),
        onUsage: logUsage(env),
      },
    };
  }
  return claude.agent;
}
