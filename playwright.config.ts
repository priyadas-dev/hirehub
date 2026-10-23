import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:8080";

/**
 * Authenticated smoke E2E. Skips entirely when E2E_SEEKER_EMAIL / E2E_SEEKER_PASSWORD
 * are unset (safe for CI / local without secrets). Never commit credentials.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 90_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
  },
});
