import { z } from "zod";
import { playerMove, type MoveError } from "@/lib/game/move";
import { getGameView } from "@/lib/game/state";
import { fail, ok, readBody, sameOrigin } from "@/lib/http";
import { buildDeps, playerId } from "@/lib/server/context";

// A slow model's reply runs after the response, inside this limit.
export const maxDuration = 300;

const schema = z.object({
  move: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
  ply: z.number().int().min(0),
});

const REFUSALS: Record<MoveError, { message: string; status: number }> = {
  not_found: { message: "Game not found.", status: 404 },
  not_active: { message: "This game is over.", status: 409 },
  not_your_turn: { message: "It is not your turn.", status: 409 },
  stale: { message: "That move was already played.", status: 409 },
  illegal_move: { message: "That move is not legal.", status: 400 },
  out_of_time: { message: "You ran out of time.", status: 409 },
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  const { id } = await params;
  const body = await readBody(request, schema);
  if (!body) return fail("That is not a move.", 400);
  const player = await playerId({ create: false });
  if (!player) return fail("Game not found.", 404);
  const deps = await buildDeps();
  const outcome = await playerMove(deps, id, player, body.move, body.ply);
  if (!outcome.ok) return fail(REFUSALS[outcome.error].message, REFUSALS[outcome.error].status);
  // Return the new state, which for a fast opponent already holds its reply.
  const view = await getGameView(deps, id, { playerId: player, owner: false });
  return view ? ok(view) : fail("Game not found.", 404);
}
