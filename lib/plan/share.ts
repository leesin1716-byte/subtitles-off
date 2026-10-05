// 공유 링크: 계획 입력을 URL 쿼리에 담고 다시 읽는다(서버 DB 없음)

import { LANGUAGE_CODES, LEVELS, planInputSchema, type PlanInput } from "./types";

type Params = Record<string, string | string[] | undefined>;

export function encodeInput(input: PlanInput): string {
  const sp = new URLSearchParams();
  sp.set("l", input.language);
  sp.set("v", input.level);
  for (const f of input.favorites) sp.append("f", f);
  if (input.age !== undefined) sp.set("a", String(input.age));
  if (input.family) sp.set("fam", "1");
  if (input.avoid) sp.set("x", input.avoid);
  if (input.refinement) sp.set("r", input.refinement);
  for (const [fav, id] of Object.entries(input.choices ?? {})) sp.append("c", `${id}:${fav}`);
  for (const id of input.excludeIds ?? []) sp.append("s", id);
  return sp.toString();
}

const all = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const one = (v: string | string[] | undefined) => all(v)[0];

/** Returns a valid PlanInput or undefined when the URL does not describe one. */
export function decodeInput(params: Params): PlanInput | undefined {
  const language = one(params.l);
  const level = one(params.v);
  if (!language || !(LANGUAGE_CODES as readonly string[]).includes(language)) return undefined;
  const choices: Record<string, string> = {};
  for (const c of all(params.c)) {
    const i = c.indexOf(":");
    if (i > 0) choices[c.slice(i + 1)] = c.slice(0, i);
  }
  const age = one(params.a);
  const candidate = {
    language,
    level: level && (LEVELS as readonly string[]).includes(level) ? level : "beginner",
    favorites: all(params.f),
    ...(age && /^\d+$/.test(age) ? { age: Number(age) } : {}),
    ...(one(params.fam) === "1" ? { family: true } : {}),
    ...(one(params.x) ? { avoid: one(params.x) } : {}),
    ...(one(params.r) ? { refinement: one(params.r) } : {}),
    ...(Object.keys(choices).length ? { choices } : {}),
    ...(all(params.s).length ? { excludeIds: all(params.s) } : {}),
  };
  const parsed = planInputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
