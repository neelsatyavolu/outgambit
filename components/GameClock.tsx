"use client";

import { useEffect, useState } from "react";
import { clockMs } from "@/lib/client/clock";
import { formatClock } from "@/lib/format";

const LOW_MS = 20_000;

/** Each clock repaints independently of the board, on the browser's monotonic timeline. */
export function GameClock({ ms, running, at }: { ms: number; running: boolean; at: number }) {
  const [now, setNow] = useState(at);
  useEffect(() => {
    if (!running) return;
    let frame: number;
    const tick = () => {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  const left = clockMs(ms, running, at, now);
  const classes = ["clock", running ? "running" : "", running && left < LOW_MS ? "low" : ""];
  return <div className={classes.filter(Boolean).join(" ")} role="timer">{formatClock(left)}</div>;
}
