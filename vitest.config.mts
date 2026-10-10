import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    coverage: { provider: "v8", include: ["lib/**/*.ts"], exclude: ["lib/**/*.test.ts", "lib/client/**"] },
  },
});
