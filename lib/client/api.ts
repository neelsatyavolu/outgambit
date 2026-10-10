import type { ApiResponse } from "@/lib/http";

/** Calls this app's API and always resolves to the response envelope. */
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    return (await response.json()) as ApiResponse<T>;
  } catch {
    return { success: false, error: "Could not reach the server. Check your connection." };
  }
}
