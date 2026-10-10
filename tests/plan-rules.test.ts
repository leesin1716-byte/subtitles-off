// 난이도 규칙·4주 사다리·다듬기 파서·IP 한도 단위 테스트
import { describe, expect, it } from "vitest";
import { buildLadder, tierOf } from "@/lib/plan/ladder";
import { genresFromAvoid, parseRefinement } from "@/lib/plan/refine";
import { ratingsForAge } from "@/lib/plan/languages";
import { RateLimiter } from "@/lib/ratelimit";
import type { Candidate } from "@/lib/plan/types";

const c = (id: string, domain: Candidate["domain"], tier: 1 | 2 | 3, affinity: number): Candidate => ({
  entityId: id,
  name: id,
  domain,
  tier,
  affinity,
  tags: [],
});

describe("tierOf", () => {
  it("ranks animation/reality/sitcom easy, romance/comedy medium, thriller/period hard", () => {
    expect(tierOf(["Animation", "Fantasy"])).toBe(1);
    expect(tierOf(["Reality"])).toBe(1);
    expect(tierOf(["Sitcom", "Comedy"])).toBe(1);
    expect(tierOf(["Romance", "Comedy"])).toBe(2);
    expect(tierOf(["Drama"])).toBe(2);
    expect(tierOf(["Thriller", "Crime"])).toBe(3);
    expect(tierOf(["Historical", "Drama"])).toBe(3);
    expect(tierOf([])).toBe(2);
  });
});

describe("buildLadder", () => {
  const screen = [c("hard1", "tv_show", 3, 0.9), c("mid1", "tv_show", 2, 0.8), c("easy1", "movie", 1, 0.5), c("mid2", "movie", 2, 0.6), c("easy2", "tv_show", 1, 0.7)];
  const artists = [c("a1", "artist", 1, 0.4), c("a2", "artist", 1, 0.9)];

  it("puts the easiest titles first and the hardest last, with music every week", () => {
    const weeks = buildLadder(screen, artists, { level: "beginner" });
    expect(weeks).toHaveLength(4);
    const tiers = weeks.flatMap((w) => w.items.filter((i) => i.domain !== "artist").map((i) => i.tier));
    expect([...tiers].sort()).toEqual(tiers);
    for (const w of weeks) expect(w.items.some((i) => i.domain === "artist")).toBe(true);
    expect(weeks[0].items.find((i) => i.domain === "artist")!.entityId).toBe("a2");
    expect(weeks[3].title).toBe("Subtitles off");
  });

  it("drops the easiest tier for advanced learners when enough else is available", () => {
    const more = [...screen, c("mid3", "tv_show", 2, 0.3), c("hard2", "movie", 3, 0.2)];
    const weeks = buildLadder(more, artists, { level: "advanced" });
    expect(weeks.flatMap((w) => w.items).some((i) => i.tier === 1 && i.domain !== "artist")).toBe(false);
  });

  it("adds family activities only in family mode and keeps LLM notes", () => {
    const off = buildLadder(screen, artists, { level: "beginner" });
    expect(off.flatMap((w) => w.items).every((i) => i.activity === undefined)).toBe(true);
    const on = buildLadder(screen, artists, { level: "beginner", family: true, notes: { mid1: "Same small-town mystery feel." } });
    expect(on.flatMap((w) => w.items).every((i) => typeof i.activity === "string")).toBe(true);
    expect(on.flatMap((w) => w.items).find((i) => i.entityId === "mid1")!.note).toBe("Same small-town mystery feel.");
  });

  it("gives two songs a week when more music is requested", () => {
    const weeks = buildLadder(screen, [...artists, c("a3", "artist", 1, 0.5)], { level: "beginner", musicPerWeek: 2 });
    for (const w of weeks) expect(w.items.filter((i) => i.domain === "artist")).toHaveLength(2);
  });

  it("copes with no music and very few titles", () => {
    const weeks = buildLadder([c("only", "tv_show", 2, 0.5)], [], { level: "beginner" });
    expect(weeks.flatMap((w) => w.items)).toHaveLength(1);
  });
});

describe("parseRefinement", () => {
  it("reads violence exclusions, age and seen titles", () => {
    const r = parseRefinement("No violence please, she's 15. She already watched Squid Game and Kingdom.");
    expect(r.avoidGenres).toEqual(expect.arrayContaining(["Thriller", "Horror", "Crime"]));
    expect(r.age).toBe(15);
    expect(r.familySafe).toBe(true);
    expect(r.seenTitles).toEqual(["Squid Game", "Kingdom"]);
  });
  it("detects more music and ignores genres that are not negated", () => {
    const r = parseRefinement("More music! I love horror.");
    expect(r.moreMusic).toBe(true);
    expect(r.avoidGenres).toEqual([]);
  });
  it("returns an empty refinement for blank text", () => {
    expect(parseRefinement("  ")).toEqual({ avoidGenres: [], familySafe: false, moreMusic: false, seenTitles: [] });
  });
  it("maps a free-text avoid field to genres", () => {
    expect(genresFromAvoid("horror, war")).toEqual(["Horror", "War"]);
    expect(genresFromAvoid(undefined)).toEqual([]);
  });
});

describe("ratingsForAge", () => {
  it("caps ratings for children and teens only", () => {
    expect(ratingsForAge(10)).not.toContain("PG-13");
    expect(ratingsForAge(15)).toContain("TV-14");
    expect(ratingsForAge(15)).not.toContain("TV-MA");
    expect(ratingsForAge(30)).toBeUndefined();
    expect(ratingsForAge(30, true)).toContain("PG-13");
  });
});

describe("RateLimiter", () => {
  it("blocks after the per-minute limit and recovers after the window", () => {
    let t = 0;
    const rl = new RateLimiter([{ windowMs: 1000, max: 2 }], () => t);
    expect(rl.check("ip").allowed).toBe(true);
    expect(rl.check("ip").allowed).toBe(true);
    const blocked = rl.check("ip");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
    expect(rl.check("other").allowed).toBe(true);
    t = 1001;
    expect(rl.check("ip").allowed).toBe(true);
  });
});

describe("selectByRules", () => {
  it("keeps films in the plan even when every TV show has a higher affinity (live Mina, 10-11)", async () => {
    const { createContext } = await import("@/lib/plan/tools");
    const { selectByRules } = await import("@/lib/plan/compose");
    const { BudgetedClient } = await import("@/lib/qloo/budget");
    const { MockQlooClient } = await import("@/lib/qloo/mock");
    const ctx = createContext({ language: "ko", level: "beginner", favorites: ["a", "b"] }, new BudgetedClient(new MockQlooClient()), () => {});
    ctx.byDomain.tv_show = Array.from({ length: 10 }, (_, i) => c(`tv${i}`, "tv_show", 2, 0.99 - i * 0.001));
    ctx.byDomain.movie = Array.from({ length: 10 }, (_, i) => c(`film${i}`, "movie", 2, 0.5 - i * 0.01));
    ctx.byDomain.movie[9].tier = 1;
    const ids = selectByRules(ctx).map((p) => p.entityId);
    expect(ids.filter((id) => id.startsWith("film")).length).toBeGreaterThanOrEqual(3);
    expect(ids.filter((id) => id.startsWith("tv")).length).toBeGreaterThanOrEqual(3);
    expect(ids).toContain("film9"); // the one easy title still gets in for a beginner
  });
});
