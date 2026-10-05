// 공유 링크 인코딩·디코딩 왕복과 잘못된 URL 처리 테스트
import { describe, expect, it } from "vitest";
import { decodeInput, encodeInput } from "@/lib/plan/share";
import { PERSONAS } from "@/lib/plan/personas";
import type { PlanInput } from "@/lib/plan/types";

const toParams = (qs: string) => {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(qs)) {
    const cur = out[k];
    out[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  }
  return out;
};

describe("share links", () => {
  it("round-trips every persona", () => {
    for (const p of PERSONAS) expect(decodeInput(toParams(encodeInput(p.input)))).toEqual(p.input);
  });

  it("round-trips choices, exclusions and refinement text", () => {
    const input: PlanInput = {
      language: "es",
      level: "advanced",
      favorites: ["The Office", "Arctic Monkeys"],
      choices: { "The Office": "mock-the-office-us" },
      excludeIds: ["mock-elite"],
      refinement: "No violence: she's 15 & loves music",
      avoid: "horror",
    };
    expect(decodeInput(toParams(encodeInput(input)))).toEqual(input);
  });

  it("rejects incomplete or hostile URLs", () => {
    expect(decodeInput({})).toBeUndefined();
    expect(decodeInput({ l: "xx", f: ["a", "b"] })).toBeUndefined();
    expect(decodeInput({ l: "ko", f: "only-one" })).toBeUndefined();
    expect(decodeInput({ l: "ko", f: ["a", "b"], c: "bad id!:a" })).toBeUndefined();
    expect(decodeInput({ l: "ko", f: ["a", "b"], v: "wizard" })?.level).toBe("beginner");
  });
});
