// 목업 모드용 손수 만든 표본 엔티티(가짜 mock- ID, 공개 사실인 작품명·연도만, 이미지 없음)
//
// These are NOT Qloo responses. Titles and years are public facts; ratings, tags, popularity and
// the taste "links" between items are illustrative values chosen by hand so the sample flow works
// without a key. The UI labels this mode "Sample data".

import type { EntityType, QlooEntity, QlooTagRef } from "./types";

export interface Fixture {
  id: string;
  name: string;
  subtype: EntityType;
  year?: number;
  country?: string[];
  rating?: string;
  tags: string[]; // tag ids, see TAGS
  popularity: number;
  disambiguation?: string;
  /** Illustrative taste affinity from a seed id (without the mock- prefix) to this item, 0–1. */
  links?: Record<string, number>;
  seed?: boolean;
}

export const TAGS: Record<string, string> = {
  "urn:tag:genre:media:animation": "Animation",
  "urn:tag:genre:media:anime": "Anime",
  "urn:tag:genre:media:reality": "Reality",
  "urn:tag:genre:media:variety": "Variety",
  "urn:tag:genre:media:sitcom": "Sitcom",
  "urn:tag:genre:media:family": "Family",
  "urn:tag:genre:media:comedy": "Comedy",
  "urn:tag:genre:media:romance": "Romance",
  "urn:tag:genre:media:drama": "Drama",
  "urn:tag:genre:media:coming_of_age": "Coming of Age",
  "urn:tag:genre:media:fantasy": "Fantasy",
  "urn:tag:genre:media:science_fiction": "Science Fiction",
  "urn:tag:genre:media:action": "Action",
  "urn:tag:genre:media:sports": "Sports",
  "urn:tag:genre:media:food": "Food",
  "urn:tag:genre:media:mockumentary": "Mockumentary",
  "urn:tag:genre:media:thriller": "Thriller",
  "urn:tag:genre:media:crime": "Crime",
  "urn:tag:genre:media:horror": "Horror",
  "urn:tag:genre:media:historical": "Historical",
  "urn:tag:genre:media:mystery": "Mystery",
  "urn:tag:genre:media:war": "War",
  "urn:tag:genre:music:k_pop": "K-Pop",
  "urn:tag:genre:music:korean_indie": "Korean Indie",
  "urn:tag:genre:music:latin_pop": "Latin Pop",
  "urn:tag:genre:music:rock_en_espanol": "Rock en Español",
  "urn:tag:genre:music:spanish_indie": "Spanish Indie",
  "urn:tag:genre:music:j_pop": "J-Pop",
  "urn:tag:genre:music:japanese_rock": "Japanese Rock",
  "urn:tag:genre:music:city_pop": "City Pop",
  "urn:tag:genre:music:japanese_soundtrack": "Japanese Soundtrack",
  "urn:tag:genre:music:french_pop": "French Pop",
  "urn:tag:genre:music:chanson": "Chanson",
  "urn:tag:genre:music:indie_rock": "Indie Rock",
  "urn:tag:genre:music:pop": "Pop",
  "urn:tag:genre:music:indie_folk": "Indie Folk",
};

const g = (s: string) => `urn:tag:genre:media:${s}`;
const m = (s: string) => `urn:tag:genre:music:${s}`;
const KR = ["South Korea"];
const ES = ["Spain"];
const MX = ["Mexico"];
const AR = ["Argentina"];
const JP = ["Japan"];
const FR = ["France"];
const BE = ["Belgium"];
const US = ["United States"];
const UK = ["United Kingdom"];

type F = Omit<Fixture, "id"> & { key: string };
const f = (x: F): Fixture => {
  const { key, ...rest } = x;
  return { id: `mock-${key}`, ...rest };
};

