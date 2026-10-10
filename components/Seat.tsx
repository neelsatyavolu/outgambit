import { formatClock } from "@/lib/format";

const GLYPHS: Record<string, string> = { q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const LOW_MS = 20_000;

/** One side of the board: who it is, what they have captured, and their clock. */
export function Seat(props: { name: string; detail: string; captured: string[]; ms: number; running: boolean }) {
  const classes = ["clock", props.running ? "running" : "", props.running && props.ms < LOW_MS ? "low" : ""];
  return (
    <div className="seat">
      <div className="who">
        <span className="name">{props.name}</span>
        <span className="label">{props.detail}</span>
        <span className="lost" aria-label={`Captured: ${props.captured.length} pieces`}>
          {props.captured.map((piece) => GLYPHS[piece]).join("")}
        </span>
      </div>
      <div className={classes.filter(Boolean).join(" ")} role="timer">
        {formatClock(props.ms)}
      </div>
    </div>
  );
}
