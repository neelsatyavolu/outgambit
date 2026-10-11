import type { Adapter } from "../ai/types";
import type { UsageSource } from "../budget/supply";
import type { Db } from "../db/client";
import type { OfferedModel } from "../owner/catalog";
import type { Provider } from "./types";

/** Everything the game service needs from outside, so tests can supply their own. */
export type Deps = {
  db: Db;
  now: () => number;
  /**
   * The way to ask a provider's models for a move, or null when the provider is
   * no longer connected. `refresh` asks for new credentials first, after the
   * provider rejected the old ones.
   */
  adapterFor: (seat: { provider: Provider }, options?: { refresh?: boolean }) => Promise<Adapter | null>;
  /** Runs a job after the current request has been answered. */
  schedule: (job: () => Promise<void>) => void;
  findModel: (provider: Provider, id: string) => Promise<OfferedModel | null>;
  /** The models that play each other in the arena. */
  entrants: () => Promise<OfferedModel[]>;
  /** What the providers say has been used of the owner's accounts. */
  usage: UsageSource;
  random: () => number;
};
