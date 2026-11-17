/**
 * Smoke: legacy Gemini Q&A on /seeker/assistant (REST + What is React?).
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:8080";
const ASK_TIMEOUT = 120_000;

function parseSeekerCreds(envText) {
  let email = process.env.E2E_SEEKER_EMAIL?.trim() ?? "";
  let password = process.env.E2E_SEEKER_PASSWORD?.trim() ?? "";
  if (email && password) return { email, password };
  const lines = envText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const em = t.match(/^seeker\s+email\s*:\s*(.+)$/i);
    if (em) {
      email = em[1].trim();
      const next = (lines[i + 1] ?? "").trim();
      const pw = next.match(/^password\s*:\s*(.+)$/i);
      if (pw) password = pw[1].trim();
    }
  }
  return { email, password };
}

async function login(page, email, password) {
  await page.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /sign in/i }).click();
  await page.locator("form").evaluate((form) => {
    form.setAttribute("method", "post");
    form.addEventListener("submit", (e) => e.preventDefault(), true);
  });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/seeker(\/|$)/, { timeout: 90_000 });
}

async function waitNotBusy(page) {
  await page.getByText("Thinking…").waitFor({ state: "hidden", timeout: ASK_TIMEOUT }).catch(() => {});
  const neu = page.getByRole("button", { name: /^New$/i });
  for (let i = 0; i < 90; i++) {
    if (await neu.isEnabled().catch(() => false)) return;
    await page.waitForTimeout(1000);
  }
}

async function ask(page, q) {
  await page.getByRole("button", { name: /^New$/i }).click();
  await page.waitForTimeout(400);
  await page.getByLabel("Follow-up question").fill(q);
  await page.getByRole("button", { name: /send question/i }).click();
  await waitNotBusy(page);
}

async function main() {
  const { email, password } = parseSeekerCreds(fs.readFileSync(path.join(ROOT, ".env"), "utf8"));
  if (!email || !password) {
    console.error("Missing seeker creds");
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await login(page, email, password);
  await page.goto(`${BASE}/seeker/assistant`);
  await page.getByRole("heading", { name: /AI Job Assistant/i }).waitFor({ timeout: 30_000 });

  const cases = [
    {
      id: "REST",
      q: "What is REST in one short paragraph?",
      ok: (b) =>
        !/Could not answer|took too long|Gemini is temporarily unavailable|Something went wrong/i.test(
          b,
        ) && /REST|HTTP|API|Representational|stateless|resource/i.test(b),
    },
    {
      id: "React",
      q: "What is React?",
      ok: (b) =>
        !/Could not answer|took too long|Gemini is temporarily unavailable|Something went wrong/i.test(
          b,
        ) && /React|JavaScript|UI|component|library|Meta|Facebook/i.test(b),
    },
  ];

  const results = [];
  for (const c of cases) {
    await ask(page, c.q);
    const body = await page.locator("main").innerText();
    const pass = c.ok(body);
    const shot = path.join(ROOT, "docs", `seeker-assistant-legacy-smoke-${c.id}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    results.push({
      id: c.id,
      status: pass ? "pass" : "fail",
      hint: body.replace(/\s+/g, " ").slice(0, 240),
      shot: path.basename(shot),
    });
    console.log(`${pass ? "PASS" : "FAIL"} ${c.id}`);
  }

  await browser.close();
  const out = path.join(ROOT, "docs", "seeker-assistant-legacy-smoke.json");
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => r.status === "fail").length;
  console.log(`${results.length - failed}/${results.length} → ${out}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
