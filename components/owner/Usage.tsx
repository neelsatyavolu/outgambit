"use client";

import { useEffect, useState } from "react";
import type { UsageLine } from "@/lib/budget/report";
import { api } from "@/lib/client/api";
import { PROVIDER_LABELS } from "@/lib/format";

const REFRESH_MS = 60_000;

const CLOSED: Record<NonNullable<UsageLine["closed"]>, string> = {
  pace: "Closed: ahead of the weekly pace",
  short_window: "Closed: half the short window is used",
  free_limit: "Closed: free limit reached",
  daily_budget: "Closed: today's budget is spent",
  usage_unavailable: "Closed: usage cannot be read",
  rate_limited: "Closed for an hour: the provider said too many requests",
};

function figures(line: UsageLine): string {
  if (line.closed === "usage_unavailable") return line.error ?? "no reading";
  if (line.kind === "meter") return `${line.used.toFixed(0)}% of the week used · pace allows ${line.limit.toFixed(1)}%`;
  if (line.kind === "requests") return `${line.used} of ${line.limit} requests today`;
  return `${line.used.toFixed(2)}¢ of ${line.limit}¢ today`;
}

/** `version` changes whenever a connection or an offered model changes, so the list reloads. */
export function Usage({ version }: { version: number }) {
  const [lines, setLines] = useState<UsageLine[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const response = await api<UsageLine[]>("/api/owner/usage");
      if (alive && response.success) setLines(response.data);
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [version]);

  if (!lines) return <p className="muted">Loading…</p>;

  return (
    <div className="rows">
      {lines.length === 0 && <p className="row muted">No models are on offer yet.</p>}
      {lines.map((line) => (
        <div className="row" key={`${line.provider}/${line.id}`}>
          <span className="grow">
            {line.label}
            <span className="meta" style={{ marginLeft: 12 }}>
              {PROVIDER_LABELS[line.provider]}
            </span>
          </span>
          <span className="meta num">{figures(line)}</span>
          <span className="meta num">{line.closed ? CLOSED[line.closed] : `about ${line.gamesLeft} games left`}</span>
        </div>
      ))}
    </div>
  );
}
