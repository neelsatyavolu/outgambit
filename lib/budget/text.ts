import type { Blocked } from "./allowance";

/** Why a visitor cannot start a game against an opponent, in a sentence for them. */
export const BLOCKED_TEXT: Record<Blocked, string> = {
  player: "You have played your share of today's games against this opponent.",
  network: "This network has used its share of today's games against this opponent.",
  pace: "This opponent is resting so that it keeps to its weekly allowance. It opens again as the week goes on.",
  short_window: "This opponent is resting for a few hours.",
  free_limit: "This opponent has used its free allowance for today.",
  daily_budget: "This opponent has used its budget for today.",
  usage_unavailable: "This opponent's usage cannot be checked right now.",
  rate_limited: "This opponent is being asked too often. It opens again within the hour.",
};

/** The same, in a word or two, for a list. */
export const BLOCKED_LABEL: Record<Blocked, string> = {
  player: "your share used",
  network: "network share used",
  pace: "resting",
  short_window: "resting",
  free_limit: "free limit reached",
  daily_budget: "budget spent",
  usage_unavailable: "usage unavailable",
  rate_limited: "resting",
};
