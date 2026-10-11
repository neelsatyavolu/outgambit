import { findTimeControl } from "../config";

/** Ratings are kept separately for quick games and for slow ones. */
export const POOLS = ["bullet", "regular"] as const;
export type Pool = (typeof POOLS)[number];

export const POOL_LABELS: Record<Pool, string> = { bullet: "Bullet", regular: "Regular" };

/** Which rating a game counts toward: the quick time controls are bullet, the rest regular. */
export const poolOf = (timeControl: string): Pool => (findTimeControl(timeControl)?.fastOnly ? "bullet" : "regular");

/** How a new player describes themselves, and the rating that stands in for it until they have played. */
export const LEVELS = [
  { id: "new", label: "New to chess", rating: 400 },
  { id: "beginner", label: "Beginner", rating: 700 },
  { id: "beginner-intermediate", label: "Beginner to intermediate", rating: 1000 },
  { id: "intermediate", label: "Intermediate", rating: 1300 },
  { id: "intermediate-advanced", label: "Intermediate to advanced", rating: 1600 },
  { id: "advanced", label: "Advanced", rating: 1900 },
  { id: "expert", label: "Expert", rating: 2200 },
] as const;

export type LevelId = (typeof LEVELS)[number]["id"];
export const LEVEL_IDS = LEVELS.map((l) => l.id) as [LevelId, ...LevelId[]];

/** What a player tells us about their strength when they sign up. */
export type Skill = { kind: "level"; level: LevelId } | { kind: "chesscom"; bullet: number; regular: number };

export const MIN_RATING = 100;
export const MAX_ENTERED_RATING = 3500;
// Most players are rated lower at bullet than at slower games.
const BULLET_GAP = 100;

export function startingRatings(skill: Skill): Record<Pool, number> {
  if (skill.kind === "chesscom") return { regular: skill.regular, bullet: skill.bullet };
  const regular = LEVELS.find((l) => l.id === skill.level)!.rating;
  return { regular, bullet: Math.max(MIN_RATING, regular - BULLET_GAP) };
}

/** The share of points `a` is expected to take from `b`. */
export const expectedScore = (a: number, b: number): number => 1 / (1 + 10 ** ((b - a) / 400));

// A player's first games move their rating quickly, because it starts as their own guess.
const PLAYER_PROVISIONAL_GAMES = 10;
const PLAYER_K = { provisional: 40, settled: 24 };
// A model plays everyone, so each game moves it less; and less again when
// the opponent's rating is still a guess.
const MODEL_K = { againstNewcomer: 8, normal: 16 };
const NEWCOMER_GAMES = 5;

export type RatingInput = {
  player: number;
  model: number;
  /** The player's result: 1 for a win, 0.5 for a draw, 0 for a loss. */
  score: 0 | 0.5 | 1;
  playerGames: number;
  modelGames: number;
};

/** Both ratings after one game, by the Elo formula. */
export function rate(input: RatingInput): { player: number; model: number } {
  const expected = expectedScore(input.player, input.model);
  const playerK = input.playerGames < PLAYER_PROVISIONAL_GAMES ? PLAYER_K.provisional : PLAYER_K.settled;
  const modelK = input.playerGames < NEWCOMER_GAMES ? MODEL_K.againstNewcomer : MODEL_K.normal;
  return {
    player: Math.max(MIN_RATING, Math.round(input.player + playerK * (input.score - expected))),
    model: Math.max(MIN_RATING, Math.round(input.model - modelK * (input.score - expected))),
  };
}
