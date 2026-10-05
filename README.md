<!-- 저장소 소개 문서(영어): 무엇·왜·어떻게, 설치·실행, 구조, 데이터 출처, AI 도구 -->

# Subtitles Off

**Keep a language alive through the things you already love.**

Subtitles Off is an agent that takes a target language, a level and two to five favorites (a game, a singer, a show) and returns a four-week plan of films, TV and music *from that language's world* that share the same taste. It runs from easy listening in week 1 to watching with the subtitles off in week 4. Every pick is a Qloo entity, and every pick says why it is there: "Because you like Stranger Things, 61% of the match".

- Live demo: _to be added after deployment_
- License: MIT

## Why

Mina is 15. She grew up in the US with Minecraft, Olivia Rodrigo and Stranger Things, and her grandmother in Seoul speaks almost no English. Their video calls are getting shorter. Mina doesn't need another vocabulary app. She needs Korean shows and music she would choose anyway.

Her situation is common. Using two large surveys of immigrant families in Southern California, Rumbaut, Massey and Bean found that even Spanish, in the country's largest Spanish-speaking region, is expected to stop being spoken as a mother tongue by the third generation ([*Linguistic Life Expectancies*, Population and Development Review 32(3), 2006](https://doi.org/10.1111/j.1728-4457.2006.00132.x)). Adult learners hit the same wall. "Watch shows in the language" is good advice, but the suggestions are usually the same few global hits, whatever the person actually enjoys. People keep going with a language when the material is something they would pick anyway. The hard part is finding *your* kind of show in *their* language. Cross-domain taste data is built for that problem.

## What makes it Qloo-powered

The app would not work the same without Qloo. Without it, there is nothing to build a plan from.

