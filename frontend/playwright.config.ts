import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PUBLIC_PORT = 18080;
export const ENV_PORT = 19090;
export const ENV_TOKEN = "playwright-token";

const dataDir = join(tmpdir(), "chartview-e2e");

/**
 * Builds the frontend, starts the real server, and drives the sim clock in fixed-step mode
 * through the env API (from the test runner only, never from the browser).
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PUBLIC_PORT}`,
    viewport: { width: 1600, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run build && cd .. && uv run python -m app.main --host 127.0.0.1`,
    url: `http://127.0.0.1:${PUBLIC_PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CHARTVIEW_PUBLIC_PORT: String(PUBLIC_PORT),
      CHARTVIEW_ENV_PORT: String(ENV_PORT),
      CHARTVIEW_ENV_TOKEN: ENV_TOKEN,
      CHARTVIEW_DATA_DIR: dataDir,
    },
  },
});
