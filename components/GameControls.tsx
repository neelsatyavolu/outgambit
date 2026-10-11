"use client";

import { useState } from "react";

/**
 * Steps through the game's moves and lets the player give up. Resigning
 * takes a second press, and "No" lands where "Resign" was, so a double click
 * in a fast game does not end it.
 */
export function GameControls(props: {
  /** How many moves the board is showing. */
  count: number;
  total: number;
  onShow: (count: number) => void;
  /** Null when there is nothing to resign: a spectator, or a game that is over. */
  onResign: (() => void) | null;
}) {
  const { count, total, onShow, onResign } = props;
  const [confirming, setConfirming] = useState(false);
  const atStart = count === 0;
  const atEnd = count >= total;

  const step = (label: string, glyph: string, to: number, disabled: boolean) => (
    <button className="btn ghost small" type="button" aria-label={label} title={label} disabled={disabled} onClick={() => onShow(to)}>
      {glyph}
    </button>
  );

  return (
    <div className="controls">
      <div className="steps">
        {step("First move", "⇤", 0, atStart)}
        {step("Previous move", "←", count - 1, atStart)}
        {step("Next move", "→", count + 1, atEnd)}
        {step("Latest move", "⇥", total, atEnd)}
      </div>
      {onResign &&
        (confirming ? (
          <div
            className="confirm"
            role="group"
            aria-label="Resign this game?"
            onKeyDown={(event) => event.key === "Escape" && setConfirming(false)}
          >
            <span className="label">Resign?</span>
            <button
              className="btn danger small"
              type="button"
              onClick={() => {
                setConfirming(false);
                onResign();
              }}
            >
              Yes
            </button>
            <button className="btn ghost small" type="button" autoFocus onClick={() => setConfirming(false)}>
              No
            </button>
          </div>
        ) : (
          <button className="btn danger small" type="button" onClick={() => setConfirming(true)}>
            Resign
          </button>
        ))}
    </div>
  );
}
