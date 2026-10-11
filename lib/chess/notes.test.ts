import { describe, expect, it } from "vitest";
import { replay } from "./rules";
import { focusMoves, survey, surveyPosition } from "./notes";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const ITALIAN = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"];
/** White to play Nxf7, hitting the queen and the rook. */
const FRIED_LIVER = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5"];
const KING_AND_PAWN = "8/6k1/8/8/3P4/4K3/8/8 w - - 0 1";
const ROOK_AGAINST_KNIGHT = "4k3/8/8/8/1n6/8/8/R3K3 w - - 0 1";

const after = (history: string[], uci: string) => survey(history).notes.get(uci);
const at = (fen: string, uci: string) => surveyPosition(fen, 60).notes.get(uci);

describe("what a move does in the opening", () => {
  it("says when it develops a piece or claims the centre, and nothing for a move that does neither", () => {
    expect(after([], "g1f3")).toEqual(["develops a piece"]);
    expect(after([], "e2e4")).toEqual(["claims the centre"]);
    expect(after([], "a2a3")).toEqual([]);
  });

  it("warns about an early queen move, a king walk and moving a developed piece again", () => {
    expect(after(["e4", "e5"], "d1h5")).toEqual(["brings the queen out early"]);
    expect(after(["e4", "e5"], "e1e2")).toEqual(["moves the king off its home square"]);
    expect(after(["Nf3", "Nf6"], "f3g5")).toEqual(["moves a piece that is already developed"]);
  });

  it("says that castling makes the king safe", () => {
    expect(after(ITALIAN, "e1g1")).toEqual(["makes the king safe"]);
  });
});

describe("what a move threatens", () => {
  it("says when it threatens checkmate next move", () => {
    // Qh5 eyes f7, which only the king defends and the bishop also attacks.
    expect(after(["e4", "e5", "Bc4", "Nc6"], "d1h5")).toEqual(["threatens checkmate next move", "brings the queen out early"]);
    expect(after(["e4", "e5", "Bc4", "Nc6"], "g1f3")).toEqual(["develops a piece"]);
  });

  it("names a fork of two pieces worth more than the attacker", () => {
    expect(after(FRIED_LIVER, "g5f7")).toEqual(["forks the queen and the rook"]);
  });

  it("counts the king in a fork when the move gives check", () => {
    const fen = "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1";
    expect(at(fen, "b5c7")).toEqual(["forks the king and the rook"]);
    // A check that hits nothing else is already in the move's own description.
    expect(at(fen, "b5d6")).toEqual([]);
  });

  it("says when it attacks a piece worth more, or one nothing defends", () => {
    expect(after(["e4", "d5", "exd5", "Qxd5"], "b1c3")).toEqual(["attacks the queen", "develops a piece"]);
    expect(at(ROOK_AGAINST_KNIGHT, "a1a4")?.[0]).toBe("attacks the undefended knight");
  });

  it("does not call it an attack when the piece is defended and worth no more", () => {
    // The knight on c6 is defended, and a bishop is worth the same.
    expect(after(["e4", "e5", "Nf3", "Nc6"], "f1b5")).toEqual(["develops a piece"]);
  });

  it("calls an equal capture that can be taken back an even trade", () => {
    expect(after(["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6", "Nd5"], "f6d5")?.[0]).toBe("an even trade");
  });
});

describe("what a move does later in the game", () => {
  it("says when a pawn with no enemy pawn in its way advances, and when it is about to promote", () => {
    expect(at(KING_AND_PAWN, "d4d5")).toEqual(["advances a passed pawn"]);
    expect(at("8/6k1/3P4/8/8/4K3/8/8 w - - 0 1", "d6d7")).toEqual(["pushes a passed pawn to one step from promoting"]);
    expect(at("8/4p1k1/8/8/3P4/4K3/8/8 w - - 0 1", "d4d5")).toEqual([]);
  });

  it("says when the king comes toward the centre in an endgame, and does not warn about leaving home", () => {
    expect(at(KING_AND_PAWN, "e3e4")).toEqual(["brings the king toward the centre"]);
    expect(at(KING_AND_PAWN, "e3e2")).toEqual([]);
    expect(at("8/6k1/8/8/8/8/3P4/4K3 w - - 0 1", "e1e2")).toEqual(["brings the king toward the centre"]);
  });

  it("says when a rook takes an open file or the seventh rank", () => {
    expect(at(ROOK_AGAINST_KNIGHT, "a1d1")).toEqual(["puts the rook on an open file"]);
    expect(at("6k1/p7/8/8/8/8/8/3RK3 w - - 0 1", "d1d7")).toContain("puts the rook on the seventh rank");
    // Sliding along a file it already holds is not news.
    expect(at("6k1/p7/8/8/8/8/8/3RK3 w - - 0 1", "d1d4")).not.toContain("puts the rook on an open file");
  });

  it("sees the board from black's side too", () => {
    expect(at("4k3/8/4p3/8/8/8/1r6/4K3 b - - 0 1", "e6e5")).toEqual(["advances a passed pawn"]);
    expect(at("4k3/8/8/8/8/1r6/P7/4K3 b - - 0 1", "b3b2")).toContain("puts the rook on the seventh rank");
  });
});