export const FIXTURES: Fixture[] = [
  // ---- seeds (things people already love) ----
  f({ key: "minecraft", name: "Minecraft", subtype: "urn:entity:videogame", year: 2011, tags: [], popularity: 0.99, seed: true }),
  f({ key: "olivia-rodrigo", name: "Olivia Rodrigo", subtype: "urn:entity:artist", tags: [m("pop")], popularity: 0.98, seed: true }),
  f({ key: "stranger-things", name: "Stranger Things", subtype: "urn:entity:tv_show", year: 2016, country: US, rating: "TV-14", tags: [g("science_fiction"), g("horror"), g("coming_of_age")], popularity: 0.99, seed: true }),
  f({ key: "the-office-us", name: "The Office", subtype: "urn:entity:tv_show", year: 2005, country: US, rating: "TV-14", tags: [g("sitcom"), g("mockumentary"), g("comedy")], popularity: 0.99, disambiguation: "2005, United States", seed: true }),
  f({ key: "the-office-uk", name: "The Office", subtype: "urn:entity:tv_show", year: 2001, country: UK, rating: "TV-MA", tags: [g("sitcom"), g("mockumentary"), g("comedy")], popularity: 0.93, disambiguation: "2001, United Kingdom", seed: true }),
  f({ key: "arctic-monkeys", name: "Arctic Monkeys", subtype: "urn:entity:artist", tags: [m("indie_rock")], popularity: 0.97, seed: true }),
  f({ key: "breaking-bad", name: "Breaking Bad", subtype: "urn:entity:tv_show", year: 2008, country: US, rating: "TV-MA", tags: [g("crime"), g("drama"), g("thriller")], popularity: 0.99, seed: true }),
  f({ key: "zelda-botw", name: "The Legend of Zelda: Breath of the Wild", subtype: "urn:entity:videogame", year: 2017, tags: [], popularity: 0.97, seed: true }),
  f({ key: "phoebe-bridgers", name: "Phoebe Bridgers", subtype: "urn:entity:artist", tags: [m("indie_folk")], popularity: 0.9, seed: true }),
  f({ key: "avatar-tla", name: "Avatar: The Last Airbender", subtype: "urn:entity:tv_show", year: 2005, country: US, rating: "TV-Y7", tags: [g("animation"), g("fantasy"), g("action")], popularity: 0.97, seed: true }),

  // ---- Korean ----
  f({ key: "reply-1988", name: "Reply 1988", subtype: "urn:entity:tv_show", year: 2015, country: KR, rating: "TV-14", tags: [g("drama"), g("comedy"), g("family"), g("coming_of_age")], popularity: 0.86, links: { "stranger-things": 0.7, "olivia-rodrigo": 0.35, minecraft: 0.2 } }),
  f({ key: "hospital-playlist", name: "Hospital Playlist", subtype: "urn:entity:tv_show", year: 2020, country: KR, rating: "TV-14", tags: [g("drama"), g("comedy")], popularity: 0.84, links: { "olivia-rodrigo": 0.3, "stranger-things": 0.2, "the-office-us": 0.4 } }),
  f({ key: "running-man", name: "Running Man", subtype: "urn:entity:tv_show", year: 2010, country: KR, rating: "TV-PG", tags: [g("variety"), g("reality"), g("comedy")], popularity: 0.88, links: { minecraft: 0.55, "olivia-rodrigo": 0.3, "stranger-things": 0.25 } }),
  f({ key: "twenty-five-twenty-one", name: "Twenty-Five Twenty-One", subtype: "urn:entity:tv_show", year: 2022, country: KR, rating: "TV-14", tags: [g("romance"), g("coming_of_age"), g("sports")], popularity: 0.83, links: { "olivia-rodrigo": 0.8, "stranger-things": 0.3 } }),
  f({ key: "uncanny-counter", name: "The Uncanny Counter", subtype: "urn:entity:tv_show", year: 2020, country: KR, rating: "TV-14", tags: [g("fantasy"), g("action"), g("comedy")], popularity: 0.8, links: { "stranger-things": 0.75, minecraft: 0.4 } }),
  f({ key: "signal", name: "Signal", subtype: "urn:entity:tv_show", year: 2016, country: KR, rating: "TV-14", tags: [g("crime"), g("mystery"), g("thriller")], popularity: 0.79, links: { "stranger-things": 0.65, "breaking-bad": 0.5 } }),
  f({ key: "shinbi-haunted-house", name: "The Haunted House", subtype: "urn:entity:tv_show", year: 2016, country: KR, rating: "TV-Y7", tags: [g("animation"), g("fantasy"), g("family")], popularity: 0.7, disambiguation: "Animated series, 2016", links: { "stranger-things": 0.6, minecraft: 0.5 } }),
  f({ key: "all-of-us-are-dead", name: "All of Us Are Dead", subtype: "urn:entity:tv_show", year: 2022, country: KR, rating: "TV-MA", tags: [g("horror"), g("thriller"), g("coming_of_age")], popularity: 0.87, links: { "stranger-things": 0.85, minecraft: 0.45 } }),
  f({ key: "sweet-home", name: "Sweet Home", subtype: "urn:entity:tv_show", year: 2020, country: KR, rating: "TV-MA", tags: [g("horror"), g("thriller")], popularity: 0.85, links: { "stranger-things": 0.85, minecraft: 0.5 } }),
  f({ key: "kingdom", name: "Kingdom", subtype: "urn:entity:tv_show", year: 2019, country: KR, rating: "TV-MA", tags: [g("historical"), g("horror"), g("thriller")], popularity: 0.86, links: { "stranger-things": 0.55, "breaking-bad": 0.4 } }),
  f({ key: "squid-game", name: "Squid Game", subtype: "urn:entity:tv_show", year: 2021, country: KR, rating: "TV-MA", tags: [g("thriller"), g("drama")], popularity: 0.995, links: { "stranger-things": 0.3, "breaking-bad": 0.3 } }),
  f({ key: "the-host", name: "The Host", subtype: "urn:entity:movie", year: 2006, country: KR, rating: "R", tags: [g("horror"), g("science_fiction")], popularity: 0.82, links: { "stranger-things": 0.7 } }),
  f({ key: "space-sweepers", name: "Space Sweepers", subtype: "urn:entity:movie", year: 2021, country: KR, rating: "TV-14", tags: [g("science_fiction"), g("action")], popularity: 0.78, links: { minecraft: 0.6, "stranger-things": 0.5 } }),
  f({ key: "little-forest", name: "Little Forest", subtype: "urn:entity:movie", year: 2018, country: KR, rating: "PG", tags: [g("drama"), g("food")], popularity: 0.72, links: { "olivia-rodrigo": 0.45, minecraft: 0.35 } }),
  f({ key: "leafie", name: "Leafie, A Hen into the Wild", subtype: "urn:entity:movie", year: 2011, country: KR, rating: "PG", tags: [g("animation"), g("family")], popularity: 0.66, links: { minecraft: 0.45 } }),
  f({ key: "okja", name: "Okja", subtype: "urn:entity:movie", year: 2017, country: KR, rating: "TV-MA", tags: [g("science_fiction"), g("drama")], popularity: 0.83, links: { minecraft: 0.5, "stranger-things": 0.45 } }),
  f({ key: "parasite", name: "Parasite", subtype: "urn:entity:movie", year: 2019, country: KR, rating: "R", tags: [g("thriller"), g("drama")], popularity: 0.995, links: { "stranger-things": 0.2, "breaking-bad": 0.35 } }),
  f({ key: "newjeans", name: "NewJeans", subtype: "urn:entity:artist", tags: [m("k_pop")], popularity: 0.94, links: { "olivia-rodrigo": 0.8 } }),
  f({ key: "iu", name: "IU", subtype: "urn:entity:artist", tags: [m("k_pop")], popularity: 0.93, links: { "olivia-rodrigo": 0.75, "phoebe-bridgers": 0.3 } }),
  f({ key: "akmu", name: "AKMU", subtype: "urn:entity:artist", tags: [m("k_pop")], popularity: 0.86, links: { "olivia-rodrigo": 0.7 } }),
  f({ key: "day6", name: "DAY6", subtype: "urn:entity:artist", tags: [m("k_pop"), m("korean_indie")], popularity: 0.87, links: { "olivia-rodrigo": 0.6, "arctic-monkeys": 0.4 } }),
  f({ key: "the-rose", name: "The Rose", subtype: "urn:entity:artist", tags: [m("korean_indie")], popularity: 0.8, links: { "olivia-rodrigo": 0.5, "arctic-monkeys": 0.5 } }),
  f({ key: "hyukoh", name: "HYUKOH", subtype: "urn:entity:artist", tags: [m("korean_indie")], popularity: 0.79, links: { "arctic-monkeys": 0.75, "phoebe-bridgers": 0.5 } }),
  f({ key: "bts", name: "BTS", subtype: "urn:entity:artist", tags: [m("k_pop")], popularity: 0.999, links: { "olivia-rodrigo": 0.3 } }),

  // ---- Spanish ----
  f({ key: "paquita-salas", name: "Paquita Salas", subtype: "urn:entity:tv_show", year: 2016, country: ES, rating: "TV-MA", tags: [g("comedy"), g("mockumentary")], popularity: 0.74, links: { "the-office-us": 0.9, "the-office-uk": 0.85, "arctic-monkeys": 0.3 } }),
  f({ key: "aqui-no-hay-quien-viva", name: "Aquí no hay quien viva", subtype: "urn:entity:tv_show", year: 2003, country: ES, rating: "TV-14", tags: [g("sitcom"), g("comedy")], popularity: 0.76, links: { "the-office-us": 0.8, "the-office-uk": 0.6 } }),
  f({ key: "club-de-cuervos", name: "Club de Cuervos", subtype: "urn:entity:tv_show", year: 2015, country: MX, rating: "TV-MA", tags: [g("comedy"), g("sports")], popularity: 0.75, links: { "the-office-us": 0.7, "breaking-bad": 0.3 } }),
  f({ key: "los-simuladores", name: "Los Simuladores", subtype: "urn:entity:tv_show", year: 2002, country: AR, rating: "TV-14", tags: [g("comedy"), g("crime")], popularity: 0.7, links: { "the-office-us": 0.6, "breaking-bad": 0.55 } }),
  f({ key: "la-casa-de-las-flores", name: "The House of Flowers", subtype: "urn:entity:tv_show", year: 2018, country: MX, rating: "TV-MA", tags: [g("comedy"), g("drama")], popularity: 0.78, links: { "the-office-us": 0.5 } }),
  f({ key: "el-marginal", name: "El Marginal", subtype: "urn:entity:tv_show", year: 2016, country: AR, rating: "TV-MA", tags: [g("crime"), g("thriller"), g("drama")], popularity: 0.77, links: { "breaking-bad": 0.85 } }),
  f({ key: "money-heist", name: "Money Heist", subtype: "urn:entity:tv_show", year: 2017, country: ES, rating: "TV-MA", tags: [g("crime"), g("thriller")], popularity: 0.995, links: { "breaking-bad": 0.45, "the-office-us": 0.1 } }),
  f({ key: "elite", name: "Elite", subtype: "urn:entity:tv_show", year: 2018, country: ES, rating: "TV-MA", tags: [g("thriller"), g("drama"), g("coming_of_age")], popularity: 0.97, links: { "olivia-rodrigo": 0.4, "the-office-us": 0.1 } }),
  f({ key: "wild-tales", name: "Wild Tales", subtype: "urn:entity:movie", year: 2014, country: AR, rating: "R", tags: [g("comedy"), g("thriller")], popularity: 0.8, links: { "breaking-bad": 0.7, "the-office-us": 0.55, "arctic-monkeys": 0.3 } }),
  f({ key: "nine-queens", name: "Nine Queens", subtype: "urn:entity:movie", year: 2000, country: AR, rating: "R", tags: [g("crime"), g("thriller")], popularity: 0.74, links: { "breaking-bad": 0.85, "the-office-us": 0.3 } }),
  f({ key: "spanish-affair", name: "Spanish Affair", subtype: "urn:entity:movie", year: 2014, country: ES, rating: "R", tags: [g("comedy"), g("romance")], popularity: 0.72, links: { "the-office-us": 0.6 } }),
  f({ key: "klaus", name: "Klaus", subtype: "urn:entity:movie", year: 2019, country: ES, rating: "PG", tags: [g("animation"), g("family"), g("comedy")], popularity: 0.86, links: { "the-office-us": 0.35, "avatar-tla": 0.4, minecraft: 0.3 } }),
  f({ key: "secret-in-their-eyes", name: "The Secret in Their Eyes", subtype: "urn:entity:movie", year: 2009, country: AR, rating: "R", tags: [g("crime"), g("mystery"), g("drama")], popularity: 0.8, links: { "breaking-bad": 0.75 } }),
  f({ key: "pans-labyrinth", name: "Pan's Labyrinth", subtype: "urn:entity:movie", year: 2006, country: ["Mexico", "Spain"], rating: "R", tags: [g("fantasy"), g("war")], popularity: 0.97, links: { "breaking-bad": 0.25, "avatar-tla": 0.3 } }),
  f({ key: "cafe-tacvba", name: "Café Tacvba", subtype: "urn:entity:artist", tags: [m("rock_en_espanol")], popularity: 0.82, links: { "arctic-monkeys": 0.7 } }),
  f({ key: "babasonicos", name: "Babasónicos", subtype: "urn:entity:artist", tags: [m("rock_en_espanol")], popularity: 0.78, links: { "arctic-monkeys": 0.8 } }),
  f({ key: "carolina-durante", name: "Carolina Durante", subtype: "urn:entity:artist", tags: [m("spanish_indie")], popularity: 0.7, links: { "arctic-monkeys": 0.8, "the-office-us": 0.2 } }),
  f({ key: "soda-stereo", name: "Soda Stereo", subtype: "urn:entity:artist", tags: [m("rock_en_espanol")], popularity: 0.86, links: { "arctic-monkeys": 0.65 } }),
  f({ key: "natalia-lafourcade", name: "Natalia Lafourcade", subtype: "urn:entity:artist", tags: [m("latin_pop")], popularity: 0.84, links: { "phoebe-bridgers": 0.6, "arctic-monkeys": 0.35 } }),
  f({ key: "rosalia", name: "Rosalía", subtype: "urn:entity:artist", tags: [m("latin_pop")], popularity: 0.97, links: { "arctic-monkeys": 0.3, "olivia-rodrigo": 0.35 } }),
  f({ key: "bad-bunny", name: "Bad Bunny", subtype: "urn:entity:artist", tags: [m("latin_pop")], popularity: 0.999, links: { "arctic-monkeys": 0.2 } }),

  // ---- Japanese ----
  f({ key: "frieren", name: "Frieren: Beyond Journey's End", subtype: "urn:entity:tv_show", year: 2023, country: JP, rating: "TV-14", tags: [g("anime"), g("fantasy")], popularity: 0.9, links: { "zelda-botw": 0.9, "avatar-tla": 0.8, "phoebe-bridgers": 0.4 } }),
  f({ key: "mushishi", name: "Mushi-shi", subtype: "urn:entity:tv_show", year: 2005, country: JP, rating: "TV-14", tags: [g("anime"), g("fantasy"), g("mystery")], popularity: 0.74, links: { "zelda-botw": 0.8, "phoebe-bridgers": 0.5, "avatar-tla": 0.5 } }),
  f({ key: "haikyu", name: "Haikyu!!", subtype: "urn:entity:tv_show", year: 2014, country: JP, rating: "TV-14", tags: [g("anime"), g("sports"), g("comedy")], popularity: 0.88, links: { "avatar-tla": 0.7, "zelda-botw": 0.35 } }),
  f({ key: "midnight-diner", name: "Midnight Diner: Tokyo Stories", subtype: "urn:entity:tv_show", year: 2016, country: JP, rating: "TV-14", tags: [g("drama"), g("food")], popularity: 0.76, links: { "phoebe-bridgers": 0.7 } }),
  f({ key: "terrace-house", name: "Terrace House: Boys & Girls in the City", subtype: "urn:entity:tv_show", year: 2015, country: JP, rating: "TV-14", tags: [g("reality")], popularity: 0.78, links: { "phoebe-bridgers": 0.5 } }),
  f({ key: "makanai", name: "The Makanai: Cooking for the Maiko House", subtype: "urn:entity:tv_show", year: 2023, country: JP, rating: "TV-PG", tags: [g("drama"), g("food")], popularity: 0.72, links: { "phoebe-bridgers": 0.6, "zelda-botw": 0.3 } }),
  f({ key: "attack-on-titan", name: "Attack on Titan", subtype: "urn:entity:tv_show", year: 2013, country: JP, rating: "TV-MA", tags: [g("anime"), g("action"), g("horror")], popularity: 0.99, links: { "zelda-botw": 0.4, "avatar-tla": 0.5 } }),
  f({ key: "princess-mononoke", name: "Princess Mononoke", subtype: "urn:entity:movie", year: 1997, country: JP, rating: "PG-13", tags: [g("animation"), g("fantasy")], popularity: 0.95, links: { "zelda-botw": 0.9, "avatar-tla": 0.8 } }),
  f({ key: "totoro", name: "My Neighbor Totoro", subtype: "urn:entity:movie", year: 1988, country: JP, rating: "G", tags: [g("animation"), g("family"), g("fantasy")], popularity: 0.96, links: { "zelda-botw": 0.55, "avatar-tla": 0.5 } }),
  f({ key: "your-name", name: "Your Name.", subtype: "urn:entity:movie", year: 2016, country: JP, rating: "PG", tags: [g("animation"), g("romance"), g("fantasy")], popularity: 0.95, links: { "phoebe-bridgers": 0.5, "avatar-tla": 0.5 } }),
  f({ key: "perfect-days", name: "Perfect Days", subtype: "urn:entity:movie", year: 2023, country: JP, rating: "PG", tags: [g("drama")], popularity: 0.8, links: { "phoebe-bridgers": 0.8 } }),
  f({ key: "shoplifters", name: "Shoplifters", subtype: "urn:entity:movie", year: 2018, country: JP, rating: "R", tags: [g("drama"), g("crime")], popularity: 0.86, links: { "phoebe-bridgers": 0.6 } }),
  f({ key: "spirited-away", name: "Spirited Away", subtype: "urn:entity:movie", year: 2001, country: JP, rating: "PG", tags: [g("animation"), g("fantasy")], popularity: 0.995, links: { "zelda-botw": 0.5, "avatar-tla": 0.6 } }),
  f({ key: "joe-hisaishi", name: "Joe Hisaishi", subtype: "urn:entity:artist", tags: [m("japanese_soundtrack")], popularity: 0.88, links: { "zelda-botw": 0.9, "avatar-tla": 0.6 } }),
  f({ key: "hikaru-utada", name: "Hikaru Utada", subtype: "urn:entity:artist", tags: [m("j_pop")], popularity: 0.9, links: { "phoebe-bridgers": 0.6, "zelda-botw": 0.3 } }),
  f({ key: "kenshi-yonezu", name: "Kenshi Yonezu", subtype: "urn:entity:artist", tags: [m("j_pop")], popularity: 0.92, links: { "phoebe-bridgers": 0.5, "avatar-tla": 0.3 } }),
  f({ key: "mariya-takeuchi", name: "Mariya Takeuchi", subtype: "urn:entity:artist", tags: [m("city_pop")], popularity: 0.84, links: { "phoebe-bridgers": 0.5 } }),
  f({ key: "king-gnu", name: "King Gnu", subtype: "urn:entity:artist", tags: [m("japanese_rock")], popularity: 0.86, links: { "arctic-monkeys": 0.5, "phoebe-bridgers": 0.3 } }),
  f({ key: "yoasobi", name: "YOASOBI", subtype: "urn:entity:artist", tags: [m("j_pop")], popularity: 0.98, links: { "phoebe-bridgers": 0.3, "avatar-tla": 0.3 } }),

  // ---- French ----
  f({ key: "call-my-agent", name: "Call My Agent!", subtype: "urn:entity:tv_show", year: 2015, country: FR, rating: "TV-MA", tags: [g("comedy"), g("drama")], popularity: 0.85, links: { "the-office-us": 0.7, "the-office-uk": 0.7 } }),
  f({ key: "kaamelott", name: "Kaamelott", subtype: "urn:entity:tv_show", year: 2005, country: FR, rating: "TV-14", tags: [g("sitcom"), g("historical"), g("comedy")], popularity: 0.72, links: { "the-office-us": 0.6, "avatar-tla": 0.3 } }),
  f({ key: "miraculous", name: "Miraculous: Tales of Ladybug & Cat Noir", subtype: "urn:entity:tv_show", year: 2015, country: FR, rating: "TV-Y7", tags: [g("animation"), g("action"), g("family")], popularity: 0.9, links: { "avatar-tla": 0.55, "olivia-rodrigo": 0.3 } }),
  f({ key: "lupin", name: "Lupin", subtype: "urn:entity:tv_show", year: 2021, country: FR, rating: "TV-MA", tags: [g("crime"), g("thriller")], popularity: 0.98, links: { "breaking-bad": 0.4 } }),
  f({ key: "intouchables", name: "The Intouchables", subtype: "urn:entity:movie", year: 2011, country: FR, rating: "R", tags: [g("comedy"), g("drama")], popularity: 0.95, links: { "the-office-us": 0.45 } }),
  f({ key: "triplets-of-belleville", name: "The Triplets of Belleville", subtype: "urn:entity:movie", year: 2003, country: FR, rating: "PG-13", tags: [g("animation"), g("comedy")], popularity: 0.78, links: { "phoebe-bridgers": 0.4, "avatar-tla": 0.35 } }),
  f({ key: "les-choristes", name: "The Chorus", subtype: "urn:entity:movie", year: 2004, country: FR, rating: "PG-13", tags: [g("drama"), g("family")], popularity: 0.8, links: { "phoebe-bridgers": 0.5, "olivia-rodrigo": 0.3 } }),
  f({ key: "amelie", name: "Amélie", subtype: "urn:entity:movie", year: 2001, country: FR, rating: "R", tags: [g("romance"), g("comedy")], popularity: 0.99, links: { "phoebe-bridgers": 0.35 } }),
  f({ key: "pomme", name: "Pomme", subtype: "urn:entity:artist", tags: [m("french_pop"), m("indie_folk")], popularity: 0.7, links: { "phoebe-bridgers": 0.85, "olivia-rodrigo": 0.5 } }),
  f({ key: "angele", name: "Angèle", subtype: "urn:entity:artist", country: BE, tags: [m("french_pop")], popularity: 0.88, links: { "olivia-rodrigo": 0.7 } }),
  f({ key: "christine-and-the-queens", name: "Christine and the Queens", subtype: "urn:entity:artist", tags: [m("french_pop")], popularity: 0.86, links: { "phoebe-bridgers": 0.5 } }),
  f({ key: "stromae", name: "Stromae", subtype: "urn:entity:artist", country: BE, tags: [m("french_pop"), m("chanson")], popularity: 0.97, links: { "olivia-rodrigo": 0.3, "arctic-monkeys": 0.3 } }),
];

export function fixtureToEntity(fx: Fixture): QlooEntity {
  const tags: QlooTagRef[] = fx.tags.map((id) => ({
    id,
    name: TAGS[id] ?? id,
    type: id.split(":").slice(0, 4).join(":"),
  }));
  return {
    name: fx.name,
    entity_id: fx.id,
    type: "urn:entity",
    subtype: fx.subtype,
    properties: {
      ...(fx.year ? { release_year: fx.year } : {}),
      ...(fx.rating ? { content_rating: fx.rating } : {}),
      ...(fx.country ? { release_country: fx.country } : {}),
      // no image: the UI draws a neutral placeholder in sample mode
    },
    popularity: fx.popularity,
    tags,
    ...(fx.disambiguation ? { disambiguation: fx.disambiguation } : {}),
  };
}
