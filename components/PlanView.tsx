"use client";
// 4주 사다리 카드, 근거 표시, 다듬기 대화, 공유·인쇄, 비교 패널을 그리는 결과 화면

import { useState } from "react";
import type { Plan, PlanInput, PlanItem } from "@/lib/plan/types";
import type { CompareResult } from "@/lib/plan/compare";
import { encodeInput } from "@/lib/plan/share";
import { TracePanel, type TraceLine } from "./TracePanel";

const DOMAIN_LABEL: Record<PlanItem["domain"], string> = { tv_show: "TV", movie: "Film", artist: "Music" };
const TIER_LABEL = { 1: "Easy", 2: "Medium", 3: "Challenging" } as const;
const QUICK_REFINES = ["No violence please", "More music", "Something lighter"];

export function PlanView({
  plan,
  input,
  trace,
  onRefine,
  onSeen,
}: {
  plan: Plan;
  input: PlanInput;
  trace: TraceLine[];
  onRefine: (text: string) => void;
  onSeen: (entityId: string) => void;
}) {
  const [refine, setRefine] = useState("");
  const [copied, setCopied] = useState(false);
  const favorites = plan.seeds.map((s) => s.name);

  const share = async () => {
    const url = `${window.location.origin}/?${encodeInput(input)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  return (
    <article className="space-y-6">
      <header className="card overflow-hidden">
        <div className="subtitle-bar">
          <span>[ {plan.languageLabel.toLowerCase()} · four weeks ]</span>
        </div>
        <div className="p-6">
          <h2 className="font-display text-3xl leading-tight">
            Four weeks of {plan.languageLabel} for someone who loves {listJoin(favorites)}
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2 text-xs">
            {plan.applied.map((a) => (
              <li key={a} className="chip chip-quiet">
                {a}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-soft">
            {plan.planner === "llm" ? "Agent-selected" : "Rule-selected"} from {plan.calls.length} Qloo calls. {plan.plannerNote}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 print:hidden">
            <button type="button" className="btn-secondary" onClick={share}>
              {copied ? "Link copied" : "Copy share link"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </div>
      </header>

      <ol className="grid gap-5 lg:grid-cols-2">
        {plan.weeks.map((w) => (
          <li key={w.week} className="card break-inside-avoid p-5">
            <p className="eyebrow">Week {w.week}</p>
            <h3 className="font-display text-2xl">{w.title}</h3>
            <p className="mt-1 text-sm text-ink-soft">{w.focus}</p>
            <ul className="mt-4 space-y-4">
              {w.items.map((item) => (
                <ItemRow key={item.entityId} item={item} onSeen={onSeen} />
              ))}
              {w.items.length === 0 && <li className="text-sm text-ink-soft">Rewatch your favorite from last week.</li>}
            </ul>
          </li>
        ))}
      </ol>

      <section className="card p-5 print:hidden">
        <h3 className="font-semibold">Adjust the plan</h3>
        <p className="text-sm text-ink-soft">Say what to change. The agent re-asks Qloo with new filters and exclusions.</p>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (refine.trim()) onRefine(refine.trim());
          }}
        >
          <input
            value={refine}
            onChange={(e) => setRefine(e.target.value)}
            placeholder="e.g. No violence, she's 15. She already watched Squid Game."
            className="field flex-1"
            maxLength={300}
            aria-label="What should change?"
          />
          <button type="submit" className="btn-primary" disabled={!refine.trim()}>
            Update plan
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-2">
          {QUICK_REFINES.map((q) => (
            <button key={q} type="button" className="chip hover:bg-[var(--paper-deep)]" onClick={() => onRefine(q === "Something lighter" ? "No violence, nothing scary" : q)}>
              {q}
            </button>
          ))}
        </div>
      </section>

      <ComparePanel plan={plan} />

      <details className="print:hidden">
        <summary className="cursor-pointer text-sm font-medium">How this plan was made ({plan.calls.length} Qloo calls)</summary>
        <div className="mt-3">
          <TracePanel lines={trace} running={false} />
        </div>
      </details>

      <p className="text-xs text-ink-soft">
        Suggestions only: check age ratings and where to stream before watching. Qloo scores describe aggregate taste affinity,
        not facts about any person. This plan helps you choose what to watch and listen to; it does not teach the language by itself.
      </p>
    </article>
  );
}

function ItemRow({ item, onSeen }: { item: PlanItem; onSeen: (id: string) => void }) {
  return (
    <li className="flex gap-3">
      <Poster item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold leading-tight">
            {item.name}
            <span className="ml-1 font-normal text-ink-soft">{item.year ? `(${item.year})` : ""}</span>
          </p>
          <button type="button" className="shrink-0 text-xs text-ink-soft underline-offset-2 hover:underline print:hidden" onClick={() => onSeen(item.entityId)} title="Remove and replan">
            Seen it
          </button>
        </div>
        <p className="text-xs text-ink-soft">
          {DOMAIN_LABEL[item.domain]}
          {item.domain !== "artist" && ` · ${TIER_LABEL[item.tier]}`}
          {item.rating && ` · ${item.rating}`}
        </p>
        {item.because ? (
          <div className="mt-1.5">
            <p className="text-sm">
              Because you like <b>{item.because.seedName}</b>
              <span className="text-ink-soft"> · {Math.round(item.because.score * 100)}% of the match</span>
            </p>
            <div className="meter" aria-hidden>
              <span style={{ width: `${Math.max(4, Math.round(item.because.score * 100))}%` }} />
            </div>
          </div>
        ) : item.affinity !== undefined ? (
          <p className="mt-1.5 text-sm text-ink-soft">Qloo affinity {item.affinity.toFixed(2)}</p>
        ) : null}
        {item.note && <p className="mt-1.5 text-sm italic">“{item.note}”</p>}
        <p className="mt-1.5 text-sm text-ink-soft">{item.tip}</p>
        {item.activity && <p className="mt-1 text-sm">With family: {item.activity}</p>}
      </div>
    </li>
  );
}

function Poster({ item }: { item: PlanItem }) {
  if (item.imageUrl) {
    // Qloo image URLs are displayed at runtime only and never stored.
    return <img src={item.imageUrl} alt="" loading="lazy" className="h-20 w-14 shrink-0 rounded-sm object-cover" />;
  }
  return (
    <div aria-hidden className="poster-placeholder">
      {DOMAIN_LABEL[item.domain]}
    </div>
  );
}

function ComparePanel({ plan }: { plan: Plan }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [message, setMessage] = useState("");
  const screen = plan.weeks.flatMap((w) => w.items).filter((i) => i.domain !== "artist").slice(0, 6);

  const go = async () => {
    setState("loading");
    const res = await fetch("/api/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        language: plan.language,
        seeds: plan.seeds.map((s) => ({ entityId: s.entityId, name: s.name })),
        planItems: screen.map((i) => ({ entityId: i.entityId, name: i.name, domain: i.domain })),
      }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !body) {
      setMessage(body?.message ?? "The comparison could not run.");
      setState("error");
      return;
    }
    setResult(body as CompareResult);
    setState("done");
  };

  return (
    <section className="card p-5 print:hidden">
      <h3 className="font-semibold">Why not just ask a chatbot?</h3>
      <p className="text-sm text-ink-soft">
        Ask a general AI for {plan.languageLabel} shows and it tends to list the same global hits. Here Qloo scores that list and this plan against the
        same favorites.
      </p>
      {state === "idle" && (
        <button type="button" className="btn-secondary mt-3" onClick={go} disabled={screen.length === 0}>
          Compare with a generic AI list
        </button>
      )}
      {state === "loading" && <p className="mt-3 text-sm">Scoring both lists with Qloo…</p>}
      {state === "error" && <p className="mt-3 text-sm">{message}</p>}
      {state === "done" && result && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ScoreList
            title={result.baselineSource === "llm" ? "Generic AI suggestions" : "Typical generic picks"}
            subtitle={result.baselineSource === "llm" ? "Asked an LLM without Qloo" : "No LLM configured: the usual global hits"}
            items={result.baseline}
            mean={result.baselineMean}
          />
          <ScoreList title="This plan (Qloo-grounded)" subtitle="Picked from Qloo taste matches" items={result.grounded} mean={result.groundedMean} strong />
          <p className="text-xs text-ink-soft sm:col-span-2">
            Scores are Qloo affinity to the same {plan.seeds.length} favorites (higher means a closer taste match), from {result.calls} Qloo calls.
          </p>
        </div>
      )}
    </section>
  );
}

function ScoreList({
  title,
  subtitle,
  items,
  mean,
  strong,
}: {
  title: string;
  subtitle: string;
  items: CompareResult["baseline"];
  mean?: number;
  strong?: boolean;
}) {
  return (
    <div className={`rounded-md border p-4 ${strong ? "border-[var(--ink)]" : "border-[var(--line)]"}`}>
      <p className="font-semibold">{title}</p>
      <p className="text-xs text-ink-soft">{subtitle}</p>
      <p className="mt-2 font-display text-3xl">{mean !== undefined ? mean.toFixed(2) : "—"}</p>
      <p className="text-xs text-ink-soft">average affinity</p>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((i) => (
          <li key={i.entityId ?? i.name}>
            <div className="flex justify-between gap-2">
              <span className="truncate">{i.name}</span>
              <span className="tabular-nums text-ink-soft">{i.affinity !== undefined ? i.affinity.toFixed(2) : i.found ? "n/a" : "not in Qloo"}</span>
            </div>
            <div className="meter" aria-hidden>
              <span style={{ width: `${Math.round((i.affinity ?? 0) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}
