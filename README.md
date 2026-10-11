<!-- 저장소 소개 문서(영어): 무엇·왜·어떻게, 설치·실행, 구조, 데이터 출처, AI 도구 -->

# Subtitles Off

**Keep a language alive through the things you already love.**

Subtitles Off is an agent that takes a target language, a level and two to five favorites (a game, a singer, a show) and returns a four-week plan of films, TV and music *from that language's world* that share the same taste. It runs from easy listening in week 1 to watching with the subtitles off in week 4. Every pick is a Qloo entity, and every pick says why it is there: "Because you like Stranger Things, 61% of the match".

- Live demo: https://subtitles-off.vercel.app (no sign-in; the three example people open a full plan)
- Code: https://github.com/leesin1716-byte/subtitles-off
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
| Compare | `GET /search` + `GET /v2/insights` with `filter.results.entities` | Puts a generic chatbot list next to the plan. When Claude is configured, the generic list comes from the same Claude model asked the same question without Qloo, so the only difference between the two lists is the taste data. When the learner has an age limit, the generic question carries the same list of allowed content ratings the planner was given. Besides Qloo affinity (which the plan was picked by within its country and age-rating filters, so it tends to favour the plan, though a generic list can still score higher, as Claude's did for Mina), it shows measures that do not depend on that score: share of titles from a country of the language, how many favorites Qloo's explainability credits, and average popularity percentile. When there is an age limit, a row counts how many titles in each list are rated within it. Both lists take the rating from Qloo's `content_rating` in the same scoring call; a title with no rating, "Not Rated" or an unfamiliar scale is shown as unknown rather than guessed. Each generic title shows the Qloo entity and year it resolved to. On live data for Mina (15), three runs of the generic question with her rating limit, each scored against the rule-based version of her plan (the live test skips the Claude planner to save calls), gave: 5 of 7 rated titles within her ratings (*Memories of the Alhambra*, TV-MA in Qloo, came back twice, and 5 of the 12 titles have no rating in Qloo) against 6 of 6 for her plan; 1 of her 3 favorites credited against 2 of 3; average popularity percentile 87 to 94% against 83%; and average affinity 0.91 against 0.885, where the generic list leads. |

Guarantees in code:

- **Only Qloo ids.** The LLM planner can only submit entity ids that Qloo returned in this run. A validator rejects anything else, and after two rejected plans a rule-based planner takes over. With Claude the tool inputs are also schema-checked (`strict: true`).
- **The "why" comes from Qloo.** The "Because you like…" line uses Qloo's per-result explainability contribution. When the LLM agent adds its own sentence, it is shown separately and labelled "Agent note".
- **No silent fallback.** On the production deployment, a missing Qloo key is an error page. The app never switches to sample data there.
- **Bounded cost.** At most 18 Qloo calls per plan and 8 agent steps. If the call budget runs out mid-plan, the agent composes from what it already found. The LLM gets 35 seconds before the rule planner takes over. Claude plans are capped per server instance per day (`CLAUDE_DAILY_PLAN_CAP`, default 60), and Claude compare baselines have their own counter with the same cap, so a public demo cannot run up the bill.
- **Quiet fallback.** If Claude declines (`stop_reason: "refusal"`), errors, or runs out of time, that plan is finished by the rule-based planner from the candidates already found, and the plan says so. If the Anthropic API refuses the key for good (401, 402 billing, 403, 404, or a 400 about the credit balance), Claude is switched off for the rest of the process and later plans go straight to the next planner. The demo keeps working after the key or its credit expires.
- **Caching.** Qloo answers are cached for 24 hours per normalised request URL. Finished plans are cached by their inputs (Vercel Runtime Cache), and replaying a cached plan does not count against the per-IP limit (6 a minute, 200 a day). The three example plans are kept for 45 days and refreshed by a daily health check, so the examples keep opening even if Qloo is briefly unavailable.

## How it works

```
browser ──POST /api/plan──▶ Route Handler (Node, streams NDJSON events)
                              │
                              ├─ resolveFavorites ── /search ──▶ needs_input? ask the user
                              ├─ findMusicTags, findAvoidTags ── /v2/tags
                              ├─ agent (≤ 8 steps), the first one available:
                              │     1. Claude (Anthropic SDK, manual tool loop)
                              │     2. gateway model (AI SDK tool calling)
                              │     tools: discover · widen · compose_plan(validated)
                              │   or rule-based planner (no LLM / LLM failed)
                              ├─ buildLadder: genre rules → easy → hard, music every week
                              └─ plan event (+ every Qloo call for the trace)
```

- `lib/qloo/`: typed client. Per-type parameter allow-lists (Qloo ignores unsupported parameters silently, so these are checked before sending), stable query serialisation, `HttpQlooClient` (`X-Api-Key`, one retry on 5xx and timeouts, error classes for 400/401/403/404/429), `MockQlooClient`, cache and call budget.
- `lib/plan/`: the planner. `tools.ts` (agent tools), `agent.ts` (provider-neutral tool handlers and the AI SDK loop), `claude-agent.ts` (the Claude loop), `compose.ts` (validator and rule-based selection), `ladder.ts` (difficulty rules: animation, reality and sitcoms are easy; romance, comedy and drama are medium; thriller, crime and period pieces are hard), `refine.ts` (turns "no violence, she's 15, already watched X" into filters), `compare.ts`.
- `components/`: the UI. Three-step input, live agent trace, ambiguity step, the four-week plan, refinement, compare panel, share link and print.
- **The Claude loop** (`claude-agent.ts`) calls `client.beta.messages.create` with `claude-opus-5-5`, adaptive thinking, `effort: "low"`, strict tool schemas and `fallbacks: "default"` (a safety-classifier decline is retried server-side on the model Anthropic recommends). Parallel tool calls run together and their results go back in one message. The history is append-only, so Claude's thinking blocks stay valid between steps, and prompt caching re-reads the tools, prompt and earlier steps. Every step appears in the trace with its tool calls, tokens and time. On live data (10-11) the three example plans each took two Claude requests: about 2 s to call `discover` for TV, film and music at once, then 13 to 16 s to write the shortlist with a reason per pick.
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
| `ANTHROPIC_API_KEY` | Enables the Claude planner (tried first). Server-side only. |
| `CLAUDE_MODEL` | Default `claude-opus-5-5`. |
| `CLAUDE_EFFORT` | `low` (default), `medium` or `high`. |
| `CLAUDE_DAILY_PLAN_CAP` | New Claude-planned plans per server instance per UTC day, default 60 (compare baselines are counted separately against the same number). Past it, plans use the next planner. |
| `CLAUDE_USAGE_LOG` | Optional file path: appends the token usage of every Claude request as JSON lines. Usage is always printed to the server log. |
| `AI_GATEWAY_API_KEY` | Enables the gateway LLM planner (used when Claude is not configured or is switched off). On Vercel, OIDC also works; set the key anyway in production so the agent never depends on it. |
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
npm run smoke:claude   # with QLOO_API_KEY and ANTHROPIC_API_KEY: Claude plans the three examples on live data and writes the compare baseline (costs API credit)
```

The demo video is made by `video/make.ts`: after `npm run build`, run `npm install` and `npm run make` in `video/` with `QLOO_API_KEY` in `.env.local` and `ANTHROPIC_API_KEY` set. It records Mina's example on live Qloo and Claude, voices the narration with Kokoro-82M, replaces Qloo poster images with plain tiles, and writes the mp4, subtitles and stills to `video/out/`.

External APIs are never called in `npm test`. Qloo calls go through the mock client or a fake `fetch`, the gateway LLM is `MockLanguageModelV4` with recorded tool calls, and Claude is a recorded stand-in for `messages.create` (tool loop, request settings, refusal, timeout, billing error and daily cap).

## Deploying

Vercel, Node runtime. Set `QLOO_API_KEY`, `CRON_SECRET` and an LLM key (`ANTHROPIC_API_KEY`, `AI_GATEWAY_API_KEY`, or both) in the project environment variables. If no LLM is available, the app still works with the rule-based planner, and the plan says "Rule-selected" instead of "Agent-selected". `/api/health` reports `claude: "refused: HTTP 402"` once the Anthropic API has turned the key away.

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
- Age ratings come from Qloo's `content_rating`, which uses US film and TV scales. Some titles have none (Reply 1988), and a few look off (True Beauty is marked TV-Y). The compare panel shows them as Qloo has them and counts missing ones as unknown.
- The app suggests what to watch and listen to. It does not teach the language by itself.
- Some response fields (`/v2/tags` field names, the exact explainability shape) are not shown in the public docs. The parsers accept the plausible shapes and are covered by tests, and `npm run smoke:live` checks them against the live API.
- The English-only check on agent notes is a heuristic (script plus common Spanish and French words).

## Built with

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Claude Opus 5.5 through the Anthropic TypeScript SDK (tool use, adaptive thinking, structured outputs, prompt caching), Vercel AI SDK 7 with AI Gateway, zod, Vitest, Playwright, Vercel Functions, Runtime Cache and Cron Jobs, and the Qloo Insights API (`/search`, `/v2/tags`, `/v2/insights`).

## AI tools used

- **In the product:** Claude Opus 5.5 through the Anthropic API (or, without that key, a gateway model through the Vercel AI SDK) acts as the planning agent (tool calling) and produces the "generic chatbot" list for the compare panel. The rules above limit what it can do.
- **In development:** the code, tests and this README were written with help from Claude (Anthropic) in Claude Code, and the output was reviewed and tested by running it.
