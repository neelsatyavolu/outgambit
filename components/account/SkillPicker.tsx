"use client";

import { useState } from "react";
import { LEVELS, MAX_ENTERED_RATING, MIN_RATING, type LevelId, type Skill } from "@/lib/rating/elo";
import { Segmented } from "../Segmented";

type Kind = Skill["kind"];

const KINDS = [
  { value: "level", label: "Pick a level" },
  { value: "chesscom", label: "Use my chess.com ratings" },
] as const;

const entered = (text: string): number | null => {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) && value >= MIN_RATING && value <= MAX_ENTERED_RATING ? value : null;
};

/**
 * Asks how strong the player is: a level, or their chess.com bullet and rapid
 * ratings. Calls `onChange` with a complete answer, or null while it is not.
 */
export function SkillPicker({ onChange }: { onChange: (skill: Skill | null) => void }) {
  const [kind, setKind] = useState<Kind>("level");
  const [level, setLevel] = useState<LevelId | null>(null);
  const [bullet, setBullet] = useState("");
  const [regular, setRegular] = useState("");

  function report(next: { kind?: Kind; level?: LevelId | null; bullet?: string; regular?: string }) {
    const k = next.kind ?? kind;
    const l = next.level === undefined ? level : next.level;
    const b = entered(next.bullet ?? bullet);
    const r = entered(next.regular ?? regular);
    if (k === "level") onChange(l ? { kind: "level", level: l } : null);
    else onChange(b !== null && r !== null ? { kind: "chesscom", bullet: b, regular: r } : null);
  }

  return (
    <div className="stack">
      <span className="label">How strong are you?</span>
      <div>
        <Segmented
          label="How to say how strong you are"
          options={KINDS}
          value={kind}
          onChange={(next) => {
            setKind(next);
            report({ kind: next });
          }}
        />
      </div>
      {kind === "level" ? (
        <div className="rows" role="radiogroup" aria-label="Level">
          {LEVELS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              className="row"
              aria-checked={option.id === level}
              onClick={() => {
                setLevel(option.id);
                report({ level: option.id });
              }}
            >
              <span className="grow">{option.label}</span>
              <span className="meta num">starts at {option.rating}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="pair-fields">
          <label className="stack">
            <span className="label">Bullet</span>
            <input
              className="field"
              inputMode="numeric"
              aria-label="chess.com bullet rating"
              placeholder="e.g. 900"
              value={bullet}
              onChange={(event) => {
                setBullet(event.target.value);
                report({ bullet: event.target.value });
              }}
            />
          </label>
          <label className="stack">
            <span className="label">Rapid</span>
            <input
              className="field"
              inputMode="numeric"
              aria-label="chess.com rapid rating"
              placeholder="e.g. 1100"
              value={regular}
              onChange={(event) => {
                setRegular(event.target.value);
                report({ regular: event.target.value });
              }}
            />
          </label>
        </div>
      )}
      <span className="muted">
        This sets where your rating starts. After your first rated game it only changes by playing.
      </span>
    </div>
  );
}
