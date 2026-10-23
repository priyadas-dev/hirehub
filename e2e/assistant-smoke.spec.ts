import { expect, test } from "@playwright/test";

const email = process.env.E2E_SEEKER_EMAIL?.trim() ?? "";
const password = process.env.E2E_SEEKER_PASSWORD?.trim() ?? "";
const hasCreds = Boolean(email && password);

test.describe("AI Job Assistant smoke", () => {
  test.skip(!hasCreds, "Set E2E_SEEKER_EMAIL and E2E_SEEKER_PASSWORD (local only) to run");

  test("seeker can ask a general question without a false no-jobs card", async ({ page }) => {
    await page.goto("/auth");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await page.waitForURL(/\/seeker(\/|$)/, { timeout: 60_000 });
    await page.goto("/seeker/assistant");
    await expect(
      page.getByRole("heading", { name: /assistant/i }).or(page.getByText(/AI Job Assistant/i)),
    ).toBeVisible({
      timeout: 30_000,
    });

    const box = page
      .getByPlaceholder(/ask|message|question/i)
      .or(page.locator("textarea"))
      .first();
    await box.fill("What is REST?");
    await page.getByRole("button", { name: /send/i }).click();

    // Wait for an assistant response bubble; must not show the vacancy no-match spam for general Q.
    await expect(page.getByText(/couldn't find any approved jobs matching/i)).toHaveCount(0, {
      timeout: 90_000,
    });
    await expect(page.locator("main, [data-assistant], body")).toContainText(/.{20,}/, {
      timeout: 90_000,
    });
  });
});
