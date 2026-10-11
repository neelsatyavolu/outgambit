import { formatClock } from "@/lib/format";

const GLYPHS: Record<string, string> = { q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const LOW_MS = 20_000;

/**
 * One side of the board: who it is, what they have captured, how far ahead
 * that leaves them, and their clock. `place` is the edge of the board the
 * side plays from, which is where a narrow screen puts it.
 */
export function Seat(props: {
  place: "top" | "bottom";
  name: string;
  detail: string;
  captured: string[];
  /** How far ahead this side is in material, in pawns. Shown only when it is ahead. */
  lead: number;
  ms: number;
  running: boolean;
}) {
  const classes = ["clock", props.running ? "running" : "", props.running && props.ms < LOW_MS ? "low" : ""];
  const ahead = props.lead > 0;
  return (
    <div className={`seat ${props.place}`}>
      <div className="who">
        <span className="name">{props.name}</span>
        <span className="label">{props.detail}</span>
        <span className="lost" aria-label={`Captured: ${props.captured.length} pieces${ahead ? `, ahead by ${props.lead}` : ""}`}>
          {props.captured.map((piece) => GLYPHS[piece]).join("")}
          {ahead && <span className="lead num">+{props.lead}</span>}
        </span>
      </div>
      <div className={classes.filter(Boolean).join(" ")} role="timer">
        {formatClock(props.ms)}
      </div>
    </div>
  );
}
