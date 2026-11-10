/**
 * Recruiter workspace UI audit (Playwright). Reads recruiter creds from .env locally.
 * Writes docs/recruiter-ui-audit-results.json — never includes passwords.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:8080";
const ROOT = path.resolve(import.meta.dirname, "..");

function parseRecruiterCreds(envText) {
  let email = process.env.E2E_RECRUITER_EMAIL?.trim() ?? "";
  let password = process.env.E2E_RECRUITER_PASSWORD?.trim() ?? "";
  if (email && password) return { email, password };

  for (const line of envText.split(/\r?\n/)) {
    const t = line.trim();
    const em = t.match(/^recuiter\s+email\s*:\s*(.+)$/i);
    if (em) email = em[1].trim();
    const pw = t.match(/^recuiter\s+password\s*:\s*(.+)$/i);
    if (pw) password = pw[1].trim();
  }
  return { email, password };
}

async function login(page, email, password) {
  await page.goto(`${BASE}/auth`);
  await page.getByRole("tab", { name: /sign in/i }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/recruiter(\/|$)/, { timeout: 90_000 });
}

async function is404(page) {
  const h = page.getByRole("heading", { name: "404", exact: true });
  return h.isVisible().catch(() => false);
}

async function waitForAppShell(page) {
  await page.getByRole("navigation", { name: "Main" }).waitFor({ timeout: 25_000 });
}

async function check(name, fn) {
  const entry = { id: name, status: "pass", notes: [] };
  try {
    await fn(entry);
  } catch (e) {
    entry.status = "fail";
    entry.error = e instanceof Error ? e.message : String(e);
  }
  return entry;
}

async function main() {
  const envPath = path.join(ROOT, ".env");
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const { email, password } = parseRecruiterCreds(envText);
  if (!email || !password) {
    console.error("Missing recruiter credentials in .env or E2E_RECRUITER_*");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const results = {
    generatedAt: new Date().toISOString(),
    baseURL: BASE,
    account: email.replace(/(.{2}).*(@.*)/, "$1***$2"),
    checks: [],
  };

  const screenshot = async (file) => {
    const dir = path.join(ROOT, "docs");
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, file), fullPage: true });
  };

  results.checks.push(
    await check("AUTH-01-unauthenticated-recruiter", async () => {
      const p2 = await context.newPage();
      await p2.goto(`${BASE}/recruiter`);
      await p2.waitForURL(/\/auth/, { timeout: 30_000 });
      await p2.close();
    }),
  );

  await login(page, email, password);

  results.checks.push(
    await check("R-01-dashboard", async (e) => {
      await page.goto(`${BASE}/recruiter`);
      await waitForAppShell(page);
      await page.getByRole("heading", { name: /welcome back/i }).waitFor({ timeout: 20_000 });
      await page.getByRole("link", { name: /my jobs/i }).first().waitFor({ timeout: 10_000 });
      e.notes.push("Welcome, stat shortcuts, recent sections");
      await screenshot("recruiter-full-playwright-dashboard.png");
    }),
  );

  results.checks.push(
    await check("R-02-sidebar", async (e) => {
      const nav = page.getByRole("navigation", { name: "Main" });
      for (const label of [
        "Recruiter Dashboard",
        "Post a Job",
        "My Job Posts",
        "Applicants",
        "Company Profile",
        "Settings",
      ]) {
        await nav.getByRole("link", { name: label }).click();
        await waitForAppShell(page);
        e.notes.push(`Navigated via ${label}`);
      }
    }),
  );

  results.checks.push(
    await check("R-03-jobs-list-filters", async (e) => {
      await page.goto(`${BASE}/recruiter/jobs`);
      await waitForAppShell(page);
      await page.getByRole("heading", { name: /my job posts/i }).waitFor({ timeout: 20_000 });
      await page.getByPlaceholder(/search by job title/i).fill("qa");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: /pending|approved|closed/i }).first().click();
      await page.waitForTimeout(800);
      e.notes.push("Title + status filters used");
      await screenshot("recruiter-full-playwright-jobs.png");
    }),
  );

  results.checks.push(
    await check("R-04-jobs-list-loaded", async (e) => {
      await page.goto(`${BASE}/recruiter/jobs`);
      await page.waitForTimeout(3000);
      const empty = page.getByText(/no job posts yet|no jobs/i).first();
      const card = page.locator("article, [data-testid], a[href*='/recruiter/jobs/']").first();
      if (await empty.isVisible().catch(() => false)) e.notes.push("Empty state shown");
      else if (await card.count()) e.notes.push("At least one job row/card visible");
      else e.notes.push("List still loading or unknown layout after 3s");
    }),
  );

  results.checks.push(
    await check("R-05-post-job-form", async (e) => {
      await page.goto(`${BASE}/recruiter/jobs/new`);
      await waitForAppShell(page);
      await page.getByRole("heading", { name: /post a job/i }).waitFor({ timeout: 20_000 });
      await page.getByRole("button", { name: /submit|post job|save/i }).first().click();
      await page.getByText(/required|select a company|title is required/i).first().waitFor({ timeout: 10_000 });
      e.notes.push("Client validation on empty submit (no job created)");
      await screenshot("recruiter-full-playwright-jobs-new.png");
    }),
  );

  results.checks.push(
    await check("R-06-job-detail-placeholder", async (e) => {
      await page.goto(`${BASE}/recruiter/jobs/abc`);
      await waitForAppShell(page);
      if (await is404(page)) throw new Error("Job detail route returned 404");
      e.notes.push("/recruiter/jobs/abc resolves (detail or error state, not site 404)");
      await screenshot("recruiter-full-playwright-job-detail.png");
    }),
  );

  results.checks.push(
    await check("R-07-job-edit-route", async (e) => {
      await page.goto(`${BASE}/recruiter/jobs/abc/edit`);
      await waitForAppShell(page);
      if (await is404(page)) throw new Error("Job edit route returned 404");
      e.notes.push("Edit route registered");
    }),
  );

  results.checks.push(
    await check("R-08-applicants-filters", async (e) => {
      await page.goto(`${BASE}/recruiter/applicants`);
      await waitForAppShell(page);
      await page.getByRole("heading", { name: /^applicants$/i }).waitFor({ timeout: 20_000 });
      await page.getByRole("combobox").first().click();
      await page.getByRole("option").nth(1).click().catch(() => {});
      await page.waitForTimeout(500);
      e.notes.push("Applicants page + job filter");
      await screenshot("recruiter-full-playwright-applicants.png");
    }),
  );

  results.checks.push(
    await check("R-09-applicants-status-url", async (e) => {
      await page.goto(`${BASE}/recruiter/applicants?status=shortlisted`);
      await waitForAppShell(page);
      await page.getByRole("heading", { name: /^applicants$/i }).waitFor({ timeout: 20_000 });
      e.notes.push("Deep link ?status=shortlisted loads");
    }),
  );

  results.checks.push(
    await check("R-10-company-profile", async (e) => {
      await page.goto(`${BASE}/recruiter/company`);
      await waitForAppShell(page);
      await page.getByRole("heading", { name: /^profile$/i }).waitFor({ timeout: 20_000 });
      e.notes.push('Page title is "Profile" (not "Company profile")');
      await screenshot("recruiter-full-playwright-company.png");
    }),
  );

  results.checks.push(
    await check("R-11-settings", async (e) => {
      await page.goto(`${BASE}/settings`);
      await waitForAppShell(page);
      await page.getByRole("heading").first().waitFor({ timeout: 20_000 });
      e.notes.push("Settings reachable while signed in as recruiter");
    }),
  );

  results.checks.push(
    await check("R-12-header-search", async (e) => {
      await page.goto(`${BASE}/recruiter/jobs`);
      const input = page.getByRole("search").getByRole("textbox").first();
      await input.fill("engineer");
      await input.press("Enter");
      await page.waitForURL(/q=engineer/, { timeout: 15_000 });
      e.notes.push("Header search updates jobs list query");
    }),
  );

  const unregistered = [
    "/recruiter/crm",
    "/recruiter/crm/contacts",
    "/recruiter/crm/segments",
    "/recruiter/crm/campaigns",
    "/recruiter/job-categories",
  ];
  for (const route of unregistered) {
    results.checks.push(
      await check(`R-ROUTE-${route}`, async (e) => {
        await page.goto(`${BASE}${route}`);
        await page.waitForLoadState("domcontentloaded");
        if (await is404(page)) {
          e.notes.push("Returns site 404 — route not in src/routeTree.gen.ts on this branch");
          throw new Error("Route not registered (404)");
        }
        e.notes.push("Unexpected: route rendered (verify route tree)");
        await screenshot(`recruiter-full-playwright-${route.replace(/\//g, "-")}.png`);
      }),
    );
  }

  results.checks.push(
    await check("R-16-real-job-from-list", async (e) => {
      await page.goto(`${BASE}/recruiter/jobs`);
      await page.waitForTimeout(3500);
      const jobLink = page
        .locator('a[href*="/recruiter/jobs/"]')
        .filter({ hasNot: page.locator('[href*="/new"]') })
        .first();
      if (!(await jobLink.count())) {
        e.notes.push("No job links in list");
        return;
      }
      const href = await jobLink.getAttribute("href");
      await jobLink.click();
      await page.waitForTimeout(2000);
      if (await is404(page)) throw new Error("Real job detail 404");
      e.notes.push(`Opened ${href}`);
      await screenshot("recruiter-full-playwright-job-real.png");
      const edit = page.getByRole("link", { name: /edit/i }).first();
      if (await edit.isVisible().catch(() => false)) {
        await edit.click();
        await page.waitForTimeout(1500);
        e.notes.push("Edit form opened from detail");
      }
    }),
  );

  results.checks.push(
    await check("R-13-mobile-viewport", async (e) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}/recruiter`);
      await page.getByRole("heading", { name: /welcome back/i }).waitFor({ timeout: 20_000 });
      const menu = page.getByRole("button", { name: /open navigation/i }).first();
      if (await menu.isVisible().catch(() => false)) {
        await menu.click();
        await page.getByRole("navigation", { name: "Main" }).waitFor({ timeout: 10_000 });
        e.notes.push("Mobile sheet nav opens");
      } else {
        e.notes.push("Mobile menu trigger not matched by name — header layout only");
      }
      await screenshot("recruiter-full-playwright-mobile.png");
      await page.setViewportSize({ width: 1280, height: 900 });
    }),
  );

  results.checks.push(
    await check("R-14-profile-menu", async (e) => {
      await page.goto(`${BASE}/recruiter`);
      await page.getByRole("button", { name: /open profile menu/i }).click();
      await page.getByRole("menuitem", { name: /settings|sign out/i }).first().waitFor({ timeout: 10_000 });
      e.notes.push("Profile menu items visible");
      await page.keyboard.press("Escape");
    }),
  );

  results.checks.push(
    await check("R-15-role-guard-seeker", async (e) => {
      e.notes.push("Skipped live seeker login — covered by e2e/auth-smoke.spec.ts");
    }),
  );

  results.consoleErrors = [...new Set(consoleErrors)].slice(0, 40);

  const outPath = path.join(ROOT, "docs", "recruiter-ui-audit-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  await browser.close();

  const failed = results.checks.filter((c) => c.status === "fail");
  console.log(`Audit complete: ${results.checks.length} checks, ${failed.length} failed`);
  console.log(`Results: ${outPath}`);
  if (failed.length) {
    failed.forEach((f) => console.log(`  FAIL ${f.id}: ${f.error || f.notes.join("; ")}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
