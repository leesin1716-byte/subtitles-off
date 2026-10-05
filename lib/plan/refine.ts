// 「폭력적인 건 빼 줘」 같은 영어 다듬기 요청을 구조화된 제약으로 바꾸는 규칙 파서

import { AVOID_CONCEPTS } from "./languages";

export interface Refinement {
  avoidGenres: string[];
  familySafe: boolean;
  age?: number;
  moreMusic: boolean;
  seenTitles: string[];
}

const NEGATION = "(?:no|not|without|skip|avoid|less|nothing|remove|don'?t want|cut)";

/** Genres named in a free-text "avoid" field, e.g. "horror, violence". */
export function genresFromAvoid(text: string | undefined): string[] {
  if (!text) return [];
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return unique(words.flatMap((w) => AVOID_CONCEPTS[w] ?? []));
}

export function parseRefinement(text: string | undefined): Refinement {
  const out: Refinement = { avoidGenres: [], familySafe: false, moreMusic: false, seenTitles: [] };
  if (!text?.trim()) return out;
  const t = text.toLowerCase();

  for (const [concept, genres] of Object.entries(AVOID_CONCEPTS)) {
    const re = new RegExp(`${NEGATION}\\s+(?:\\w+\\s+){0,2}${concept}\\b`);
    if (re.test(t)) out.avoidGenres.push(...genres);
  }
  out.avoidGenres = unique(out.avoidGenres);

  const age = t.match(/\b(\d{1,2})\s*(?:years?\s*old|yo|y\/o)\b/) ?? t.match(/\b(?:she|he|they|i)(?:'s|'m| is| am| are)\s+(\d{1,2})\b/);
  if (age) out.age = Number(age[1]);
  if (/\b(kid|kids|child|children|family[- ]friendly|age[- ]appropriate|teen|teenager)\b/.test(t) || (out.age !== undefined && out.age < 18)) {
    out.familySafe = true;
  }
  if (/\bmore\s+(music|songs?|artists?)\b/.test(t)) out.moreMusic = true;

  // "already seen Squid Game and Kingdom", "watched Parasite"
  const seen = text.match(/(?:already\s+(?:seen|watched|saw)|seen|watched)\s+([^.;!?]+)/i);
  if (seen) {
    out.seenTitles = seen[1]
      .split(/,|\band\b|&/i)
      .map((s) => s.trim().replace(/^the\s+show\s+|^the\s+movie\s+/i, ""))
      .filter((s) => s.length > 1);
  }
  return out;
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}
