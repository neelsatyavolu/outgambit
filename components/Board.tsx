"use client";

import { Chess, type Square } from "chess.js";
import { useMemo, useState, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import { premoveTargets, premoveUci, withPremoves, type Placement } from "@/lib/chess/premove";
import type { Color } from "@/lib/game/types";

type Target = { to: string; promotion: boolean };
/** A promotion waiting for its piece. It belongs to one position and lapses when the board changes. */
type Pending = { from: string; to: string; fen: string };

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
const PREMOVE: CSSProperties = { boxShadow: "inset 0 0 0 100px rgba(14, 14, 13, 0.34)" };

/** A placement in the shape the board library draws. */
const drawn = (placement: Placement) =>
  Object.fromEntries(
    Object.entries(placement).map(([square, piece]) => [square, { pieceType: `${piece.color}${piece.type.toUpperCase()}` }]),
  );

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
  /** Whether the viewer may queue moves for their coming turns right now. */
  premovable: boolean;
  /** The queued moves, drawn as if already played. */
  premoves: readonly string[];
  lastMove: { from: string; to: string } | null;
  onMove: (uci: string) => void;
  onPremove: (uci: string) => void;
  onCancelPremoves: () => void;
}) {
  const { fen, interactive, premovable, premoves, lastMove, onMove } = props;
  const mine = props.orientation === "white" ? "w" : "b";
  const [selected, setSelected] = useState<string | null>(null);
  const [chosen, setPending] = useState<Pending | null>(null);
  const pending = chosen?.fen === fen ? chosen : null;
  const position = useMemo(() => analyse(fen), [fen]);
  const placement = useMemo(() => withPremoves(fen, premoves), [fen, premoves]);
  const queued = premoves.length > 0;
  const shown = useMemo(() => (queued ? drawn(placement) : fen), [queued, placement, fen]);
  const castling = fen.split(" ")[2] ?? "-";
  const holds = (square: string) => placement[square]?.color === mine;
  const from = interactive || (premovable && selected && holds(selected)) ? selected : null;
  const reachable = !from
    ? []
    : premovable
      ? premoveTargets(placement, from, castling)
      : (position.targets.get(from) ?? []).map((t) => t.to);
  const occupied = (square: string) => (premovable ? Boolean(placement[square]) : position.occupied(square));

  /** Queues from→to if the piece moves that way. Returns whether the piece should stay where it was dropped. */
  function premove(source: string, to: string): boolean {
    if (!holds(source) || !premoveTargets(placement, source, castling).includes(to)) return false;
    setSelected(null);
    props.onPremove(premoveUci(placement, source, to));
    return true;
  }

  /** Plays from→to if legal. Returns whether the piece should stay where it was dropped. */
  function attempt(source: string, to: string): boolean {
    if (premovable) return premove(source, to);
    const target = interactive ? position.targets.get(source)?.find((t) => t.to === to) : undefined;
    if (!target) return false;
    setSelected(null);
    setPending(null);
    if (target.promotion) {
      setPending({ from: source, to, fen });
      return false;
    }
    onMove(`${source}${to}`);
    return true;
  }

  function cancelPremoves() {
    setSelected(null);
    props.onCancelPremoves();
  }

  /** A click picks up one of the viewer's pieces or queues the held one; a click anywhere else calls the queue off. */
  function clickToPremove(square: string) {
    if (holds(square)) setSelected(square === from ? null : square);
    else if (!from || !premove(from, square)) cancelPremoves();
  }

  function clickSquare(square: string) {
    if (premovable) return clickToPremove(square);
    if (!interactive) return;
    if (from && attempt(from, square)) return;
    setSelected(position.targets.has(square) && square !== from ? square : null);
  }

  const squareStyles: Record<string, CSSProperties> = {
    ...(lastMove ? { [lastMove.from]: LAST_MOVE, [lastMove.to]: LAST_MOVE } : {}),
    // With premoves drawn, the king may no longer be shown on the square it is checked on.
    ...(position.king && !queued ? { [position.king]: CHECK } : {}),
    ...Object.fromEntries(premoves.flatMap((uci) => [uci.slice(0, 2), uci.slice(2, 4)]).map((square) => [square, PREMOVE])),
    ...Object.fromEntries(reachable.map((to) => [to, occupied(to) ? CAPTURE : TARGET])),
    ...(from ? { [from]: SELECTED } : {}),
  };

  return (
    <div className="board-wrap">
      <div className="board-frame" data-testid="board">
        <Chessboard
          options={{
            id: "gambit",
            position: shown,
            boardOrientation: props.orientation,
            allowDragging: interactive || premovable,
            allowDrawingArrows: false,
            animationDurationInMs: 150,
            lightSquareStyle: { backgroundColor: "var(--square-light)" },
            darkSquareStyle: { backgroundColor: "var(--square-dark)" },
            lightSquareNotationStyle: { color: "var(--square-dark)" },
            darkSquareNotationStyle: { color: "var(--square-light)" },
            alphaNotationStyle: NOTATION,
            numericNotationStyle: NOTATION,
            squareStyles,
            canDragPiece: ({ square }) =>
              Boolean(square && (premovable ? holds(square) : interactive && position.targets.has(square))),
            onPieceDrag: ({ square }) => setSelected(square),
            onPieceDrop: ({ sourceSquare, targetSquare }) => Boolean(targetSquare && attempt(sourceSquare, targetSquare)),
            onSquareClick: ({ square }) => clickSquare(square),
            onSquareRightClick: cancelPremoves,
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
