"use client";

import { Chess, type Square } from "chess.js";
import { useMemo, useState, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import type { Color } from "@/lib/game/types";

type Target = { to: string; promotion: boolean };
type Pending = { from: string; to: string };

const PROMOTIONS = [
  { piece: "q", label: "Queen" },
  { piece: "r", label: "Rook" },
  { piece: "b", label: "Bishop" },
  { piece: "n", label: "Knight" },
] as const;

const LAST_MOVE: CSSProperties = { boxShadow: "inset 0 0 0 100px rgba(76, 141, 255, 0.32)" };
const SELECTED: CSSProperties = { boxShadow: "inset 0 0 0 3px #4c8dff" };
const CHECK: CSSProperties = { boxShadow: "inset 0 0 0 100px rgba(229, 72, 58, 0.5)" };
const TARGET: CSSProperties = {
  backgroundImage: "radial-gradient(circle, rgba(14, 14, 13, 0.4) 0 16%, transparent 17%)",
};
const NOTATION: CSSProperties = { fontFamily: "var(--mono)", fontSize: 11 };
const CAPTURE: CSSProperties = { boxShadow: "inset 0 0 0 4px rgba(14, 14, 13, 0.4)" };

/** Legal destinations for each square, and the mover's king square when in check. */
function analyse(fen: string) {
  const chess = new Chess(fen);
  const targets = new Map<string, Target[]>();
  for (const move of chess.moves({ verbose: true })) {
    const list = targets.get(move.from) ?? [];
    if (!list.some((t) => t.to === move.to)) {
      targets.set(move.from, [...list, { to: move.to, promotion: Boolean(move.promotion) }]);
    }
  }
  const king = chess.inCheck() ? chess.findPiece({ type: "k", color: chess.turn() })[0] : undefined;
  const occupied = (square: string) => Boolean(chess.get(square as Square));
  return { targets, king, occupied };
}

export function Board(props: {
  fen: string;
  orientation: Color;
  /** Whether the viewer may move pieces right now. */
  interactive: boolean;
  lastMove: { from: string; to: string } | null;
  onMove: (uci: string) => void;
}) {
  const { fen, interactive, lastMove, onMove } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const position = useMemo(() => analyse(fen), [fen]);
  const from = interactive ? selected : null;
  const reachable = from ? (position.targets.get(from) ?? []) : [];

  /** Plays from→to if legal. Returns whether the piece should stay where it was dropped. */
  function attempt(source: string, to: string): boolean {
    const target = interactive ? position.targets.get(source)?.find((t) => t.to === to) : undefined;
    if (!target) return false;
    setSelected(null);
    if (target.promotion) {
      setPending({ from: source, to });
      return false;
    }
    onMove(`${source}${to}`);
    return true;
  }

  function clickSquare(square: string) {
    if (!interactive) return;
    if (from && attempt(from, square)) return;
    setSelected(position.targets.has(square) && square !== from ? square : null);
  }

  const squareStyles: Record<string, CSSProperties> = {
    ...(lastMove ? { [lastMove.from]: LAST_MOVE, [lastMove.to]: LAST_MOVE } : {}),
    ...(position.king ? { [position.king]: CHECK } : {}),
    ...Object.fromEntries(reachable.map((t) => [t.to, position.occupied(t.to) ? CAPTURE : TARGET])),
    ...(from ? { [from]: SELECTED } : {}),
  };

  return (
    <div className="board-wrap">
      <div className="board-frame" data-testid="board">
        <Chessboard
          options={{
            id: "gambit",
            position: fen,
            boardOrientation: props.orientation,
            allowDragging: interactive,
            allowDrawingArrows: false,
            animationDurationInMs: 150,
            lightSquareStyle: { backgroundColor: "var(--square-light)" },
            darkSquareStyle: { backgroundColor: "var(--square-dark)" },
            lightSquareNotationStyle: { color: "var(--square-dark)" },
            darkSquareNotationStyle: { color: "var(--square-light)" },
            alphaNotationStyle: NOTATION,
            numericNotationStyle: NOTATION,
            squareStyles,
            canDragPiece: ({ square }) => Boolean(interactive && square && position.targets.has(square)),
            onPieceDrag: ({ square }) => setSelected(square),
            onPieceDrop: ({ sourceSquare, targetSquare }) => Boolean(targetSquare && attempt(sourceSquare, targetSquare)),
            onSquareClick: ({ square }) => clickSquare(square),
          }}
        />
      </div>
      {pending && interactive && (
        <div className="promotion" role="group" aria-label="Promote pawn to">
          <span className="label">Promote to</span>
          {PROMOTIONS.map((option) => (
            <button
              key={option.piece}
              type="button"
              className="btn ghost small"
              onClick={() => {
                setPending(null);
                onMove(`${pending.from}${pending.to}${option.piece}`);
              }}
            >
              {option.label}
            </button>
          ))}
          <button type="button" className="btn ghost small" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
