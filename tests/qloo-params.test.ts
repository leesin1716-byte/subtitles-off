// 분야별 허용 파라미터·쿼리 직렬화·나이대 변환 테스트
import { describe, expect, it } from "vitest";
import { ageToBucket, assertInsightsParams, toQueryString } from "@/lib/qloo/params";
import { QlooError } from "@/lib/qloo/errors";

describe("assertInsightsParams", () => {
  it("accepts release_country and content_rating for movies and TV", () => {
    for (const type of ["urn:entity:movie", "urn:entity:tv_show"]) {
      expect(() =>
        assertInsightsParams({
          "filter.type": type,
          "filter.release_country": ["South Korea"],
          "filter.content_rating": ["PG", "PG-13"],
          "signal.interests.entities": ["abc"],
          "feature.explainability": true,
          take: 10,
        }),
      ).not.toThrow();
    }
  });

  it("rejects a country filter for artists (Qloo would silently ignore it)", () => {
    expect(() =>
      assertInsightsParams({ "filter.type": "urn:entity:artist", "filter.release_country": ["Japan"] }),
    ).toThrowError(/Not supported for urn:entity:artist: filter.release_country/);
  });

  it("rejects release_year for books (they use publication_year)", () => {
    expect(() =>
      assertInsightsParams({ "filter.type": "urn:entity:book", "filter.release_year.min": 1990 }),
    ).toThrowError(QlooError);
    expect(() =>
      assertInsightsParams({ "filter.type": "urn:entity:book", "filter.publication_year.min": 1990 }),
    ).not.toThrow();
  });

  it("rejects unknown filter.type, bad age buckets and requests without any signal or filter", () => {
    expect(() => assertInsightsParams({ "filter.type": "urn:entity:spaceship", take: 1 })).toThrow(/filter.type/);
    expect(() =>
      assertInsightsParams({ "filter.type": "urn:entity:movie", "signal.demographics.age": "teens" }),
    ).toThrow(/age bucket/);
    expect(() => assertInsightsParams({ "filter.type": "urn:entity:movie", take: 5 })).toThrow(/signal or filter/);
  });

  it("ignores keys whose value is undefined", () => {
    expect(() =>
      assertInsightsParams({
        "filter.type": "urn:entity:artist",
        "filter.release_country": undefined,
        "signal.interests.entities": ["x"],
      }),
    ).not.toThrow();
  });
});

describe("toQueryString", () => {
  it("sorts keys, comma-joins arrays and drops empty values", () => {
    expect(
      toQueryString({ take: 5, "filter.type": "urn:entity:movie", "filter.tags": ["a", "b"], x: undefined, y: [] }),
    ).toBe("filter.tags=a%2Cb&filter.type=urn%3Aentity%3Amovie&take=5");
  });
  it("is stable regardless of insertion order", () => {
    expect(toQueryString({ a: "1", b: "2" })).toBe(toQueryString({ b: "2", a: "1" }));
  });
});

describe("ageToBucket", () => {
  it.each([
    [15, "24_and_younger"],
    [24, "24_and_younger"],
    [25, "25_to_29"],
    [34, "30_to_34"],
    [44, "35_to_44"],
    [54, "45_to_54"],
    [80, "55_and_older"],
  ])("%i → %s", (age, bucket) => expect(ageToBucket(age)).toBe(bucket));
});