| Step | Qloo endpoint | What it does |
|---|---|---|
| Resolve favorites | `GET /search` | Each favorite becomes a Qloo entity. When two results share the exact title (e.g. *The Office*, US or UK), the agent asks the user to choose. |
| Pin music to the language | `GET /v2/tags` | Artists have no country filter, so the agent finds music genre tags for the language (K-Pop, Rock en Español, J-Pop…). |
| Look up genres to avoid | `GET /v2/tags` | Turns "no violence" into Qloo genre tag ids for `filter.exclude.tags`. The ids follow the documented format (`urn:tag:genre:media:thriller`) and are confirmed in one call with `filter.results.tags`. |
| Taste analysis | `GET /v2/insights` with `filter.type=urn:tag` | Shows the genres Qloo links to the favorites ("Your taste, as Qloo sees it"). |
| Discover | `GET /v2/insights` | TV and film use `signal.interests.entities` (the favorites), `filter.release_country`, `filter.content_rating` (from the learner's age), `signal.demographics.age` and `feature.explainability=true`. Artists use the same signals with `filter.tags`. |
| Widen when thin | `GET /v2/insights` | If a domain returns fewer than 3 results, the agent widens one stage at a time: more countries, then the favorites' genre tags, then filters only. Each stage shows up in the trace. |
| Compare | `GET /search` + `GET /v2/insights` with `filter.results.entities` | Puts a generic chatbot list next to the plan. Besides Qloo affinity (which the plan was picked by, so it is expected to win), it shows measures that do not depend on that score: share of titles from a country of the language, how many favorites Qloo's explainability credits, and average popularity percentile. Each generic title shows the Qloo entity and year it resolved to. |

Guarantees in code:

- **Only Qloo ids.** The LLM planner can only submit entity ids that Qloo returned in this run. A validator rejects anything else, and after two rejected plans a rule-based planner takes over.
- **The "why" comes from Qloo.** The "Because you like…" line uses Qloo's per-result explainability contribution. When the LLM agent adds its own sentence, it is shown separately and labelled "Agent note".
- **No silent fallback.** On the production deployment, a missing Qloo key is an error page. The app never switches to sample data there.
- **Bounded cost.** At most 18 Qloo calls per plan and 8 agent steps. If the call budget runs out mid-plan, the agent composes from what it already found. The LLM gets 25 seconds before the rule planner takes over.
- **Caching.** Qloo answers are cached for 24 hours per normalised request URL. Finished plans are cached by their inputs (Vercel Runtime Cache), and replaying a cached plan does not count against the per-IP limit (6 a minute, 200 a day). The three example plans are kept for 45 days and refreshed by a daily health check, so the examples keep opening even if Qloo is briefly unavailable.

## How it works

```
browser ──POST /api/plan──▶ Route Handler (Node, streams NDJSON events)
                              │
                              ├─ resolveFavorites ── /search ──▶ needs_input? ask the user
                              ├─ findMusicTags, findAvoidTags ── /v2/tags
                              ├─ LLM agent (AI SDK tool calling, ≤ 8 steps)
                              │     tools: discover · widen · compose_plan(validated)
                              │   or rule-based planner (no LLM / LLM failed)
                              ├─ buildLadder: genre rules → easy → hard, music every week
                              └─ plan event (+ every Qloo call for the trace)
```

- `lib/qloo/`: typed client. Per-type parameter allow-lists (Qloo ignores unsupported parameters silently, so these are checked before sending), stable query serialisation, `HttpQlooClient` (`X-Api-Key`, one retry on 5xx and timeouts, error classes for 400/401/403/404/429), `MockQlooClient`, cache and call budget.
- `lib/plan/`: the planner. `tools.ts` (agent tools), `agent.ts` (LLM loop), `compose.ts` (validator and rule-based selection), `ladder.ts` (difficulty rules: animation, reality and sitcoms are easy; romance, comedy and drama are medium; thriller, crime and period pieces are hard), `refine.ts` (turns "no violence, she's 15, already watched X" into filters), `compare.ts`.
- `components/`: the UI. Three-step input, live agent trace, ambiguity step, the four-week plan, refinement, compare panel, share link and print.
- Difficulty and week order are decided by code, not by the LLM. The app does not write sentences in the target language, because a wrong sentence would teach the wrong thing. The validator rejects agent notes written in another script or in Spanish or French.

## Run it locally

Requirements: Node 20+ (tested on Node 24).

```bash
npm install
cp .env.example .env.local   # add QLOO_API_KEY to use live data
npm run dev                   # http://localhost:3000
```

Without `QLOO_API_KEY` the app runs on hand-made **sample data** and shows a striped "Sample data — not live Qloo" banner. Use the three example people (Mina, Sam, Jordan) to see the full flow.

| Variable | Purpose |
|---|---|
| `QLOO_API_KEY` | Hackathon key. Server-side only. |
| `QLOO_BASE_URL` | Defaults to `https://hackathon.api.qloo.com`. |
| `QLOO_MODE` | `mock` or `live`. Defaults to live when a key is set. Ignored in production, which is always live. |
| `AI_GATEWAY_API_KEY` | Enables the LLM planner. On Vercel, OIDC also works; set the key anyway in production so the agent never depends on it. |
| `AI_MODEL` | Gateway model id, default `openai/gpt-4.1-mini`. |
| `LLM_MODE` | `off` forces the rule-based planner. |
| `CRON_SECRET` | Lets the daily cron run the deep health check (`/api/health`). Without it, production only reports configuration. |

### Tests

```bash
npm test               # unit and integration tests (Vitest): client, params, mock, planner, agent with a recorded LLM, compare, share links, repo guards
npm run test:e2e       # Playwright: the three core scenarios in a real browser (run npm run build first)
npm run check:bundle   # builds with sentinel keys and proves no key or Qloo endpoint reaches the browser bundle
npm run typecheck
npm run smoke:live     # with a real QLOO_API_KEY: checks the response shapes the code depends on, then builds one live plan
```

External APIs are never called in tests. Qloo calls go through the mock client or a fake `fetch`, and the LLM is `MockLanguageModelV4` with recorded tool calls.

## Deploying

Vercel, Node runtime. Set `QLOO_API_KEY`, `AI_GATEWAY_API_KEY` and `CRON_SECRET` in the project environment variables. If the gateway has no credit, the app still works with the rule-based planner, and the plan says "Rule-selected" instead of "Agent-selected".

`vercel.json` schedules `/api/health` once a day. With the cron secret it makes one live Qloo call and warms the three example plans; a failure is logged as `HEALTH FAIL`. Without the secret, `/api/health` only reports the mode and whether an LLM is configured.

## Data sources and licenses

- **Recommendations, metadata, posters:** Qloo API (hackathon key, used for the hackathon only). Poster URLs are shown at runtime and never stored. No Qloo responses are committed to this repository.
- **Sample data** (`lib/qloo/fixtures.ts`): written by hand. Fake `mock-` ids, public facts only (titles and years). Ratings, tags and taste links are illustrative values, there are no images, and the app labels this mode as sample data.
- **Tips and activity lines:** written for this project, in English.
- **Fonts:** Fraunces and Geist via Google Fonts (SIL Open Font License).
- **Code:** MIT. No third-party logos. "Powered by Qloo" appears as text only.
- **Example people:** fictional. Their names are never sent to any API.

## Privacy and safety

- No accounts, no database, no analytics. Share links carry the inputs in the URL.
- Only taste signals reach Qloo or the LLM. Age is sent as a Qloo age band, never as a name or exact age.
- Content ratings are capped for learners under 18, and users can exclude genres.
- Qloo scores describe aggregate taste affinity. They are not facts about a person, and the UI says so.

## Limitations

- Coverage differs by language and country in Qloo's catalogue. Thin results trigger visible widening, and some languages may have fewer titles.
- Streaming availability is not checked.
- The app suggests what to watch and listen to. It does not teach the language by itself.
- Some response fields (`/v2/tags` field names, the exact explainability shape) are not shown in the public docs. The parsers accept the plausible shapes and are covered by tests, and `npm run smoke:live` checks them against the live API.
- The English-only check on agent notes is a heuristic (script plus common Spanish and French words).

## Built with

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Vercel AI SDK 7 with AI Gateway, zod, Vitest, Playwright, Vercel Functions, Runtime Cache and Cron Jobs, and the Qloo Insights API (`/search`, `/v2/tags`, `/v2/insights`).

## AI tools used

- **In the product:** an LLM through the Vercel AI SDK and AI Gateway acts as the planning agent (tool calling) and produces the "generic chatbot" list for the compare panel. The rules above limit what it can do.
- **In development:** the code, tests and this README were written with help from Claude (Anthropic) in Claude Code, and the output was reviewed and tested by running it.
