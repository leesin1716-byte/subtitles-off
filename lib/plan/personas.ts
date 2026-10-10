// 데모용 가상 인물 3명(이름은 화면 장식일 뿐 API로 보내지 않는다)

import type { PlanInput } from "./types";

export interface Persona {
  id: string;
  name: string;
  blurb: string;
  input: PlanInput;
}

/**
 * Example favorites that share a title with other Qloo entities are pinned to the intended entity
 * (ids from live /search, 10-11), so the examples never stop on "which one?" if popularity drifts.
 * A pin only applies when /search still returns that id; otherwise the normal rules run.
 * Sam's "The Office" (US 2005 vs UK 2001) is left unpinned on purpose: it is the example that
 * shows the clarifying question.
 */
export const PERSONAS: Persona[] = [
  {
    id: "mina",
    name: "Mina, 15",
    blurb: "Korean-American teen who wants to talk with her grandmother.",
    input: {
      language: "ko",
      level: "beginner",
      favorites: ["Minecraft", "Olivia Rodrigo", "Stranger Things"],
      age: 15,
      family: true,
      choices: {
        Minecraft: "CDBDE254-71F0-4640-8D04-5373BEAE5278", // 2011 game (not the 2020 TV entry)
        "Stranger Things": "07F1170E-BB69-4982-82C6-255F477EBBAD", // 2016 series (not the 2010 film)
      },
    },
  },
  {
    id: "sam",
    name: "Sam, 34",
    blurb: "Learning Spanish for his partner's family dinners.",
    input: {
      language: "es",
      level: "intermediate",
      favorites: ["The Office", "Arctic Monkeys", "Breaking Bad"],
      age: 34,
      choices: { "Breaking Bad": "D03D0913-A7B9-4C46-BFEB-958C1B3FA387" }, // 2008 series (not the band)
    },
  },
  {
    id: "jordan",
    name: "Jordan, 22",
    blurb: "Heading to Osaka for an exchange semester next spring.",
    input: {
      language: "ja",
      level: "beginner",
      favorites: ["The Legend of Zelda: Breath of the Wild", "Phoebe Bridgers", "Avatar: The Last Airbender"],
      age: 22,
      choices: {
        "The Legend of Zelda: Breath of the Wild": "7E606158-8878-49D6-82AB-4C83A83F9974", // the game (not the guide book)
        "Avatar: The Last Airbender": "088692C7-5BF8-4663-BC58-60D03A1A2A5A", // 2005 animated series (not 2024 or the game)
      },
    },
  },
];
