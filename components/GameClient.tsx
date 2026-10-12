"use client";

import { Chess } from "chess.js";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { isLegalMove } from "@/lib/chess/premove";
import { api } from "@/lib/client/api";
import { handClock, syncClock, type ClockSync } from "@/lib/client/clock";
import { isStale, pollIntervalMs, retryPremove, shownFen } from "@/lib/client/sync";
import { useTabTitle } from "@/lib/client/tab-title";
import { capturedPieces, headline, materialLead } from "@/lib/format";
import { opposite, type Color, type GameView } from "@/lib/game/types";
import { Board } from "./Board";
import { GameControls } from "./GameControls";
import { GameResult } from "./GameResult";
import { MoveList } from "./MoveList";
import { Seat } from "./Seat";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const NO_PREMOVES: readonly string[] = [];
const YOUR_MOVE_TITLE = "Your move · Gambit";
/** Keys that step through the game, and how far each one goes from the move on show. */
const STEP_KEYS: Readonly<Record<string, (shown: number, total: number) => number>> = {
  ArrowLeft: (shown) => shown - 1,
  ArrowRight: (shown) => shown + 1,
  ArrowUp: () => 0,
  ArrowDown: (_shown, total) => total,
};

type Synced = { view: GameView; at: number };
type Optimistic = { fen: string; from: string; to: string };

const lastMoveOf = (uci: string | undefined) => (uci ? { from: uci.slice(0, 2), to: uci.slice(2, 4) } : null);

/** Whether a key press belongs to something the viewer is typing into. */
function isTyping(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element && (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)));
}

