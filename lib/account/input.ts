import { z } from "zod";
import { LEVEL_IDS, MAX_ENTERED_RATING, MIN_RATING } from "../rating/elo";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

const enteredRating = z.number().int().min(MIN_RATING).max(MAX_ENTERED_RATING);

/** How strong a player says they are: a level, or their chess.com ratings. */
export const skillSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("level"), level: z.enum(LEVEL_IDS) }),
  z.object({ kind: z.literal("chesscom"), bullet: enteredRating, regular: enteredRating }),
]);

export const registerSchema = z.object({
  email,
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  skill: skillSchema,
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(MAX_PASSWORD_LENGTH) });
