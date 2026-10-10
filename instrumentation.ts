import { env } from "@/lib/env";

/** Refuses to start the server with a missing or malformed environment. */
export function register() {
  env();
}
