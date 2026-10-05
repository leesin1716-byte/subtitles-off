// 분야별 허용 파라미터 목록과 GET 쿼리 직렬화(잘못된 파라미터는 Qloo가 조용히 무시하므로 코드로 막는다)

import { QlooError } from "./errors";
import type { InsightsFilterType, QueryParams } from "./types";

/** From the Qloo "Entity Type Parameter Guide" (docs copy in the project notes, 2026-07). */
const COMMON_ENTITY = [
  "filter.type",
  "bias.trends",
  "filter.exclude.entities",
  "filter.exclude.tags",
  "operator.exclude.tags",
  "filter.external.exists",
  "operator.filter.external.exists",
  "filter.parents.types",
  "filter.popularity.min",
  "filter.popularity.max",
  "filter.results.entities",
  "filter.results.entities.query",
  "filter.tags",
  "operator.filter.tags",
  "offset",
  "signal.demographics.age",
  "signal.demographics.audiences",
  "signal.demographics.audiences.weight",
  "signal.demographics.gender",
  "signal.interests.entities",
  "signal.interests.tags",
  "take",
] as const;

/** Output features accepted for every entity type. */
const FEATURES = ["feature.explainability", "page"] as const;

const SCREEN_EXTRA = [
  "filter.content_rating",
  "filter.release_year.min",
  "filter.release_year.max",
  "filter.release_country",
  "operator.filter.release_country",
  "filter.rating.min",
  "filter.rating.max",
] as const;

export const ALLOWED_PARAMS: Record<InsightsFilterType, ReadonlySet<string>> = {
  "urn:entity:artist": new Set([...COMMON_ENTITY, ...FEATURES]),
  "urn:entity:movie": new Set([...COMMON_ENTITY, ...SCREEN_EXTRA, ...FEATURES]),
  "urn:entity:tv_show": new Set([
    ...COMMON_ENTITY,
    ...SCREEN_EXTRA,
    "filter.finale_year.min",
    "filter.finale_year.max",
    "filter.latest_known_year.min",
    "filter.latest_known_year.max",
    ...FEATURES,
  ]),
  "urn:entity:book": new Set([
    ...COMMON_ENTITY,
    "filter.publication_year.min",
    "filter.publication_year.max",
    ...FEATURES,
  ]),
  "urn:entity:podcast": new Set([...COMMON_ENTITY, ...FEATURES]),
  "urn:entity:videogame": new Set([...COMMON_ENTITY, ...FEATURES]),
  "urn:tag": new Set([
    "filter.type",
    "filter.tag.types",
    "filter.parents.types",
    "filter.results.tags",
    "signal.interests.entities",
    "signal.interests.tags",
    "signal.demographics.age",
    "diversify.by",
    "diversify.take",
    "take",
    "page",
    "offset",
  ]),
};

export const AGE_BUCKETS = [
  "24_and_younger",
  "25_to_29",
  "30_to_34",
  "35_to_44",
  "45_to_54",
  "55_and_older",
] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export function ageToBucket(age: number): AgeBucket {
  if (age <= 24) return "24_and_younger";
  if (age <= 29) return "25_to_29";
  if (age <= 34) return "30_to_34";
  if (age <= 44) return "35_to_44";
  if (age <= 54) return "45_to_54";
  return "55_and_older";
}

/** Throws before a request is sent if any parameter is not supported for the filter.type. */
export function assertInsightsParams(params: QueryParams): void {
  const type = params["filter.type"];
  if (typeof type !== "string" || !(type in ALLOWED_PARAMS)) {
    throw new QlooError("invalid_params", `Unsupported or missing filter.type: ${String(type)}`);
  }
  const allowed = ALLOWED_PARAMS[type as InsightsFilterType];
  const bad = Object.keys(params).filter((k) => params[k] !== undefined && !allowed.has(k));
  if (bad.length) {
    throw new QlooError("invalid_params", `Not supported for ${type}: ${bad.join(", ")}`);
  }
  const age = params["signal.demographics.age"];
  if (age !== undefined) {
    const values = Array.isArray(age) ? age : String(age).split(",");
    const wrong = values.filter((v) => !(AGE_BUCKETS as readonly string[]).includes(v));
    if (wrong.length) throw new QlooError("invalid_params", `Unknown age bucket: ${wrong.join(", ")}`);
  }
  const hasSignalOrFilter = Object.keys(params).some(
    (k) => k !== "filter.type" && (k.startsWith("signal.") || k.startsWith("filter.")) && params[k] !== undefined,
  );
  if (!hasSignalOrFilter) {
    throw new QlooError("invalid_params", "At least one signal or filter is required");
  }
}

/**
 * Serialises params as a stable query string: keys sorted, arrays comma-joined,
 * empty values dropped. The same input always yields the same string (used as the cache key).
 */
export function toQueryString(params: QueryParams): string {
  const sp = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      sp.set(key, value.join(","));
    } else {
      sp.set(key, String(value));
    }
  }
  return sp.toString();
}
