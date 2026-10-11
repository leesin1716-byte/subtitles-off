// 실측(10-11)에서 드러난 응답 모양: id 없는 아티스트 태그, /search 의 문자열 release_country
import { describe, expect, it } from "vitest";

describe("live tag shapes", () => {
  it("drops entity tags that come without an id or name (live artist voice_type tags, 10-11)", async () => {
    const { toCandidate } = await import("@/lib/plan/tools");
    const c = toCandidate(
      {
        entity_id: "a1",
        type: "urn:entity",
        name: "BLACKPINK",
        subtype: "urn:entity:artist",
        tags: [{ id: "urn:tag:genre:music:k_pop", name: "K Pop" }, { type: "urn:tag:voice_type:qloo" }] as never,
      },
      "artist",
      [],
    );
    expect(c.tags).toEqual([{ id: "urn:tag:genre:music:k_pop", name: "K Pop" }]);
  });
});

describe("compare with live /search shapes", () => {
  it("reads a single-string release_country from /search (live, 10-11)", async () => {
    const { pickSearchHit } = await import("@/lib/plan/compare");
    const hit = (name: string, country: string) => ({ entity_id: name + country, type: "urn:entity" as const, name, subtype: "urn:entity:tv_show", properties: { release_country: country as never } });
    const hits = [hit("Kingdom", "United States"), hit("Kingdom", "South Korea")];
    expect(pickSearchHit("Kingdom", hits, ["South Korea"])?.entity_id).toBe("KingdomSouth Korea");
  });
});
