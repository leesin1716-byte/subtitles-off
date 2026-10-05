// 비교 패널: 일반 LLM이 내놓는 목록을 Qloo로 다시 채점해 계획 항목과 같은 잣대로 나란히 보인다

import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { BudgetedClient } from "../qloo/budget";
import type { QlooClient } from "../qloo/types";
import { LANGUAGES } from "./languages";
import { LANGUAGE_CODES, type LanguageCode } from "./types";

const idSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
export const compareInputSchema = z.object({
  language: z.enum(LANGUAGE_CODES),
  seeds: z.array(z.object({ entityId: idSchema, name: z.string().max(120) })).min(1).max(5),
  planItems: z
    .array(z.object({ entityId: idSchema, name: z.string().max(160), domain: z.enum(["tv_show", "movie"]) }))
    .min(1)
    .max(10),
});
export type CompareInput = z.infer<typeof compareInputSchema>;

/**
 * Without an LLM configured we show the picks a generic assistant typically gives for
 * "shows to learn X" — the global hits. Clearly labelled as canned in the UI.
 */
export const CANNED_BASELINE: Record<LanguageCode, string[]> = {
  ko: ["Squid Game", "Parasite", "Kingdom"],
  es: ["Money Heist", "Elite", "Pan's Labyrinth"],
  ja: ["Attack on Titan", "Spirited Away", "Your Name."],
  fr: ["Lupin", "Amélie", "The Intouchables"],
};

export interface ScoredItem {
  name: string;
  entityId?: string;
  affinity?: number;
  found: boolean;
}

export interface CompareResult {
  baselineSource: "llm" | "canned";
  baseline: ScoredItem[];
  grounded: ScoredItem[];
  baselineMean?: number;
  groundedMean?: number;
  calls: number;
}

const mean = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)) : undefined;
};

async function askGenericLlm(model: LanguageModel, input: CompareInput, abortSignal?: AbortSignal): Promise<string[]> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: z.object({ titles: z.array(z.string()).max(6) }) }),
    prompt: `Recommend 4 ${LANGUAGES[input.language].label}-language TV shows or films for someone learning ${LANGUAGES[input.language].label} who likes ${input.seeds
      .map((s) => s.name)
      .join(", ")}. Reply with English titles only.`,
    maxRetries: 1,
    abortSignal,
  });
  return output.titles.slice(0, 4);
}

export async function runCompare(
  input: CompareInput,
  deps: { client: QlooClient; model?: LanguageModel; abortSignal?: AbortSignal },
): Promise<CompareResult> {
  const client = new BudgetedClient(deps.client, 10);
  let titles: string[];
  let baselineSource: CompareResult["baselineSource"] = "canned";
  if (deps.model) {
    try {
      titles = await askGenericLlm(deps.model, input, deps.abortSignal);
      baselineSource = "llm";
    } catch {
      titles = CANNED_BASELINE[input.language];
    }
  } else {
    titles = CANNED_BASELINE[input.language];
  }

  // Resolve the generic titles to Qloo entities.
  type Resolved = { title: string; entityId?: string; name?: string; domain?: string };
  const resolved: Resolved[] = await Promise.all(
    titles.map(async (title): Promise<Resolved> => {
      const res = await client.search(title, ["urn:entity:tv_show", "urn:entity:movie"], 1);
      const e = res.results[0];
      return e ? { title, entityId: e.entity_id, name: e.name, domain: e.subtype.replace("urn:entity:", "") } : { title };
    }),
  );

  // Score both lists against the same seeds, one Insights call per domain.
  const seedIds = input.seeds.map((s) => s.entityId);
  const affinity = new Map<string, number>();
  for (const domain of ["tv_show", "movie"] as const) {
    const ids = [
      ...resolved.filter((r) => r.entityId && r.domain === domain).map((r) => r.entityId!),
      ...input.planItems.filter((p) => p.domain === domain).map((p) => p.entityId),
    ];
    if (!ids.length) continue;
    const res = await client.insights({
      "filter.type": `urn:entity:${domain}`,
      "filter.results.entities": [...new Set(ids)],
      "signal.interests.entities": seedIds,
      take: Math.min(50, ids.length),
    });
    for (const e of res.results.entities ?? []) if (e.query?.affinity !== undefined) affinity.set(e.entity_id, e.query.affinity);
  }

  const baseline: ScoredItem[] = resolved.map((r) =>
    r.entityId
      ? { name: r.name ?? r.title, entityId: r.entityId, affinity: affinity.get(r.entityId), found: true }
      : { name: r.title, found: false },
  );
  const grounded: ScoredItem[] = input.planItems.map((p) => ({
    name: p.name,
    entityId: p.entityId,
    affinity: affinity.get(p.entityId),
    found: true,
  }));
  return {
    baselineSource,
    baseline,
    grounded,
    baselineMean: mean(baseline.map((b) => b.affinity)),
    groundedMean: mean(grounded.map((g) => g.affinity)),
    calls: client.calls.length,
  };
}
