// Claude 실호출 점검: 실제 Qloo 데이터로 예시 계획을 Claude 가 짜고, 비교 기준선도 Claude 에게 묻는다(키 둘 다 있을 때만, 비용 발생)
import { appendFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { claudeEffort, claudeModelId } from "@/lib/config";
import { claudeOffReason, type ClaudeAgent } from "@/lib/plan/claude-agent";
import { runCompare } from "@/lib/plan/compare";
import { PERSONAS } from "@/lib/plan/personas";
import { runPlan } from "@/lib/plan/runner";
import type { Plan, PlanEvent } from "@/lib/plan/types";
import { DEFAULT_BASE_URL, HttpQlooClient } from "@/lib/qloo/http";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* no local env file: rely on the shell */
}
const qlooKey = process.env.QLOO_API_KEY?.trim();
const claudeKey = process.env.ANTHROPIC_API_KEY?.trim();
const base = (process.env.QLOO_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
const usageLog = process.env.CLAUDE_USAGE_LOG?.trim();

const sdk = () => new Anthropic({ apiKey: claudeKey!, timeout: 30_000 }).beta.messages;
/** Prints what each tool returned to Claude (shortened), so a wrong turn can be traced to its input. */
const showingToolResults = (api: ReturnType<typeof sdk>): ClaudeAgent["messages"] => ({
  create(body, options) {
    const last = body.messages[body.messages.length - 1];
    if (Array.isArray(last.content)) {
      for (const b of last.content) if (b.type === "tool_result") console.log(`[tool_result${b.is_error ? " ERROR" : ""}] ${String(b.content).slice(0, 220)}`);
    }
    return api.create(body, options);
  },
});

const agent = (): ClaudeAgent => ({
  messages: showingToolResults(sdk()),
  model: claudeModelId(process.env),
  effort: claudeEffort(process.env),
  dailyCap: 100,
  onUsage: (u) => {
    console.log(`[usage] ${u.purpose} ${u.model} in=${u.usage.input_tokens} out=${u.usage.output_tokens} cache_r=${u.usage.cache_read_input_tokens} ${u.ms}ms stop=${u.stopReason}`);
    if (usageLog) appendFileSync(usageLog, `${JSON.stringify({ at: new Date().toISOString(), ...u })}\n`);
  },
});

async function plan(i: number, claude: ClaudeAgent) {
  const events: PlanEvent[] = [];
  const t0 = Date.now();
  // Sam's unpinned "The Office" stops on a question; answer it with Qloo's first match like the cron does.
  const input = PERSONAS[i].id === "sam" ? await answered(i) : PERSONAS[i].input;
  await runPlan(input, {
    client: new HttpQlooClient({ apiKey: qlooKey!, baseUrl: base }),
    claude,
    emit: (e) => {
      if (e.type === "trace") e.detail = `${e.detail ? `${e.detail} ` : ""}[+${((Date.now() - t0) / 1000).toFixed(1)} s]`;
      events.push(e);
    },
  });
  const p = (events.find((e) => e.type === "plan") as { plan: Plan } | undefined)?.plan;
  console.log(
    `\n[${PERSONAS[i].id}] ${((Date.now() - t0) / 1000).toFixed(1)} s, planner=${p?.planner}\n${p?.plannerNote}\n` +
      events
        .filter((e) => e.type === "trace")
        .map((e) => (e.type === "trace" ? `  · ${e.step}${e.detail ? ` — ${e.detail}` : ""}` : ""))
        .join("\n") +
      "\n" +
      (p?.weeks.flatMap((w) => w.items.map((it) => `  W${w.week} ${it.domain} ${it.name}${it.note ? ` — ${it.note}` : ""}`)).join("\n") ?? ""),
  );
  return { plan: p, events };
}

/** Sam's input with the clarifying question answered by Qloo's first option (as the daily warm-up does). */
async function answered(i: number) {
  const events: PlanEvent[] = [];
  await runPlan(PERSONAS[i].input, { client: new HttpQlooClient({ apiKey: qlooKey!, baseUrl: base }), emit: (e) => events.push(e), callBudget: 6 });
  const q = events.find((e) => e.type === "needs_input");
  const picked = q && q.type === "needs_input" ? Object.fromEntries(q.questions.map((x) => [x.favorite, x.options[0].entityId])) : {};
  return { ...PERSONAS[i].input, choices: { ...PERSONAS[i].input.choices, ...picked } };
}

describe.skipIf(!qlooKey || !claudeKey)("live Claude planner", () => {
  const claude = agent();

  for (const i of [0, 1, 2]) {
    it(`${PERSONAS[i].id}: Claude plans from live Qloo results`, async () => {
      const { plan: p } = await plan(i, claude);
      expect(claudeOffReason()).toBeNull();
      expect(p).toBeDefined();
      expect(p!.planner).toBe("llm");
      expect(p!.plannerNote).toMatch(/^Claude agent/);
      const items = p!.weeks.flatMap((w) => w.items);
      expect(items.length).toBeGreaterThanOrEqual(6);
      // reasons are short English sentences (the validator enforced it); no emoji or markup
      for (const it of items) if (it.note) expect(it.note).not.toMatch(/[*#`]|\p{Extended_Pictographic}/u);
    }, 120_000);
  }

  it("compare: the same Claude without Qloo gives the baseline list", async () => {
    const r = await runCompare(
      {
        language: "ko",
        seeds: [
          { entityId: "07F1170E-BB69-4982-82C6-255F477EBBAD", name: "Stranger Things" },
          { entityId: "CDBDE254-71F0-4640-8D04-5373BEAE5278", name: "Minecraft" },
        ],
        planItems: [{ entityId: "07F1170E-BB69-4982-82C6-255F477EBBAD", name: "Stranger Things", domain: "tv_show" }],
      },
      { client: new HttpQlooClient({ apiKey: qlooKey!, baseUrl: base }), claude },
    );
    console.log(`\n[compare] source=${r.baselineSource} baseline=${r.baseline.map((b) => b.asked ?? b.name).join(" | ")} stats=${JSON.stringify(r.baselineStats)}`);
    expect(r.baselineSource).toBe("llm");
    expect(r.baseline.length).toBeGreaterThan(0);
  }, 90_000);
});

describe.runIf(!qlooKey || !claudeKey)("live Claude planner", () => {
  it("skipped: set QLOO_API_KEY and ANTHROPIC_API_KEY to run (costs API credit)", () => {});
});
