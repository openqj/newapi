import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PLAYWRIGHT_PORT must be a valid TCP port.");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec node scripts/start-playwright-server.mjs --port ${port}`,
    url: baseURL,
    // Only opt in to reusing a server. The default makes Playwright own the
    // Vite child process so it can reliably tear it down on Windows.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 30_000,
  },
});
