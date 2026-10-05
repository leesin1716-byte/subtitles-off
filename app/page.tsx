// 첫 화면: 모드(live/mock) 판정, 운영 설정 오류 화면, 공유 링크 입력 복원
import { PlannerApp } from "@/components/PlannerApp";
import { resolveQlooMode } from "@/lib/config";
import { decodeInput } from "@/lib/plan/share";

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const mode = resolveQlooMode(process.env);
  const initialInput = decodeInput(params);

  return (
    <>
      {mode.ok && mode.mode === "mock" && (
        <div role="status" className="sample-band print:hidden">
          Sample data — not live Qloo. Hand-made examples so the flow works without an API key.
        </div>
      )}
      <header className="mx-auto flex w-full max-w-6xl items-end justify-between gap-4 px-4 pt-8 md:px-6">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-tight sm:text-5xl">
            Subtitles <span className="off">Off</span>
          </h1>
          <p className="mt-2 text-ink-soft">Keep a language alive through the things you already love.</p>
        </div>
        <p className="hidden text-right text-xs text-ink-soft sm:block">
          Powered by Qloo taste data
          <br />
          {mode.ok ? (mode.mode === "live" ? "Live Qloo API" : "Sample mode") : "Not configured"}
        </p>
      </header>
      <main className="flex-1">
        {mode.ok ? (
          <PlannerApp mode={mode.mode} initialInput={initialInput} />
        ) : (
          <section className="mx-auto mt-10 max-w-xl px-4">
            <div className="card border-l-4 border-l-[var(--danger)] p-6" role="alert">
              <h2 className="text-lg font-semibold">This demo is not configured</h2>
              <p className="mt-2 text-sm">
                It needs a Qloo API key to run. Sample data is switched off on the production site on purpose, so every plan you see
                here comes from the live Qloo API.
              </p>
              <p className="mt-2 text-xs text-ink-soft">{mode.reason}</p>
            </div>
          </section>
        )}
      </main>
      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-ink-soft md:px-6 print:hidden">
        Open source (MIT). Built for the Qloo Agent Hackathon. No accounts, no tracking; names are never sent to any API.
      </footer>
    </>
  );
}
