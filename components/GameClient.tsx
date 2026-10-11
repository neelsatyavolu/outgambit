"use client";

import { Chess } from "chess.js";
import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { isLegalMove } from "@/lib/chess/premove";
import { api } from "@/lib/client/api";
import { isStale, shownFen } from "@/lib/client/sync";
import { capturedPieces, headline } from "@/lib/format";
import { opposite, type Color, type GameView } from "@/lib/game/types";
import { Board } from "./Board";
import { MoveList } from "./MoveList";
import { Seat } from "./Seat";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const POLL_MS = 1_000;
const TICK_MS = 100;
const NO_PREMOVES: readonly string[] = [];

type Synced = { view: GameView; at: number };
type Optimistic = { fen: string; from: string; to: string };

const signedChange = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");

const lastMoveOf = (uci: string | undefined) => (uci ? { from: uci.slice(0, 2), to: uci.slice(2, 4) } : null);

/** The time on a side's clock right now, counting down locally between polls. */
function liveMs(synced: Synced, color: Color, now: number): number {
  const { view } = synced;
  const stored = color === "white" ? view.whiteMs : view.blackMs;
  const running = view.status === "active" && view.turn === color;
  return running ? Math.max(0, stored - (now - synced.at)) : stored;
}

export function GameClient({ id, spectator }: { id: string; spectator: boolean }) {
  const [synced, setSynced] = useState<Synced | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Optimistic | null>(null);
  /** Moves the player has queued for their coming turns, soonest first. */
  const [premoves, setPremoves] = useState(NO_PREMOVES);
  const [shown, setShown] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sending = useRef(false);
  // The newest view and queue, for answers that arrive after the render that asked for them.
  const latest = useRef<GameView | null>(null);
  const queue = useRef(NO_PREMOVES);

  function requeue(next: readonly string[]) {
    queue.current = next;
    setPremoves(next);
  }

  /** Answers can arrive out of order, so one that is behind the board is dropped. Returns whether it was taken. */
  function accept(view: GameView): boolean {
    if (isStale(latest.current, view)) return false;
    latest.current = view;
    setSynced({ view, at: Date.now() });
    return true;
  }

  // Bumping this refetches the game straight away.
  const [refetch, setRefetch] = useState(0);
  const refresh = () => setRefetch((n) => n + 1);

  async function play(uci: string, view: GameView) {
    const chess = new Chess(view.fen);
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return;
    }
    sending.current = true;
    setError(null);
    setShown(null);
    setOptimistic({ fen: chess.fen(), from: uci.slice(0, 2), to: uci.slice(2, 4) });
    const response = await api<GameView>(`/api/games/${id}/moves`, "POST", { move: uci, ply: view.moves.length });
    sending.current = false;
    setOptimistic(null);
    if (response.success) receive(response.data);
    else {
      // Anything queued was planned on top of the move that was just refused.
      requeue(NO_PREMOVES);
      setError(response.error);
      refresh();
    }
  }

  /**
   * Takes a view from the server. When it brings the player's turn round, the
   * first queued premove goes straight out; if that move is not legal there,
   * the whole queue is dropped.
   */
  function receive(view: GameView) {
    if (!accept(view)) return;
    const [next, ...rest] = queue.current;
    if (!next || view.status !== "active" || view.turn !== view.playerColor) return;
    const legal = isLegalMove(view.fen, next);
    requeue(legal ? rest : NO_PREMOVES);
    if (legal) void play(next, view);
  }
  const onPolled = useEffectEvent(receive);

  const active = synced?.view.status === "active";
  const polling = synced === null || active;
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (sending.current) return;
      const response = await api<GameView>(`/api/games/${id}`);
      // A move sent meanwhile will bring back newer state than this poll.
      if (!alive || sending.current) return;
      if (response.success) onPolled(response.data);
      else if (response.error === "Game not found.") setMissing(true);
    };
    void load();
    const poll = polling ? setInterval(() => void load(), POLL_MS) : undefined;
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [id, polling, refetch]);

  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, [active]);

  if (missing) {
    return (
      <div className="notice">
        <h2>Game not found</h2>
        <p>This game does not exist, or it was started from a different browser.</p>
        <div className="actions">
          <Link className="btn" href="/">
            Back to setup
          </Link>
        </div>
      </div>
    );
  }
  if (!synced) return <p className="muted section">Loading…</p>;

  const { view } = synced;
  const live = shown === null || shown >= view.moves.length;
  const myTurn = !spectator && active && view.turn === view.playerColor;
  const myMove = myTurn && live && !optimistic;
  // Between the player's moves the board takes premoves instead.
  const premovable = !spectator && active && live && !myMove;
  const queued = active ? premoves : NO_PREMOVES;

  async function resign() {
    if (!window.confirm("Resign this game?")) return;
    const response = await api(`/api/games/${id}/resign`, "POST");
    if (!response.success) setError(response.error);
    refresh();
  }

  const count = live ? view.moves.length : shown;
  const fen = live ? (optimistic?.fen ?? view.fen) : shownFen(view, count, START_FEN);
  const lastMove = live ? (optimistic ?? lastMoveOf(view.moves.at(-1)?.uci)) : lastMoveOf(view.moves[count - 1]?.uci);
  const ai = opposite(view.playerColor);
  const lost = capturedPieces(view.fen);
  const end = headline(view, spectator);
  const aiThinking = active && view.turn === ai && !optimistic;
  const seat = (color: Color) => ({
    name: color === ai ? view.modelLabel : spectator ? "Player" : "You",
    detail: color === ai ? [view.effort ? `${view.effort} effort` : null, view.timeControl].filter(Boolean).join(" · ") : color,
    // A side shows the pieces it has taken, which are the ones the other side lost.
    captured: lost[opposite(color)],
    ms: liveMs(synced, color, now),
    running: active && view.turn === color,
  });

  return (
    <>
      {end && (
        <div className="notice" role="status" data-testid="result">
          <h2>{end.title}</h2>
          <p>{end.detail}</p>
          {view.rating && (
            <p className="num" data-testid="rating-change" style={{ marginTop: 8 }}>
              {spectator ? "Player" : "Your"} {view.pool} rating: {view.rating.playerBefore} → {view.rating.playerAfter} (
              {signedChange(view.rating.playerAfter - view.rating.playerBefore)}) · {view.modelLabel}:{" "}
              {view.rating.aiBefore} → {view.rating.aiAfter}
            </p>
          )}
          <div className="actions">
            <Link className="btn" href={spectator ? "/owner" : "/"}>
              {spectator ? "Back to games" : "New game"}
            </Link>
          </div>
        </div>
      )}
      <div className="game">
        <Board
          fen={fen}
          orientation={view.playerColor}
          interactive={myMove}
          premovable={premovable}
          premoves={live ? queued : NO_PREMOVES}
          lastMove={lastMove}
          onMove={(uci) => void play(uci, view)}
          onPremove={(uci) => requeue([...queue.current, uci])}
          onCancelPremoves={() => requeue(NO_PREMOVES)}
        />
        <aside className="side">
          <Seat {...seat(ai)} />
          <div className="thinking">
            {aiThinking && (
              <>
                <span className="dot live" />
                <span className="label">{view.modelLabel} is thinking</span>
              </>
            )}
            {myTurn && !optimistic && <span className="label">Your move</span>}
            {!live && <span className="label">Viewing move {count}</span>}
            {queued.length > 0 && (
              <button className="btn ghost small" type="button" style={{ marginLeft: "auto" }} onClick={() => requeue(NO_PREMOVES)}>
                Cancel {queued.length === 1 ? "premove" : `${queued.length} premoves`}
              </button>
            )}
          </div>
          <MoveList moves={view.moves} shown={count} onShow={(n) => setShown(n === view.moves.length ? null : n)} />
          <Seat {...seat(view.playerColor)} />
          <div className="controls">
            <div className="steps">
              <button className="btn ghost small" type="button" aria-label="Previous move" disabled={count === 0} onClick={() => setShown(count - 1)}>
                ←
              </button>
              <button className="btn ghost small" type="button" aria-label="Next move" disabled={live} onClick={() => setShown(count + 1 === view.moves.length ? null : count + 1)}>
                →
              </button>
              <button className="btn ghost small" type="button" disabled={live} onClick={() => setShown(null)}>
                Latest
              </button>
            </div>
            {!spectator && active && (
              <button className="btn danger small" type="button" onClick={() => void resign()}>
                Resign
              </button>
            )}
          </div>
          {error && <p className="error" style={{ margin: 0, padding: "0 16px 12px" }}>{error}</p>}
        </aside>
      </div>
    </>
  );
}