describe("what a quiet move does", () => {
  // Both sides developed and castled, nothing hanging: the kind of position where most moves look alike.
  const QUIET = "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 1";
  const quiet = (uci: string) => surveyPosition(QUIET, 30).notes.get(uci);

  it("says when a piece gets more squares to move to, or fewer", () => {
    expect(quiet("c1g5")).toEqual(["makes the bishop more active"]);
    expect(quiet("c3b1")).toEqual(["makes the knight less active"]);
    // One square more or fewer is not worth a mention.
    expect(quiet("c1d2")).toEqual([]);
  });

  it("says when a knight goes to the edge of the board", () => {
    expect(quiet("c3a4")).toEqual(["puts the knight on the edge of the board"]);
    expect(after([], "b1a3")).toEqual(["puts the knight on the edge of the board"]);
  });

  it("says when a pawn in front of the castled king moves", () => {
    expect(quiet("g2g4")).toEqual(["loosens the pawns in front of the king"]);
    expect(quiet("h2h3")).toEqual(["loosens the pawns in front of the king"]);
    expect(quiet("a2a3")).toEqual([]);
    // A king still in the middle has no pawn cover to loosen.
    expect(after(["e4", "e5"], "g2g3")).toEqual([]);
  });

  it("leaves a developing move in the opening at that", () => {
    expect(after(["e4", "e5", "Nf3", "Nc6"], "f1c4")).toEqual(["develops a piece"]);
  });

  it("has something to say about most moves in a quiet position", () => {
    const notes = [...surveyPosition(QUIET, 30).notes.values()];
    expect(notes.filter((n) => n.length > 0).length).toBeGreaterThan(notes.length / 2);
  });
});

describe("a move that goes back over old ground", () => {
  const SHUFFLE = ["Nf3", "Nf6", "Ng1", "Ng8"];

  it("says when it brings back a position the game has already had", () => {
    expect(after(SHUFFLE, "g1f3")).toEqual(["repeats an earlier position", "develops a piece"]);
    expect(after(SHUFFLE, "e2e4")).toEqual(["claims the centre"]);
  });

  it("does not count the same squares with the other side to move", () => {
    // 2... Ng8 brings back the starting position; 2. Ng1 alone only looks like it, with black to move instead.
    expect(after(["Nf3", "Nf6", "Ng1"], "f6g8")).toContain("repeats an earlier position");
    expect(after(["Nf3", "Nf6"], "f3g1")).not.toContain("repeats an earlier position");
  });
});

describe("what a move does toward finishing a won game", () => {
  const QUEEN_UP = "8/8/8/4k3/8/8/8/KQ6 w - - 0 1";

  it("says when it leaves the enemy king fewer squares", () => {
    expect(at(QUEEN_UP, "b1g6")?.[0]).toBe("leaves the enemy king fewer squares");
    expect(at(QUEEN_UP, "b1b2")).not.toContain("leaves the enemy king fewer squares");
  });

  it("says when the king comes closer to the enemy king, which a mate needs", () => {
    expect(at(QUEEN_UP, "a1b2")).toEqual(["brings the king closer to the enemy king"]);
  });

  it("says neither when the side to move is not clearly ahead", () => {
    const level = "3q4/8/8/4k3/8/8/8/KQ6 w - - 0 1";
    expect(at(level, "b1g6")).not.toContain("leaves the enemy king fewer squares");
    expect(at(level, "a1b2")).toEqual(["brings the king toward the centre"]);
  });

  it("says first of all when a move draws the game on the spot", () => {
    // The queen already covers every square next to the black king, so any quiet move is stalemate.
    const fen = "7k/5Q2/8/8/8/8/8/K7 w - - 0 1";
    expect(at(fen, "a1a2")?.[0]).toBe("draws the game at once");
    expect(at(fen, "f7f6")).not.toContain("draws the game at once");
  });

  it("calls a third repetition a draw, not just a repeat", () => {
    const twice = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1"];
    expect(after(twice, "f6g8")?.[0]).toBe("draws the game at once");
    expect(after(twice, "f6g8")).not.toContain("repeats an earlier position");
  });
});

