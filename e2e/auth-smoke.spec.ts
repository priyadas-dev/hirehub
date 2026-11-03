import { expect, test } from "@playwright/test";

const email = process.env.E2E_SEEKER_EMAIL?.trim() ?? "";
const password = process.env.E2E_SEEKER_PASSWORD?.trim() ?? "";
const hasCreds = Boolean(email && password);
/** Public checks need a running app; enable with E2E_AUTH_PUBLIC=1 or when seeker creds are set. */
const runPublic = process.env.E2E_AUTH_PUBLIC === "1" || hasCreds;

/**
 * Auth Phase 7 selective smoke.
 * Public route checks need a running app (npm run dev / E2E_BASE_URL).
 * Session checks skip when E2E_SEEKER_EMAIL / E2E_SEEKER_PASSWORD are unset.
 */

test.describe("Auth public routes", () => {
  test.skip(
    !runPublic,
    "Set E2E_AUTH_PUBLIC=1 (with npm run dev) or E2E_SEEKER_* to exercise public auth routes",
  );

  test("auth page shows sign-in and sign-up tabs", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: /welcome back|create your account/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /sign up/i })).toBeVisible();
  });

  test("forgot-password and reset-password pages render", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: /forgot|reset|password/i })).toBeVisible();
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: /reset|password|new password/i })).toBeVisible();
  });

  test("unauthenticated seeker area sends user toward auth", async ({ page }) => {
    await page.goto("/seeker");
    await expect(page).toHaveURL(/\/auth/, { timeout: 30_000 });
  });
});

test.describe("Auth session smoke", () => {
  test.skip(!hasCreds, "Set E2E_SEEKER_EMAIL and E2E_SEEKER_PASSWORD (local only) to run");

  test("seeker email sign-in lands on seeker home and blocks recruiter area", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: /sign in/i }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await page.waitForURL(/\/seeker(\/|$)/, { timeout: 60_000 });
    await expect(page).toHaveURL(/\/seeker/);

    await page.goto("/recruiter");
    await expect(page).toHaveURL(/\/seeker/, { timeout: 30_000 });
  });

  test("sign out returns to auth", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: /sign in/i }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/seeker(\/|$)/, { timeout: 60_000 });

    await page.getByRole("button", { name: /open profile menu/i }).click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/auth/, { timeout: 30_000 });
  });
});
