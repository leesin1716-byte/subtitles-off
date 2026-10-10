// 목표 언어별 나라 묶음·음악 태그 검색어·나이별 등급 상수

import type { LanguageCode } from "./types";

export interface LanguageProfile {
  label: string;
  /** filter.release_country values (country names, as in the Qloo docs example "United States"). */
  countries: string[];
  /** added when results are thin */
  widenCountries: string[];
  /** /v2/tags filter.query terms used to find music genre tags for this language */
  musicTagQueries: string[];
  /**
   * Tag names that really belong to the language. /v2/tags search is fuzzy: on 10-11 "j-pop" also
   * returned Jangle Pop and Jazz Pop, "french pop" returned plain Pop, "chanson" Russian Chanson.
   */
  musicTagName: RegExp;
}

export const LANGUAGES: Record<LanguageCode, LanguageProfile> = {
  ko: { label: "Korean", countries: ["South Korea"], widenCountries: [], musicTagQueries: ["k-pop", "korean"], musicTagName: /\bk\W*pop|korean/i },
  es: {
    label: "Spanish",
    countries: ["Spain", "Mexico", "Argentina", "Colombia"],
    widenCountries: ["Chile", "Peru", "Uruguay", "Cuba"],
    musicTagQueries: ["rock en español", "latin pop", "spanish"],
    musicTagName: /espa[nñ]ol|latin|idioma|spanish/i,
  },
  ja: { label: "Japanese", countries: ["Japan"], widenCountries: [], musicTagQueries: ["j-pop", "japanese"], musicTagName: /^j\W*pops?$|japanese/i },
  fr: {
    label: "French",
    countries: ["France", "Belgium"],
    widenCountries: ["Canada", "Switzerland"],
    musicTagQueries: ["french pop", "chanson"],
    musicTagName: /french|fran[cç]aise?|^chansons?$|nouvelle chanson/i,
  },
};

const KIDS = ["G", "PG", "TV-Y", "TV-Y7", "TV-G", "TV-PG"];
const TEENS = [...KIDS, "PG-13", "TV-14"];

/** Content ratings allowed for the learner's age (undefined = no rating filter). */
export function ratingsForAge(age: number | undefined, familySafe = false): string[] | undefined {
  if (age !== undefined && age < 13) return KIDS;
  if ((age !== undefined && age < 18) || familySafe) return TEENS;
  return undefined;
}

/** Concepts a person can ask to avoid → genre names to exclude (matched against tag names). */
export const AVOID_CONCEPTS: Record<string, string[]> = {
  violence: ["Thriller", "Crime", "Horror", "War", "Action"],
  violent: ["Thriller", "Crime", "Horror", "War", "Action"],
  gore: ["Horror"],
  horror: ["Horror"],
  scary: ["Horror", "Thriller"],
  crime: ["Crime"],
  war: ["War"],
  romance: ["Romance"],
  romantic: ["Romance"],
};
