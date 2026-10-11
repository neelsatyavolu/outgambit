import Link from "next/link";
import type { GameView } from "@/lib/game/types";

const signedChange = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");

/**
 * How the game ended and what it did to the ratings. It sits in the panel
 * beside the board, so the board stays where it was when the game ends.
 */
export function GameResult(props: { view: GameView; end: { title: string; detail: string }; spectator: boolean }) {
  const { view, end, spectator } = props;
  const { rating } = view;
  return (
    <div className="result" role="status" data-testid="result">
      <h2>{end.title}</h2>
      <p>{end.detail}</p>
      {rating && (
        <p className="num ratings" data-testid="rating-change">
          <span>
            {spectator ? "Player" : "Your"} {view.pool} rating: {rating.playerBefore} → {rating.playerAfter} (
            {signedChange(rating.playerAfter - rating.playerBefore)})
          </span>
          <span>
            {view.modelLabel}: {rating.aiBefore} → {rating.aiAfter}
          </span>
        </p>
      )}
      <div className="actions">
        <Link className="btn" href={spectator ? "/owner" : "/"}>
          {spectator ? "Back to games" : "New game"}
        </Link>
      </div>
    </div>
  );
}
