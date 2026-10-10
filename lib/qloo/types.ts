// Qloo API 응답 형태(공식 문서 기준)와 클라이언트 인터페이스 타입 정의

export type EntityType =
  | "urn:entity:artist"
  | "urn:entity:book"
  | "urn:entity:movie"
  | "urn:entity:tv_show"
  | "urn:entity:videogame"
  | "urn:entity:podcast";

export type InsightsFilterType = EntityType | "urn:tag";

export interface QlooTagRef {
  id: string;
  name: string;
  type?: string;
}

export interface QlooEntity {
  name: string;
  entity_id: string;
  type: "urn:entity";
  subtype: EntityType | string;
  properties?: {
    release_year?: number;
    release_date?: string;
    description?: string;
    content_rating?: string;
    duration?: number;
    image?: { url?: string };
    release_country?: string[];
    [key: string]: unknown;
  };
  popularity?: number;
  /** /search names the entity type here (e.g. ["urn:entity:videogame"]); Insights uses `subtype`. */
  types?: string[];
  tags?: QlooTagRef[];
  disambiguation?: string;
  /** Present on Insights results. Shapes of explainability are parsed defensively (see explain.ts). */
  query?: {
    affinity?: number;
    explainability?: unknown;
    measurements?: Record<string, number>;
  };
  external?: Record<string, unknown>;
}

/** GET /v2/insights (entity results) */
export interface InsightsResponse {
  success: boolean;
  results: {
    entities?: QlooEntity[];
    /** Raw tag objects (documented with `tag_id`); read them with parseTags(). */
    tags?: unknown[];
  };
  duration?: number;
  query?: { explainability?: unknown };
}

/** GET /search */
export interface SearchResponse {
  success: boolean;
  duration?: number;
  results: QlooEntity[];
}

/** One tag from /v2/tags or tag insights. Field names are normalised by parseTags(). */
export interface QlooTagResult {
  id: string;
  name: string;
  types?: string[];
  subtype?: string;
}

/** Query values are serialised as GET parameters; arrays are comma-joined. */
export type QueryValue = string | number | boolean | string[] | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface QlooClient {
  readonly mode: "live" | "mock";
  search(query: string, types: EntityType[], take?: number): Promise<SearchResponse>;
  tags(params: QueryParams): Promise<QlooTagResult[]>;
  insights(params: QueryParams): Promise<InsightsResponse>;
}
