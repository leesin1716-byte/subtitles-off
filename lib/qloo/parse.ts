// 문서에 예시가 없는 응답 필드(태그 목록, explainability)를 방어적으로 읽는 파서

import type { QlooEntity, QlooTagResult } from "./types";

/**
 * /v2/tags has no documented response example. Accept `results.tags`, `results` (array) or `tags`,
 * and per item either `id` or `tag_id`. To be pinned down on the first day with a real key.
 */
export function parseTags(json: unknown): QlooTagResult[] {
  const j = json as Record<string, unknown> | null;
  const results = j?.results as Record<string, unknown> | unknown[] | undefined;
  const list: unknown[] = Array.isArray(results)
    ? results
    : Array.isArray((results as Record<string, unknown> | undefined)?.tags)
      ? ((results as Record<string, unknown>).tags as unknown[])
      : Array.isArray(j?.tags)
        ? (j!.tags as unknown[])
        : [];
  const out: QlooTagResult[] = [];
  for (const raw of list) {
    const t = raw as Record<string, unknown>;
    const id = (t.id ?? t.tag_id) as string | undefined;
    if (!id || typeof id !== "string") continue;
    out.push({
      id,
      name: typeof t.name === "string" ? t.name : id,
      types: Array.isArray(t.types) ? (t.types as string[]) : typeof t.type === "string" ? [t.type] : undefined,
      subtype: typeof t.subtype === "string" ? t.subtype : undefined,
    });
  }
  return out;
}

export interface Contribution {
  entityId: string;
  score: number;
}

/**
 * Per-result explainability: "which input entities contributed, normalised 0–1".
 * The docs describe it but give no example, so accept the plausible shapes:
 *   { "signal.interests.entities": [{ entity_id, score }] }
 *   [{ entity_id, score }]
 *   { "<entity_id>": score }
 */
export function extractContributions(entity: QlooEntity): Contribution[] {
  const ex = entity.query?.explainability;
  if (!ex || typeof ex !== "object") return [];
  const fromList = (list: unknown[]): Contribution[] =>
    list
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({
        entityId: String(x.entity_id ?? x.id ?? ""),
        score: Number(x.score ?? x.value ?? x.weight ?? NaN),
      }))
      .filter((c) => c.entityId && Number.isFinite(c.score));
  if (Array.isArray(ex)) return sortDesc(fromList(ex));
  const obj = ex as Record<string, unknown>;
  if ("warning" in obj && Object.keys(obj).length === 1) return [];
  const signal = obj["signal.interests.entities"];
  if (Array.isArray(signal)) return sortDesc(fromList(signal));
  const numeric = Object.entries(obj).filter(([, v]) => typeof v === "number") as [string, number][];
  return sortDesc(numeric.map(([entityId, score]) => ({ entityId, score })));
}

function sortDesc(list: Contribution[]): Contribution[] {
  return [...list].sort((a, b) => b.score - a.score);
}
