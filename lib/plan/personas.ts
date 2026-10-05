// 데모용 가상 인물 3명(이름은 화면 장식일 뿐 API로 보내지 않는다)

import type { PlanInput } from "./types";

export interface Persona {
  id: string;
  name: string;
  blurb: string;
  input: PlanInput;
}

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
    },
  },
];
