import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live checks against real providers. Run with `pnpm smoke`; never part of `pnpm test`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: { include: ["smoke/**/*.smoke.ts"], testTimeout: 300_000, fileParallelism: false },
});
