// 난이도 규칙으로 4주 사다리를 조립하는 결정적 코드(LLM 판단에 맡기지 않는다)

import type { Candidate, Level, PlanItem, PlanWeek } from "./types";

const EASY = ["animation", "anime", "reality", "variety", "sitcom", "family", "kids", "children", "cooking", "food"];
const HARD = ["thriller", "crime", "historical", "period", "war", "mystery", "horror", "legal", "political"];

/** 1 = easy (visual / everyday), 2 = medium (romance, comedy, drama), 3 = hard (dense or period dialogue). */
export function tierOf(tagNames: string[]): 1 | 2 | 3 {
  const names = tagNames.map((t) => t.toLowerCase());
  const has = (words: string[]) => names.some((n) => words.some((w) => n.includes(w)));
  if (has(EASY)) return 1;
  if (has(HARD)) return 3;
  return 2;
}

export const WEEK_FRAMES: { title: string; focus: string }[] = [
  { title: "Ear first", focus: "Put the music on repeat and watch with English subtitles. Just get used to the sound." },
  { title: "Catch the rhythm", focus: "Rewatch one scene you liked with target-language subtitles and repeat one short line out loud." },
  { title: "Target-language subtitles", focus: "Switch subtitles to the target language. Note three phrases you hear more than once." },
  { title: "Subtitles off", focus: "Watch one episode with subtitles off. Missing words is fine; follow the story." },
];

function tipFor(c: Candidate): string {
  if (c.domain === "artist") return "Read one song's lyrics in the original script next to a translation, then sing along to the chorus.";
  if (c.tier === 1) return "The pictures carry the story, so you can listen without worrying about every word.";
  if (c.tier === 2) return "Everyday dialogue: listen for greetings, thanks and how people address each other.";
  return "Dense dialogue: watch an episode once with English subtitles first, then again in the target language.";
}

function activityFor(c: Candidate): string {
  if (c.domain === "artist") return "Play a song for a grandparent and ask what they listened to at your age.";
  if (c.domain === "movie") return "Make it a family movie night and ask which scene felt most like home.";
  return "Watch the first episode together and let them pause to explain one moment.";
}

export interface LadderOptions {
  level: Level;
  family?: boolean;
  musicPerWeek?: 1 | 2;
  notes?: Record<string, string>;
}

/**
 * Screen items are sorted by (tier, -affinity) and split into four contiguous groups, so week 1
 * is the easiest and week 4 the hardest. Advanced learners skip the easiest tier when there is
 * enough else to watch. Music is spread over every week.
 */
export function buildLadder(screen: Candidate[], artists: Candidate[], opts: LadderOptions): PlanWeek[] {
  let pool = [...screen];
  if (opts.level === "advanced" && pool.filter((c) => c.tier > 1).length >= 4) pool = pool.filter((c) => c.tier > 1);
  if (opts.level === "beginner" && pool.filter((c) => c.tier < 3).length >= 4) {
    // keep at most two hard items for beginners, both in the last weeks
    const hard = pool.filter((c) => c.tier === 3).slice(0, 2);
    pool = [...pool.filter((c) => c.tier < 3), ...hard];
  }
  pool.sort((a, b) => a.tier - b.tier || (b.affinity ?? 0) - (a.affinity ?? 0));
  pool = pool.slice(0, 8);

  const groups: Candidate[][] = [[], [], [], []];
  pool.forEach((c, i) => groups[Math.min(3, Math.floor((i * 4) / Math.max(pool.length, 1)))].push(c));

  const perWeek = opts.musicPerWeek ?? 1;
  const music = [...artists].sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0));

  const toItem = (c: Candidate): PlanItem => ({
    ...c,
    tip: tipFor(c),
    ...(opts.family ? { activity: activityFor(c) } : {}),
    ...(opts.notes?.[c.entityId] ? { note: opts.notes[c.entityId] } : {}),
  });

  return WEEK_FRAMES.map((frame, w) => {
    const songs = music.length ? Array.from({ length: perWeek }, (_, k) => music[(w * perWeek + k) % music.length]) : [];
    const uniqueSongs = songs.filter((s, i) => songs.findIndex((x) => x.entityId === s.entityId) === i);
    return {
      week: (w + 1) as 1 | 2 | 3 | 4,
      title: frame.title,
      focus: frame.focus,
      items: [...uniqueSongs, ...groups[w]].map(toItem),
    };
  });
}
