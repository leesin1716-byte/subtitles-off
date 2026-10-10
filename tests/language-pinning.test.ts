// 실데이터(10-11)에서 드러난 언어 이탈 두 가지(퍼지 음악 태그·출시국 목록)를 막는 규칙을 검증하는 테스트
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "@/lib/plan/languages";
import { firstCountry, preferHomeCountry } from "@/lib/plan/tools";
import type { QlooEntity } from "@/lib/qloo/types";

/** Music tag names live /v2/tags returned for each language's queries on 10-11. */
const LIVE_TAGS = {
  ko: { keep: ["K Pop", "Kpop", "K-pop Star", "Korean"], drop: [] as string[] },
  ja: { keep: ["J -pop", "Jpop", "J-pops", "Japanese Pop", "Japanese City Pop", "Japanese"], drop: ["Jangle Pop", "Jazz Pop"] },
  es: {
    keep: ["Rock En Espanol", "Rock Espanol", "En Espanol", "Rock En Tu Idioma", "Pop En Espanol", "Latin Pop", "Pop Latino", "Latin", "Spanish"],
    drop: ["Pop", "Indie Pop", "Synth Pop", "J -pop"],
  },
  fr: {
    keep: ["French Pop", "Chanson", "Chanson Francaise", "Chansons", "Nouvelle Chanson Francaise"],
    drop: ["Pop", "Russian Chanson", "Chanson Grecque", "Mes Chansons"],
  },
};

describe("music tags stay in the language", () => {
  for (const [code, { keep, drop }] of Object.entries(LIVE_TAGS)) {
    it(`${code}: keeps the language's tags and drops fuzzy matches`, () => {
      const re = LANGUAGES[code as keyof typeof LANGUAGES].musicTagName;
      expect(keep.filter((n) => !re.test(n))).toEqual([]);
      expect(drop.filter((n) => re.test(n))).toEqual([]);
    });
  }
});

const film = (name: string, release_country?: unknown): QlooEntity => ({
  entity_id: name,
  name,
  type: "urn:entity",
  subtype: "urn:entity:movie",
  properties: release_country === undefined ? {} : { release_country: release_country as string[] },
});

describe("titles from the language's own countries first", () => {
  it("reads the first country from an array or a comma string", () => {
    expect(firstCountry(film("a", ["United States", "Japan"]))).toBe("United States");
    expect(firstCountry(film("b", "Japan, France"))).toBe("Japan");
    expect(firstCountry(film("c"))).toBeUndefined();
  });

  it("drops films only released there (Luca, Onward) when enough home titles remain", () => {
    const list = [
      film("Luca", ["United States", "Japan"]),
      film("Your Name", ["Japan"]),
      film("Onward", ["United States", "Japan"]),
      film("Spirited Away", ["Japan", "United States"]),
      film("Unknown origin"),
    ];
    expect(preferHomeCountry(list, ["Japan"]).map((e) => e.name)).toEqual(["Your Name", "Spirited Away", "Unknown origin"]);
  });

  it("keeps Qloo's list as is when fewer than three home titles come back", () => {
    const list = [film("Luca", ["United States", "Japan"]), film("Your Name", ["Japan"]), film("Onward", ["United States", "Japan"])];
    expect(preferHomeCountry(list, ["Japan"]).map((e) => e.name)).toEqual(["Luca", "Your Name", "Onward"]);
  });

  it("returns at most 12 titles", () => {
    const many = Array.from({ length: 30 }, (_, i) => film(`k${i}`, ["South Korea"]));
    expect(preferHomeCountry(many, ["South Korea"])).toHaveLength(12);
  });
});
