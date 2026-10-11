// 비교 패널: 일반 LLM이 내놓는 목록을 Qloo로 다시 채점해 계획 항목과 같은 잣대로 나란히 보인다

import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { BudgetedClient } from "../qloo/budget";
import { extractContributions } from "../qloo/parse";
import type { QlooClient, QlooEntity } from "../qloo/types";
import { releaseCountries } from "./tools";
import { askGenericClaude, claudeOffReason, type ClaudeAgent } from "./claude-agent";
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
  /** Name of the Qloo entity the title resolved to (or the asked title when not found). */
  name: string;
  /** The title as the generic list gave it, when it differs from the resolved name. */
  asked?: string;
  year?: number;
  entityId?: string;
  affinity?: number;
  popularity?: number;
  inLanguage?: boolean;
  because?: string;
  found: boolean;
}

/** Four measures per list. Only `affinity` is the score the plan was picked by; the others are independent of it. */
export interface ListStats {
  affinity?: number;
  /** Mean Qloo popularity percentile (0–1): high means global hits. */
  popularity?: number;
  /** Share of items released in a country that speaks the target language. */
  languageMatch?: number;
  /** How many of the favorites Qloo's explainability credits for at least one item. */
  favoritesCovered: number;
}

export interface CompareResult {
  baselineSource: "llm" | "canned";
  baseline: ScoredItem[];
  grounded: ScoredItem[];
  baselineStats: ListStats;
  groundedStats: ListStats;
  seedCount: number;
  calls: number;
}

const mean = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)) : undefined;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/** What a generic assistant is asked: the same request, with no taste data behind it. */
export const genericPrompt = (input: CompareInput) =>
  `Recommend 4 ${LANGUAGES[input.language].label}-language TV shows or films for someone learning ${LANGUAGES[input.language].label} who likes ${input.seeds
    .map((s) => s.name)
    .join(", ")}. Reply with English titles only.`;

async function askGenericLlm(model: LanguageModel, input: CompareInput, abortSignal?: AbortSignal): Promise<string[]> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: z.object({ titles: z.array(z.string()).max(6) }) }),
    prompt: genericPrompt(input),
    maxRetries: 1,
    abortSignal,
  });
  return output.titles.slice(0, 4);
}

/**
 * Picks the search hit a person most likely meant: an exact title from a country of the
 * language first, then any hit from such a country, then an exact title, then Qloo's first hit.
 * ("Kingdom" should be the Korean series, not a same-named film from elsewhere.)
 */
export function pickSearchHit(title: string, hits: QlooEntity[], countries: string[]): QlooEntity | undefined {
  const fromLang = (e: QlooEntity) => releaseCountries(e).some((c) => countries.includes(c));
  const exact = (e: QlooEntity) => norm(e.name) === norm(title);
  return hits.find((e) => exact(e) && fromLang(e)) ?? hits.find(fromLang) ?? hits.find(exact) ?? hits[0];
}

export async function runCompare(
  input: CompareInput,
  deps: { client: QlooClient; model?: LanguageModel; claude?: ClaudeAgent; abortSignal?: AbortSignal },
): Promise<CompareResult> {
  const client = new BudgetedClient(deps.client, 10);
  const profile = LANGUAGES[input.language];
  const countries = [...profile.countries, ...profile.widenCountries];
  let titles: string[] | undefined;
  let baselineSource: CompareResult["baselineSource"] = "canned";
  // Claude first (the same model that planned, now without Qloo), then the gateway model, then the canned list.
  if (deps.claude && !claudeOffReason()) {
    titles = await askGenericClaude(deps.claude, genericPrompt(input), deps.abortSignal).catch(() => undefined);
  }
  if (!titles && deps.model) {
    titles = await askGenericLlm(deps.model, input, deps.abortSignal).catch(() => undefined);
  }
  if (titles) baselineSource = "llm";
  else titles = CANNED_BASELINE[input.language];

  // Resolve the generic titles to Qloo entities (three hits each, so the right "Kingdom" can be chosen).
  type Resolved = { title: string; entity?: QlooEntity };
  const resolved: Resolved[] = await Promise.all(
    titles.map(async (title): Promise<Resolved> => {
      const res = await client.search(title, ["urn:entity:tv_show", "urn:entity:movie"], 3);
      return { title, entity: pickSearchHit(title, res.results, countries) };
    }),
  );

  // Score both lists against the same seeds, one Insights call per domain, with explainability.
  const seedIds = input.seeds.map((s) => s.entityId);
  const seedName = new Map(input.seeds.map((s) => [s.entityId, s.name]));
  const scored = new Map<string, QlooEntity>();
  for (const domain of ["tv_show", "movie"] as const) {
    const ids = [
      ...resolved.filter((r) => r.entity && r.entity.subtype === `urn:entity:${domain}`).map((r) => r.entity!.entity_id),
      ...input.planItems.filter((p) => p.domain === domain).map((p) => p.entityId),
    ];
    if (!ids.length) continue;
    const res = await client.insights({
      "filter.type": `urn:entity:${domain}`,
      "filter.results.entities": [...new Set(ids)],
      "signal.interests.entities": seedIds,
      "feature.explainability": true,
      take: Math.min(50, ids.length),
    });
    for (const e of res.results.entities ?? []) scored.set(e.entity_id, e);
  }

  const toItem = (id: string, fallback: QlooEntity | undefined, name: string, asked?: string): ScoredItem => {
    const e = scored.get(id) ?? fallback;
    const top = e ? extractContributions(e)[0] : undefined;
    const rc = e ? releaseCountries(e) : [];
    return {
      name,
      ...(asked && norm(asked) !== norm(name) ? { asked } : {}),
      year: e?.properties?.release_year,
      entityId: id,
      affinity: scored.get(id)?.query?.affinity,
      popularity: e?.popularity,
      inLanguage: rc.length ? rc.some((c) => countries.includes(c)) : undefined,
      because: top ? seedName.get(top.entityId) : undefined,
      found: true,
    };
  };

  const baseline: ScoredItem[] = resolved.map((r) =>
    r.entity ? toItem(r.entity.entity_id, r.entity, r.entity.name, r.title) : { name: r.title, found: false },
  );
  const grounded: ScoredItem[] = input.planItems.map((p) => toItem(p.entityId, undefined, p.name));
  return {
    baselineSource,
    baseline,
    grounded,
    baselineStats: stats(baseline),
    groundedStats: stats(grounded),
    seedCount: input.seeds.length,
    calls: client.calls.length,
  };
}

function stats(items: ScoredItem[]): ListStats {
  const known = items.filter((i) => i.inLanguage !== undefined);
  return {
    affinity: mean(items.map((i) => i.affinity)),
    popularity: mean(items.map((i) => i.popularity)),
    languageMatch: known.length ? Number((known.filter((i) => i.inLanguage).length / known.length).toFixed(3)) : undefined,
    favoritesCovered: new Set(items.map((i) => i.because).filter(Boolean)).size,
  };
}
