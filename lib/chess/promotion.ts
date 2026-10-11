import type { Color } from "@/lib/game/types";

/** Where a promotion square sits on a board seen from one side: its column from the left, and whether it is on the top row. */
export function promotionPlace(square: string, orientation: Color): { column: number; top: boolean } {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const white = orientation === "white";
  return { column: white ? file : 7 - file, top: square[1] === (white ? "8" : "1") };
}
