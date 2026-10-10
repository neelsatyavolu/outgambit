import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OWNER_PASSWORD: z.string().min(12),
  SECRETS_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64 encoded"),
  IP_SALT: z.string().min(16),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment. ${problems.join("; ")}`);
}

let cached: Env | null = null;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
