import { defineConfig } from "@playwright/test";

const PORT = 3210;

// The server under test runs against an in-memory database with the scripted
// opponent switched on. None of these values are real secrets.
const env = {
  DATABASE_URL: "pglite://memory",
  OWNER_PASSWORD: "e2e-owner-password",
  SECRETS_KEY: Buffer.alloc(32, 5).toString("base64"),
  IP_SALT: "e2e-salt-0123456789",
  GAMBIT_FAKE_AI: "1",
  GAMBIT_FAKE_SCRIPT: "e5,Qh4#",
};

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env,
  },
});
