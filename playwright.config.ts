import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const port = 8010;
const dbPath = `.tmp/playwright/turneringar-${process.pid}.sqlite3`;
const python = process.env.PYTHON_BIN || (existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3");

export default defineConfig({
  testDir: "./frontend/tests",
  outputDir: ".tmp/playwright/test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `${python} -m uvicorn turneringar.main:app --app-dir backend --host 127.0.0.1 --port ${port} --log-level warning`,
    url: `http://127.0.0.1:${port}/api/session`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      ADMIN_PIN: "test-pin",
      TURNERINGAR_DB: dbPath,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
