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
  lagMs: z.number().min(0).max(10_000).optional(),
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
  const receivedAt = Date.now();
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  const { id } = await params;
  const body = await readBody(request, schema);
  if (!body) return fail("That is not a move.", 400);
  const arrivedAt = Date.now();
  const deps = await buildDeps();
  let player: string | undefined;
  const outcome = await playerMove(deps, id, async (tx) => {
    player = await playerId({ create: false }, tx);
    return player;
  }, body.move, body.ply, arrivedAt, body.lagMs ?? 0);
  if (!outcome.ok) return fail(REFUSALS[outcome.error].message, REFUSALS[outcome.error].status);
  // Return the new state, which for a fast opponent already holds its reply.
  const view = await getGameView(deps, id, { playerId: player, owner: false }, receivedAt);
  return view ? ok(view) : fail("Game not found.", 404);
}
