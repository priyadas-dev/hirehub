/**
 * Mode B only: seeker assistant → apply propose → Confirm apply → real write evidence.
 * Never prints passwords. Reads seeker creds from E2E_* or informal .env lines.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE_URL?.trim() || "https://hirehub-dev.vercel.app";
const ASK_TIMEOUT = 180_000;

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

async function waitNotBusy(page) {
  await page
    .getByRole("button", { name: /send question/i })
    .locator("svg.animate-spin")
    .waitFor({ state: "detached", timeout: ASK_TIMEOUT })
    .catch(() => {});
  await page.getByText("Thinking…").waitFor({ state: "hidden", timeout: ASK_TIMEOUT }).catch(() => {});
}

async function ask(page, question) {
  const input = page.getByLabel("Follow-up question");
  await input.fill(question);
  await page.getByRole("button", { name: /send question/i }).click();
  await waitNotBusy(page);
  await page.waitForTimeout(800);
}

const envText = fs.existsSync(path.join(ROOT, ".env"))
  ? fs.readFileSync(path.join(ROOT, ".env"), "utf8")
  : "";
const { email, password } = parseSeekerCreds(envText);
if (!email || !password) {
  console.error("Missing seeker credentials");
  process.exit(1);
}

const out = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE,
  steps: [],
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await page.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /sign in/i }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/seeker(\/|$)/, { timeout: 90_000 });
  out.steps.push({ id: "login", status: "pass" });

  await page.goto(`${BASE}/seeker/assistant`);
  await page.getByRole("heading", { name: /AI Job Assistant/i }).waitFor({ timeout: 30_000 });
  const newChat = page.getByRole("button", { name: /new conversation|new chat/i });
  if (await newChat.isVisible().catch(() => false)) {
    await newChat.click();
    await page.waitForTimeout(500);
  }
  out.steps.push({ id: "open-assistant", status: "pass" });

  await ask(page, "find me approved IT jobs");
  let main = await page.locator("main").innerText();
  out.steps.push({
    id: "discovery",
    status: /job|opening|role|found|match|software|engineer|developer|IT|card/i.test(main)
      ? "pass"
      : "fail",
    preview: main.slice(0, 200),
  });

  // Explicit first-job apply — agent requires a concrete target before Confirm chip.
  await ask(page, "apply to the first job");
  main = await page.locator("main").innerText();
  let confirmVisible = await page
    .getByRole("button", { name: /confirm apply/i })
    .first()
    .isVisible()
    .catch(() => false);
  if (!confirmVisible) {
    await ask(page, "apply for this job");
    main = await page.locator("main").innerText();
    confirmVisible = await page
      .getByRole("button", { name: /confirm apply/i })
      .first()
      .isVisible()
      .catch(() => false);
  }
  out.steps.push({
    id: "propose-apply",
    status: confirmVisible || /confirm apply/i.test(main) ? "pass" : "fail",
    confirmVisible,
    preview: main.slice(0, 240),
  });

  if (confirmVisible) {
    const btn = page.getByRole("button", { name: /^Confirm apply$/i }).first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 15_000 });
    await waitNotBusy(page);
    await page.waitForTimeout(4000);
    main = await page.locator("main").innerText();
    // Chip text "Please confirm apply to…" can linger in history; look for outcome phrases too.
    let ok =
      /Application submitted|already applied|applied successfully|application (was )?saved|you're already|You already applied|I(?:'|’)ve submitted|submitted your application/i.test(
        main,
      );
    // If chip still the latest assistant turn, try one chat confirm.
    if (!ok && /Please confirm apply/i.test(main)) {
      await ask(page, "yes confirm apply");
      main = await page.locator("main").innerText();
      ok =
        /Application submitted|already applied|applied successfully|application (was )?saved|you're already|You already applied|I(?:'|’)ve submitted|submitted your application/i.test(
          main,
        );
    }
    out.steps.push({
      id: "confirm-apply-write",
      status: ok ? "pass" : "fail",
      preview: main.slice(0, 400),
    });
  } else {
    out.steps.push({
      id: "confirm-apply-write",
      status: "fail",
      notes: "Confirm apply chip not visible — cannot mutate",
    });
  }

  const shot = path.join(ROOT, "docs", "a3-agent-apply-mode-b.png");
  await page.screenshot({ path: shot, fullPage: false });
  out.screenshot = "docs/a3-agent-apply-mode-b.png";
} catch (e) {
  out.steps.push({
    id: "fatal",
    status: "fail",
    notes: e instanceof Error ? e.message : String(e),
  });
} finally {
  await browser.close();
}

const jsonPath = path.join(ROOT, "docs", "a3-agent-apply-mode-b.json");
fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
const failed = out.steps.some((s) => s.status === "fail");
process.exit(failed ? 1 : 0);
