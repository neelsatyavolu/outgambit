import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

export const registerSchema = z.object({
  email,
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(MAX_PASSWORD_LENGTH) });
