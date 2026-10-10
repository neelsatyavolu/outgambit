import { randomUUID } from "node:crypto";
import type { Game } from "@/lib/game/types";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
/** 2026-10-09 12:00 in Los Angeles. */
export const NOON = Date.UTC(2026, 9, 9, 19, 0, 0);

export function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: randomUUID(),
    playerId: "player-1",
    ipHash: "ip-1",
    day: "2026-10-09",
    provider: "fake",
    model: "fake-1",
    modelLabel: "Fake",
    effort: null,
    timeControl: "10+10",
    initialMs: 600_000,
    incrementMs: 10_000,
    playerColor: "white",
    rival: null,
    fen: START_FEN,
    ply: 0,
    whiteMs: 600_000,
    blackMs: 600_000,
    turnStartedAt: NOON,
    aiLeaseUntil: null,
    status: "active",
    result: null,
    reason: null,
    createdAt: NOON,
    rated: false,
    rating: null,
    ...overrides,
  };
}
