import { z } from "zod";
import { LEVEL_IDS, MAX_ENTERED_RATING, MIN_RATING } from "../rating/elo";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const newPassword = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

const enteredRating = z.number().int().min(MIN_RATING).max(MAX_ENTERED_RATING);

/** How strong a player says they are: a level, or their chess.com ratings. */
export const skillSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("level"), level: z.enum(LEVEL_IDS) }),
  z.object({ kind: z.literal("chesscom"), bullet: enteredRating, regular: enteredRating }),
]);

export const registerSchema = z.object({
  email,
  password: newPassword,
  skill: skillSchema,
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(MAX_PASSWORD_LENGTH) });

/** What asking for a reset link answers, whether or not the address has an account. */
export const RESET_REQUESTED = "If an account exists for that address, a reset link is on its way.";
/** What a reset link that is unknown, used or expired answers. */
export const RESET_LINK_DEAD = "This reset link is no longer valid. Request a new one.";

export const forgotSchema = z.object({ email });

// A real token is 43 characters. One of the wrong shape is read as one nobody
// was sent, so it gets the same answer as any other dead link.
const MAX_TOKEN_LENGTH = 100;

export const resetSchema = z.object({ token: z.string().max(MAX_TOKEN_LENGTH).catch(""), password: newPassword });
