import { describe, expect, it } from "vitest";
import { promotionPlace } from "./promotion";

describe("promotionPlace", () => {
  it("puts a pawn promoting away from the viewer at the top of its file", () => {
    expect(promotionPlace("a8", "white")).toEqual({ column: 0, top: true });
    expect(promotionPlace("e8", "white")).toEqual({ column: 4, top: true });
  });

  it("counts files from the right when the board is turned round", () => {
    expect(promotionPlace("e1", "black")).toEqual({ column: 3, top: true });
    expect(promotionPlace("h1", "black")).toEqual({ column: 0, top: true });
  });

  it("puts a pawn promoting towards the viewer at the bottom", () => {
    expect(promotionPlace("h1", "white")).toEqual({ column: 7, top: false });
    expect(promotionPlace("a8", "black")).toEqual({ column: 7, top: false });
  });
});
