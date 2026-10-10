import type { Adapter } from "../ai/types";
import type { Db } from "../db/client";
import type { OfferedModel } from "../owner/catalog";
import type { Game, Provider } from "./types";

/** Everything the game service needs from outside, so tests can supply their own. */
export type Deps = {
  db: Db;
  now: () => number;
  /** The opponent for a game, or null when its provider is no longer connected. */
  adapterFor: (game: Game) => Promise<Adapter | null>;
  /** Runs a job after the current request has been answered. */
  schedule: (job: () => Promise<void>) => void;
  findModel: (provider: Provider, id: string) => Promise<OfferedModel | null>;
  random: () => number;
};
