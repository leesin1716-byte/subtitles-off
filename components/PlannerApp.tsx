"use client";
// 입력 3단계 → 시드 확인 → 에이전트 진행 스트리밍 → 4주 계획까지 이어지는 메인 화면 상태 관리

import { useCallback, useEffect, useRef, useState } from "react";
import { PERSONAS } from "@/lib/plan/personas";
import { addSeen, encodeInput } from "@/lib/plan/share";
import { readPlanStream } from "@/lib/plan/stream";
import type { AmbiguityQuestion, LanguageCode, Level, Plan, PlanEvent, PlanInput } from "@/lib/plan/types";
import type { CallRecord } from "@/lib/qloo/budget";
import { PlanView } from "./PlanView";
import { TracePanel, type TraceLine } from "./TracePanel";

const LANGS: { code: LanguageCode; label: string; native: string }[] = [
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "fr", label: "French", native: "Français" },
];
const LEVEL_LABELS: Record<Level, string> = { beginner: "Just starting", intermediate: "Getting by", advanced: "Fairly fluent" };

type Status = "idle" | "running" | "needs_input" | "done" | "error";

export function PlannerApp({ mode, initialInput }: { mode: "live" | "mock"; initialInput?: PlanInput }) {
  const [input, setInput] = useState<PlanInput>(initialInput ?? PERSONAS[0].input);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [questions, setQuestions] = useState<AmbiguityQuestion[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [lastInput, setLastInput] = useState<PlanInput | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const autoRan = useRef(false);

  const run = useCallback(async (req: PlanInput) => {
    setStatus("running");
    setTrace([]);
    setQuestions([]);
    setError(null);
    setLastInput(req);
    window.history.replaceState(null, "", `?${encodeInput(req)}`);
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    let res: Response;
    try {
      res = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
    } catch {
      setError({ code: "network", message: "Could not reach the server. Check your connection and try again." });
      setStatus("error");
      return;
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      setError({ code: body.code ?? String(res.status), message: body.message ?? "The request failed." });
      setStatus("error");
      return;
    }
    const finished = await readPlanStream(res.body, (ev: PlanEvent) => {
      if (ev.type === "trace") setTrace((t) => [...t, { kind: "step", text: ev.step, detail: ev.detail }]);
      else if (ev.type === "qloo") setTrace((t) => [...t, { kind: "qloo", call: ev.call as CallRecord }]);
      else if (ev.type === "needs_input") setQuestions(ev.questions);
      else if (ev.type === "plan") setPlan(ev.plan);
      else if (ev.type === "error") setError({ code: ev.code, message: ev.message });
    });
    setStatus(finished);
  }, []);

  useEffect(() => {
    if (initialInput && !autoRan.current) {
      autoRan.current = true;
      void run(initialInput);
    }
  }, [initialInput, run]);

  const addFavorite = () => {
    const v = draft.trim();
    if (!v || input.favorites.length >= 5 || input.favorites.includes(v)) return;
    setInput({ ...input, favorites: [...input.favorites, v], choices: undefined });
    setDraft("");
  };
  const removeFavorite = (f: string) => setInput({ ...input, favorites: input.favorites.filter((x) => x !== f), choices: undefined });
  const canRun = input.favorites.length >= 2 && status !== "running";

  const choose = (favorite: string, entityId: string) => {
    if (!lastInput) return;
    const next = { ...lastInput, choices: { ...(lastInput.choices ?? {}), [favorite]: entityId } };
    const remaining = questions.filter((q) => q.favorite !== favorite);
    setLastInput(next);
    setInput(next);
    if (remaining.length) setQuestions(remaining);
    else void run(next);
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-24 pt-6 md:grid-cols-[340px_1fr] md:px-6 print:block print:p-0">
      <aside className="print:hidden">
        <section aria-label="Examples" className="mb-6">
          <h2 className="eyebrow">Try an example</h2>
          <div className="mt-2 grid gap-2">
            {PERSONAS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setInput(p.input);
                  void run(p.input);
                }}
                disabled={status === "running"}
                className="persona"
              >
                <span className="font-semibold">{p.name}</span>
                <span className="text-sm text-ink-soft">{p.blurb}</span>
                <span className="text-xs text-ink-soft">
                  {LANGS.find((l) => l.code === p.input.language)!.label} · {p.input.favorites.join(" · ")}
                </span>
              </button>
            ))}
          </div>
        </section>

        <form
          className="card space-y-6 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canRun) void run({ ...input, refinement: undefined });
          }}
        >
          <fieldset>
            <legend className="step">
              <span>1</span> Language to keep alive
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  aria-pressed={input.language === l.code}
                  onClick={() => setInput({ ...input, language: l.code })}
                  className="choice"
                >
                  <span className="font-semibold">{l.label}</span>
                  <span lang={l.code} className="text-xs text-ink-soft">
                    {l.native}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="step">
              <span>2</span> Level
            </legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(Object.keys(LEVEL_LABELS) as Level[]).map((lv) => (
                <button key={lv} type="button" aria-pressed={input.level === lv} onClick={() => setInput({ ...input, level: lv })} className="choice text-sm">
                  {LEVEL_LABELS[lv]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="step">
              <span>3</span> Things they already love
            </legend>
            <p className="mt-1 text-sm text-ink-soft">2–5 favorites in any language or medium: a game, a singer, a show, a film.</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {input.favorites.map((f) => (
                <li key={f} className="chip">
                  {f}
                  <button type="button" aria-label={`Remove ${f}`} onClick={() => removeFavorite(f)} className="ml-1 opacity-60 hover:opacity-100">
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addFavorite();
                  }
                }}
                placeholder={input.favorites.length >= 5 ? "Five is the maximum" : "e.g. Taylor Swift"}
                disabled={input.favorites.length >= 5}
                className="field flex-1"
                aria-label="Add a favorite"
                maxLength={80}
              />
              <button type="button" onClick={addFavorite} className="btn-secondary" disabled={!draft.trim() || input.favorites.length >= 5}>
                Add
              </button>
            </div>
          </fieldset>

          <details className="group">
            <summary className="cursor-pointer text-sm font-medium">More options</summary>
            <div className="mt-3 space-y-3">
              <label className="block text-sm">
                Learner&apos;s age <span className="text-ink-soft">(sets content ratings; only an age band is sent)</span>
                <input
                  type="number"
                  min={5}
                  max={110}
                  value={input.age ?? ""}
                  onChange={(e) => setInput({ ...input, age: e.target.value ? Number(e.target.value) : undefined })}
                  className="field mt-1 w-24"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!input.family} onChange={(e) => setInput({ ...input, family: e.target.checked })} />
                Learning to talk with family (adds a shared activity to each pick)
              </label>
              <label className="block text-sm">
                Leave out
                <input
                  value={input.avoid ?? ""}
                  onChange={(e) => setInput({ ...input, avoid: e.target.value || undefined })}
                  placeholder="e.g. horror, violence"
                  className="field mt-1 w-full"
                  maxLength={200}
                />
              </label>
            </div>
          </details>

          <button type="submit" disabled={!canRun} className="btn-primary w-full">
            {status === "running" ? "Building…" : "Build the four-week plan"}
          </button>
          {input.favorites.length < 2 && <p className="text-sm text-ink-soft">Add at least two favorites.</p>}
        </form>
      </aside>

      <div ref={resultsRef} className="min-w-0 scroll-mt-4">
        {status === "idle" && <EmptyState mode={mode} />}

        {(status === "running" || trace.length > 0) && status !== "done" && <TracePanel lines={trace} running={status === "running"} />}

        {status === "needs_input" && (
          <section className="card mt-4 p-5" aria-live="polite">
            <h2 className="text-lg font-semibold">Which one do you mean?</h2>
            <p className="text-sm text-ink-soft">Qloo knows more than one match. Pick the right one so the plan starts from the right taste.</p>
            {questions.map((q) => (
              <div key={q.favorite} className="mt-4">
                <p className="font-medium">“{q.favorite}”</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {q.options.map((o) => (
                    <button key={o.entityId} type="button" onClick={() => choose(q.favorite, o.entityId)} className="choice text-left">
                      <span className="font-semibold">{o.name}</span>
                      <span className="text-xs text-ink-soft">
                        {[o.subtype.replace("urn:entity:", "").replace("_", " "), o.disambiguation ?? o.year].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {status === "error" && error && (
          <section className="card mt-4 border-l-4 border-l-[var(--danger)] p-5" role="alert">
            <h2 className="font-semibold">{errorTitle(error.code)}</h2>
            <p className="mt-1 text-sm">{error.message}</p>
            {lastInput && error.code !== "config" && (
              <button type="button" className="btn-secondary mt-3" onClick={() => void run(lastInput)}>
                Try again
              </button>
            )}
          </section>
        )}

        {status === "done" && plan && lastInput && (
          <PlanView
            plan={plan}
            input={lastInput}
            trace={trace}
            onRefine={(text) => void run({ ...lastInput, refinement: text })}
            onSeen={(id) => void run({ ...lastInput, excludeIds: addSeen(lastInput.excludeIds, id) })}
          />
        )}
      </div>
    </div>
  );
}

function errorTitle(code: string): string {
  if (code === "rate_limited" || code === "qloo_rate_limited") return "Slow down a little";
  if (code === "empty" || code === "no_seeds") return "Nothing to build from yet";
  if (code === "config") return "This demo is not configured";
  return "Something went wrong";
}

function EmptyState({ mode }: { mode: "live" | "mock" }) {
  return (
    <section className="card overflow-hidden">
      <div className="subtitle-bar">
        <span>[ subtitles: off ]</span>
      </div>
      <div className="space-y-4 p-6">
        <h2 className="font-display text-3xl leading-tight">Same taste. Different language.</h2>
        <p className="max-w-prose text-ink-soft">
          Tell us a language and a few things someone already loves. An agent asks Qloo&apos;s taste graph for films, shows and
          artists from that language&apos;s world that share the same taste, then lays them out as four weeks, from easy
          listening to watching with the subtitles off.
        </p>
        <ol className="grid gap-3 text-sm sm:grid-cols-3">
          <li className="howto">
            <b>Favorites → Qloo</b>
            Each favorite is matched to a Qloo entity. If two things share a name, you choose.
          </li>
          <li className="howto">
            <b>Taste → language</b>
            Qloo finds TV and film from the right countries and music by language genre tags, with a “because you like…” score.
          </li>
          <li className="howto">
            <b>Plan → you</b>
            Code orders picks from easy to hard. Every pick is a Qloo result, never an invented title.
          </li>
        </ol>
        {mode === "mock" && (
          <p className="text-sm text-ink-soft">This copy runs on hand-made sample data. Try one of the examples on the left.</p>
        )}
      </div>
    </section>
  );
}
