import type { ApiResponse } from "@/lib/http";

/** Calls this app's API and always resolves to the response envelope. */
export async function api<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      // A move has to beat a poll that is already on the wire.
      priority: method === "GET" ? "low" : "high",
      signal,
    });
    return (await response.json()) as ApiResponse<T>;
  } catch {
    return { success: false, error: "Could not reach the server. Check your connection." };
  }
}