describe("what a move sets up for the next move", () => {
  it("says when developing the bishop makes a checkmate threat possible", () => {
    // Bc4 makes Qh5, which was already legal, into a mate threat. Qh5 itself is still just an early queen.
    expect(after(["e4", "e5"], "f1c4")).toEqual(["sets up a checkmate threat", "develops a piece"]);
    expect(after(["e4", "e5"], "g1f3")).toEqual(["develops a piece"]);
    expect(after(["e4", "e5"], "d1h5")).toEqual(["brings the queen out early"]);
    expect(after(["e4", "e5"], "d1f3")).toEqual(["brings the queen out early"]);
    expect(after(["e4", "e5"], "f1a6")).toEqual(["develops a piece"]);
    expect(after(["e4", "e5"], "d2d4")).toEqual(["claims the centre"]);
  });

  it("says when a knight move makes a fork possible, and not when it only gets off a square", () => {
    // Nf6 blocks the queen from taking on g5, so Ng5 can be followed by Nxf7.
    expect(after(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"], "f3g5")).toEqual([
      "sets up a fork of the queen and the rook",
      "moves a piece that is already developed",
    ]);
    // The knight on f3 is in the queen's way. Stepping off would let her through, and that is not a plan.
    const italian = survey(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]).notes;
    expect([...italian.values()].some((notes) => notes.some((note) => note.includes("checkmate")))).toBe(false);
  });

  it("names the fork a safe knight move prepares", () => {
    const fen = "8/8/2k1q3/8/8/8/6K1/6N1 w - - 0 1";
    expect(at(fen, "g1f3")).toContain("sets up a fork of the king and the queen");
    expect((at(fen, "g1h3") ?? []).some((note) => note.startsWith("sets up"))).toBe(false);
  });

  it("keeps the move that prepares the mate when the list is cut down", () => {
    const opening = ["e4", "e5"];
    const offered = focusMoves(survey(opening), replay(opening).legal, () => 0.999).map((m) => m.san);
    expect(offered).toContain("Bc4");
    expect(offered).not.toContain("Qh5");
  });
});

describe("the position as a whole", () => {
  it("names the phase of the game", () => {
    expect(survey([]).phase).toBe("opening");
    expect(surveyPosition(START, 20).phase).toBe("middlegame");
    expect(surveyPosition(KING_AND_PAWN, 20).phase).toBe("endgame");
    // Few pieces left is an endgame however early it comes.
    expect(surveyPosition(KING_AND_PAWN, 6).phase).toBe("endgame");
  });

  it("counts the material lead of the side to move", () => {
    expect(survey([]).lead).toBe(0);
    expect(surveyPosition(ROOK_AGAINST_KNIGHT, 60).lead).toBe(2);
    expect(surveyPosition(ROOK_AGAINST_KNIGHT.replace(" w ", " b "), 60).lead).toBe(-2);
  });

  it("notes only the moves it is asked about", () => {
    expect([...survey([], ["e2e4", "g1f3"]).notes.keys()].sort()).toEqual(["e2e4", "g1f3"]);
    expect(survey([]).notes.size).toBe(20);
  });

  it("keeps the useful opening moves and leaves out the ones that do nothing", () => {
    const kept = focusMoves(survey([]), replay([]).legal, () => 0).map((m) => m.san);
    expect(kept.sort()).toEqual(["Nc3", "Nf3", "d4", "e4"]);
  });

  it("always keeps a mate threat, and never an early queen that does not threaten one", () => {
    const threat = ["e4", "e5", "Bc4", "Nc6"];
    expect(focusMoves(survey(threat), replay(threat).legal, () => 0).some((m) => m.san === "Qh5")).toBe(true);
    const opening = ["e4", "e5"];
    const offered = focusMoves(survey(opening), replay(opening).legal, () => 0).map((m) => m.san);
    expect(offered).not.toContain("Qh5");
    expect(offered).not.toContain("Ke2");
    expect(offered.length).toBeLessThanOrEqual(6);
  });

  it("keeps to the two most telling things about a move", () => {
    for (const notes of survey(FRIED_LIVER).notes.values()) expect(notes.length).toBeLessThanOrEqual(2);
  });
});
