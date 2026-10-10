"use client";

import { useEffect, useRef } from "react";
import type { Move } from "@/lib/game/types";

/** Moves in two columns. `shown` is how many moves the board is currently showing. */
export function MoveList(props: { moves: Move[]; shown: number; onShow: (count: number) => void }) {
  const { moves, shown, onShow } = props;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Follow the game when the latest move is the one on show.
    if (shown === moves.length && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [moves.length, shown]);

  const rows = Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => [moves[i * 2], moves[i * 2 + 1]] as const);
  const cell = (move: Move | undefined) =>
    move && (
      <button type="button" aria-current={move.ply + 1 === shown} onClick={() => onShow(move.ply + 1)}>
        {move.san}
      </button>
    );

  return (
    <div className="moves" ref={box} data-testid="moves">
      {moves.length === 0 ? (
        <p className="empty muted">No moves yet.</p>
      ) : (
        <table>
          <tbody>
            {rows.map(([white, black], i) => (
              <tr key={i}>
                <td className="n">{i + 1}.</td>
                <td>{cell(white)}</td>
                <td>{cell(black)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
