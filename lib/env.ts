import { z } from "zod";

const LOCAL_URL = "http://localhost:3000";

/** A web address, kept as its origin alone: a path or a trailing slash is dropped. */
const origin = z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin);

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OWNER_PASSWORD: z.string().min(12),
  SECRETS_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64 encoded"),
  IP_SALT: z.string().min(16),
  // Resend's key, for the password reset email. Without one the link is written to the server's console instead.
  RESEND_API_KEY: z.string().min(1).optional(),
  // The site's public address. Reset links are built on it, never on what a request says its host is.
  APP_URL: origin.default(LOCAL_URL),
});

// A live site has to be able to send the email, and to point it at itself.
const productionSchema = schema.extend({ RESEND_API_KEY: z.string().min(1), APP_URL: origin });

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = (source.NODE_ENV === "production" ? productionSchema : schema).safeParse(source);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment. ${problems.join("; ")}`);
}

let cached: Env | null = null;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
