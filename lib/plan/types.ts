// 언어 몰입 계획의 입력·결과·스트리밍 이벤트 타입과 입력 검증 스키마

import { z } from "zod";
import type { CallRecord } from "../qloo/budget";

export const LANGUAGE_CODES = ["ko", "es", "ja", "fr"] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];
export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];

const entityIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

export const planInputSchema = z.object({
  language: z.enum(LANGUAGE_CODES),
  level: z.enum(LEVELS),
  favorites: z.array(z.string().trim().min(1).max(80)).min(2).max(5),
  age: z.number().int().min(5).max(110).optional(),
  family: z.boolean().optional(),
  avoid: z.string().max(200).optional(),
  refinement: z.string().max(300).optional(),
  /** favorite text → chosen entity id, answered from a needs_input question */
  choices: z.record(z.string(), entityIdSchema).optional(),
  /** ids the person has already seen or wants removed */
  excludeIds: z.array(entityIdSchema).max(30).optional(),
});
export type PlanInput = z.infer<typeof planInputSchema>;

export type Domain = "tv_show" | "movie" | "artist";

export interface Seed {
  query: string;
  entityId: string;
  name: string;
  subtype: string;
  year?: number;
  disambiguation?: string;
  tagIds: string[];
}

export interface Because {
  seedName: string;
  score: number; // 0–1 contribution from Qloo explainability
}

export interface Candidate {
  entityId: string;
  name: string;
  domain: Domain;
  year?: number;
  rating?: string;
  imageUrl?: string;
  tags: { id: string; name: string }[];
  affinity?: number;
  because?: Because;
  tier: 1 | 2 | 3;
}

export interface PlanItem extends Candidate {
  tip: string;
  activity?: string;
  note?: string; // short English note from the LLM planner, if any
}

export interface PlanWeek {
  week: 1 | 2 | 3 | 4;
  title: string;
  focus: string;
  items: PlanItem[];
}

export interface Plan {
  language: LanguageCode;
  languageLabel: string;
  level: Level;
  seeds: Seed[];
  weeks: PlanWeek[];
  planner: "llm" | "rules";
  plannerNote: string;
  mode: "live" | "mock";
  calls: CallRecord[];
  applied: string[]; // human-readable constraints, e.g. "Release country: South Korea"
  /** Genre tags Qloo's taste analysis links to the favorites (Insights, filter.type=urn:tag). */
  tasteTags: string[];
  /** Whether an LLM was configured for this deployment (the compare panel needs one in live mode). */
  llmConfigured: boolean;
  /** ISO time the plan was first built, when it is replayed from the plan cache. */
  servedFromCache?: string;
}

export interface AmbiguityQuestion {
  favorite: string;
  options: { entityId: string; name: string; subtype: string; year?: number; disambiguation?: string }[];
}

export type PlanEvent =
  | { type: "trace"; step: string; detail?: string }
  | { type: "qloo"; call: CallRecord }
  | { type: "needs_input"; questions: AmbiguityQuestion[] }
  | { type: "plan"; plan: Plan }
  | { type: "error"; code: string; message: string };
