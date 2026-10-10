import { createHash } from "node:crypto";
import type { z } from "zod";
import { env } from "./env";

export type ApiResponse<T> = { success: true; data: T } | { success: false; error: string };

const NO_STORE = { "Cache-Control": "no-store" };

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ success: true, data } satisfies ApiResponse<T>, { status, headers: NO_STORE });
}

export function fail(error: string, status: number): Response {
  return Response.json({ success: false, error } satisfies ApiResponse<never>, { status, headers: NO_STORE });
}

/** True when a state-changing request was sent by this site's own pages. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

/** Addresses are only ever stored and compared as salted hashes. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${env().IP_SALT}:${ip}`).digest("hex");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isPlayerId = (value: string | undefined): value is string => value !== undefined && UUID.test(value);

/**
 * The request's JSON body, validated. Null when it is missing, malformed,
 * the wrong shape, or not declared as JSON (which a plain HTML form cannot do).
 */
export async function readBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S> | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
