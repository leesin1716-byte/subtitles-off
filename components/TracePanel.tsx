"use client";
// 에이전트 단계와 Qloo 호출(엔드포인트·주요 파라미터·결과 수)을 실시간으로 보여 주는 패널

import type { CallRecord } from "@/lib/qloo/budget";

export type TraceLine = { kind: "step"; text: string; detail?: string } | { kind: "qloo"; call: CallRecord };

const SHOWN = [
  "query",
  "filter.type",
  "filter.query",
  "filter.tag.types",
  "filter.release_country",
  "filter.content_rating",
  "filter.tags",
  "filter.exclude.tags",
  "filter.results.entities",
  "signal.interests.entities",
  "signal.interests.tags",
  "signal.demographics.age",
  "feature.explainability",
];

function short(v: unknown): string {
  const list = Array.isArray(v) ? v : String(v).split(",");
  const cleaned = list.map((x) => String(x).replace(/^urn:(entity|tag):/, "").replace(/^genre:(media|music):/, ""));
  const looksLikeIds = cleaned.every((x) => /^[0-9A-Fa-f-]{20,}$|^mock-/.test(x));
  if (looksLikeIds) return `${cleaned.length} id${cleaned.length > 1 ? "s" : ""}`;
  return cleaned.length > 4 ? `${cleaned.slice(0, 4).join(", ")} +${cleaned.length - 4}` : cleaned.join(", ");
}

export function describeCall(call: CallRecord): string {
  return SHOWN.filter((k) => call.params[k] !== undefined)
    .map((k) => `${k.replace(/^(filter|signal|feature)\./, "")}=${short(call.params[k])}`)
    .join("  ");
}

export function TracePanel({ lines, running }: { lines: TraceLine[]; running: boolean }) {
  return (
    <section className="card mt-0 p-5" aria-live="polite" aria-busy={running}>
      <h2 className="eyebrow flex items-center gap-2">
        {running && <span className="pulse" aria-hidden />} {running ? "Agent at work" : "Agent trace"}
      </h2>
      <ol className="mt-3 space-y-1.5 font-mono text-[12.5px] leading-snug">
        {lines.map((l, i) =>
          l.kind === "step" ? (
            <li key={i} className="text-ink">
              <span className="text-accent-ink">▸</span> {l.text}
              {l.detail && <span className="text-ink-soft"> — {l.detail}</span>}
            </li>
          ) : (
            <li key={i} className="break-words pl-4 text-ink-soft">
              <span className="qloo-tag">Qloo #{l.call.n}</span> GET {l.call.endpoint} {describeCall(l.call)}{" "}
              <span className="text-ink">→ {l.call.resultCount}</span>
            </li>
          ),
        )}
        {running && lines.length === 0 && <li className="text-ink-soft">Starting…</li>}
      </ol>
    </section>
  );
}
