import type { Queryable } from "../db/client";
import type { Provider } from "../game/types";
import type { Closed, PoolKind } from "./pools";
import { supplies, type UsageSource } from "./supply";

/** One offered model's budget, for the owner: what has been used, what may be, and what that leaves. */
export type UsageLine = {
  provider: Provider;
  id: string;
  label: string;
  /** What `used` and `limit` are counted in: percent of a subscription's week, requests, or cents. */
  kind: PoolKind;
  used: number;
  limit: number;
  gamesLeft: number;
  closed: Closed | null;
  resetsAt: number | null;
  readAt: number | null;
  error: string | null;
};

/** The budget of every model given that has one. */
export async function usageReport(
  q: Queryable,
  usage: UsageSource,
  models: ReadonlyArray<{ provider: Provider; id: string; label: string }>,
  now: number,
): Promise<UsageLine[]> {
  const budgets = await supplies(q, usage, models.map((m) => ({ provider: m.provider, model: m.id })), now);
  return models.flatMap((model, i) => {
    const budget = budgets[i];
    if (!budget) return [];
    const { pool, left, ...figures } = budget;
    return [{ provider: model.provider, id: model.id, label: model.label, kind: pool.kind, gamesLeft: left, ...figures }];
  });
}