/** `initial` is the game as the server saw it when it sent the page, or null if this viewer may not see it. */
export function GameClient({ id, spectator, initial }: { id: string; spectator: boolean; initial: GameView | null }) {
  // One reading of the clock for everything that starts with the page, so the first drawing shows the clocks as sent.
  const [opened] = useState(() => performance.now());
  const [synced, setSynced] = useState<Synced | null>(() => (initial ? { view: initial, at: opened } : null));
  const [missing, setMissing] = useState(initial === null);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Optimistic | null>(null);
  /** Moves the player has queued for their coming turns, soonest first. */
  const [premoves, setPremoves] = useState(NO_PREMOVES);
  const [shown, setShown] = useState<number | null>(null);
  /** Clocks while a move is in flight: the player's clock stops and the opponent's starts. */
  const [held, setHeld] = useState<ReturnType<typeof handClock> | null>(null);
  const sending = useRef(false);
  // The poll in flight, so a move can drop it and take the connection.
  const pollAbort = useRef<AbortController | null>(null);
  const clockSync = useRef<ClockSync | null>(null);
  const clockAt = useRef(opened);
  // The newest view and queue, for answers that arrive after the render that asked for them.
  const latest = useRef<GameView | null>(initial);
  const queue = useRef(NO_PREMOVES);

  const requeue = useCallback((next: readonly string[]) => {
    queue.current = next;
    setPremoves(next);
  }, []);

  /** Answers can arrive out of order, so one that is behind the board is dropped. Returns whether it was taken. */
  function accept(view: GameView, sentAt: number, receivedAt: number): boolean {
    if (isStale(latest.current, view)) return false;
    latest.current = view;
    clockSync.current = syncClock(clockSync.current, view, sentAt, receivedAt);
    const at = view.serverNow - clockSync.current.offsetMs;
    clockAt.current = at;
    setSynced({ view, at });
    return true;
  }

  // Bumping this refetches the game straight away.
  const [refetch, setRefetch] = useState(0);
  const refresh = () => setRefetch((n) => n + 1);

  async function play(uci: string, view: GameView, fromQueue = false): Promise<boolean> {
    const chess = new Chess(view.fen);
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      if (fromQueue) requeue(NO_PREMOVES);
      return true;
    }
    // Drop a poll that has not answered yet, so this move is not stuck behind it.
    pollAbort.current?.abort();
    pollAbort.current = null;
    sending.current = true;
    setError(null);
    setShown(null);
    setOptimistic({ fen: chess.fen(), from: uci.slice(0, 2), to: uci.slice(2, 4) });
    setHeld(handClock(view, clockAt.current, performance.now()));
    const sentAt = performance.now();
    const lagMs = Math.min(10_000, Math.max(0, clockSync.current?.networkMs ?? 0));
    const response = await api<GameView>(`/api/games/${id}/moves`, "POST", { move: uci, ply: view.moves.length, lagMs });
    const receivedAt = performance.now();
    sending.current = false;
    setOptimistic(null);
    if (response.success) {
      // The move is on the board. Drop it before the next queued move is considered.
      if (fromQueue && queue.current[0] === uci) requeue(queue.current.slice(1));
      receive(response.data, sentAt, receivedAt);
      return true;
    }
    setHeld(null);
    // A premove that only lost the race, or never left, is tried again with the next view.
    if (fromQueue && retryPremove(response.error)) {
      refresh();
      return false;
    }
    if (fromQueue && response.error === "That move was already played.") {
      if (queue.current[0] === uci) requeue(queue.current.slice(1));
      refresh();
      return true;
    }
    // Anything queued was planned on top of the move that was just refused.
    requeue(NO_PREMOVES);
    setError(response.error);
    refresh();
    return true;
  }

  /**
   * Takes a view from the server. When it brings the player's turn round, the
   * first queued premove goes straight out; if that move is not legal there,
   * the whole queue is dropped.
   */
  function receive(view: GameView, sentAt: number, receivedAt: number) {
    setHeld(null);
    if (!accept(view, sentAt, receivedAt)) return;
    const next = queue.current[0];
    if (!next || view.status !== "active" || view.turn !== view.playerColor) return;
    if (!isLegalMove(view.fen, next)) {
      requeue(NO_PREMOVES);
      return;
    }
    void play(next, view, true);
  }
  const onPolled = useEffectEvent(receive);
  // Stable for the life of the screen, so a poll that only moves a clock does not redraw the board.
  const playRef = useRef(play);
  playRef.current = play;
  const onMove = useCallback((uci: string) => {
    const current = latest.current;
    if (current) void playRef.current(uci, current);
  }, []);
  const onPremove = useCallback((uci: string) => requeue([...queue.current, uci]), [requeue]);
  const onCancelPremoves = useCallback(() => requeue(NO_PREMOVES), [requeue]);

  const active = synced?.view.status === "active";
  const polling = !missing && (synced === null || active);
  const opponentToMove = Boolean(active && synced && synced.view.turn !== synced.view.playerColor);
  const pollMs = pollIntervalMs(synced?.view.timeControl, opponentToMove);
  useEffect(() => {
    // A game this viewer may not see is not asked for again.
    if (missing) return;
    let alive = true;
    const load = async () => {
      // One poll at a time. A second one would only compete with a move.
      if (sending.current || pollAbort.current) return;
      const controller = new AbortController();
      pollAbort.current = controller;
      const sentAt = performance.now();
      const response = await api<GameView>(`/api/games/${id}`, "GET", undefined, controller.signal);
      const receivedAt = performance.now();
      if (pollAbort.current === controller) pollAbort.current = null;
      // A move sent meanwhile will bring back newer state than this poll.
      if (!alive || sending.current || controller.signal.aborted) return;
      if (response.success) onPolled(response.data, sentAt, receivedAt);
      else if (response.error === "Game not found.") setMissing(true);
    };
    void load();
    const poll = polling ? setInterval(() => void load(), pollMs) : undefined;
    return () => {
      alive = false;
      pollAbort.current?.abort();
      pollAbort.current = null;
      clearInterval(poll);
    };
  }, [id, missing, polling, refetch, pollMs]);

  // A slow model can think for a minute, so the tab says when the wait is over.
  const myTurn = !spectator && synced?.view.status === "active" && synced.view.turn === synced.view.playerColor;
  useTabTitle(myTurn ? YOUR_MOVE_TITLE : null);

  // The arrow keys step through the game: left and right by a move, up to the start, down to the latest.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const step = STEP_KEYS[event.key];
    if (!step || !synced || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    event.preventDefault();
    const total = synced.view.moves.length;
    const to = step(shown === null ? total : Math.min(shown, total), total);
    setShown(to >= total ? null : Math.max(0, to));
  });
  useEffect(() => {
    const listen = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, []);

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
  const clock = held ?? { whiteMs: view.whiteMs, blackMs: view.blackMs, at: synced.at, turn: view.turn };
  const total = view.moves.length;
  const live = shown === null || shown >= total;
  const myMove = myTurn && live && !optimistic;
  // Between the player's moves the board takes premoves instead.
  const premovable = !spectator && active && live && !myMove;
  const queued = active ? premoves : NO_PREMOVES;

  async function resign() {
    const response = await api(`/api/games/${id}/resign`, "POST");
    if (!response.success) setError(response.error);
    refresh();
  }

  const count = live ? total : shown;
  const fen = live ? (optimistic?.fen ?? view.fen) : shownFen(view, count, START_FEN);
  const lastMove = live ? (optimistic ?? lastMoveOf(view.moves.at(-1)?.uci)) : lastMoveOf(view.moves[count - 1]?.uci);
  const ai = opposite(view.playerColor);
  const lost = capturedPieces(view.fen);
  const end = headline(view, spectator);
  const aiThinking = active && view.turn === ai && !optimistic;
  const show = (n: number) => setShown(n >= total ? null : Math.max(0, n));
  const seat = (color: Color, place: "top" | "bottom") => ({
    place,
    name: color === ai ? view.modelLabel : spectator ? "Player" : "You",
    detail: color === ai ? [view.effort ? `${view.effort} effort` : null, view.timeControl].filter(Boolean).join(" · ") : color,
    // A side shows the pieces it has taken, which are the ones the other side lost.
    captured: lost[opposite(color)],
    lead: materialLead(view.fen, color),
    ms: color === "white" ? clock.whiteMs : clock.blackMs,
    at: clock.at,
    running: active && clock.turn === color,
  });

  return (
    <div className="game">
      <Board
        fen={fen}
        orientation={view.playerColor}
        interactive={myMove}
        premovable={premovable}
        premoves={live ? queued : NO_PREMOVES}
        lastMove={lastMove}
        onMove={onMove}
        onPremove={onPremove}
        onCancelPremoves={onCancelPremoves}
      />
      <aside className="side">
        <Seat {...seat(ai, "top")} />
        {end && <GameResult view={view} end={end} spectator={spectator} />}
        {/* While the game is on, this line is always there, so the panel does not jump as the turn changes hands. */}
        {(!end || !live) && (
          <div className="thinking">
            {aiThinking && (
              <>
                <span className="dot live" />
                <span className="label">{view.modelLabel} is thinking</span>
              </>
            )}
            {myTurn && !optimistic && (
              <>
                <span className="dot live" />
                <span className="label yours">Your move</span>
              </>
            )}
            {!live && (
              <span className="label">
                Viewing move {count} of {total}
              </span>
            )}
            {queued.length > 0 && (
              <button className="btn ghost small cancel" type="button" onClick={() => requeue(NO_PREMOVES)}>
                Cancel {queued.length === 1 ? "premove" : `${queued.length} premoves`}
              </button>
            )}
          </div>
        )}
        <MoveList moves={view.moves} shown={count} onShow={show} />
        <Seat {...seat(view.playerColor, "bottom")} />
        <GameControls count={count} total={total} onShow={show} onResign={!spectator && active ? () => void resign() : null} />
        {error && <p className="error game-error">{error}</p>}
      </aside>
    </div>
  );
}
