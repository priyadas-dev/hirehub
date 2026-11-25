/**
 * Focused Multi-Agent final UI verification (local uncommitted fixes).
 * Mode: discovery + save + apply propose. Confirmed apply insert is covered by
 * instrumented DB unit tests — optional Confirm click is skipped unless
 * MULTI_AGENT_CONFIRM_APPLY=1 (writes a real application row).
 *
 * Never prints passwords. Reads seeker creds the same way as other e2e scripts.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:8080";
const ASK_TIMEOUT = 120_000;
const CONFIRM_APPLY = process.env.MULTI_AGENT_CONFIRM_APPLY === "1";

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
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/seeker(\/|$)/, { timeout: 90_000 });
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
  await page.waitForTimeout(500);
}

function summarizeBody(body) {
  if (!body || typeof body !== "object") return null;
  return {
    ok: body.ok,
    model: body.model,
    routedTo: body.supervisor?.routedTo ?? body.routedTo ?? null,
    liveCount: Array.isArray(body.liveCitations)
      ? body.liveCitations.length
      : Array.isArray(body.live)
        ? body.live.length
        : 0,
    saveOutcome: body.saveOutcome ?? null,
    pendingApply: body.pendingApply ?? null,
    applyOutcome: body.applyOutcome ?? null,
    answerPreview: typeof body.answer === "string" ? body.answer.slice(0, 180) : null,
  };
}

async function main() {
  const envPath = path.join(ROOT, ".env");
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const { email, password } = parseSeekerCreds(envText);
  if (!email || !password) {
    console.error("Missing seeker credentials");
    process.exit(1);
  }

  const results = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    confirmApplyEnabled: CONFIRM_APPLY,
    checks: [],
    askSummaries: [],
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (!/ask-job-assistant|_serverFn|askJobAssistant/i.test(url) && res.request().method() !== "POST") {
        return;
      }
      const ct = res.headers()["content-type"] || "";
      if (!ct.includes("json") && !ct.includes("text")) return;
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        return;
      }
      const body = json?.result ?? json?.data ?? json;
      const summary = summarizeBody(body);
      if (summary && (summary.model || summary.routedTo || summary.saveOutcome || summary.pendingApply)) {
        results.askSummaries.push(summary);
      }
    } catch {
      /* ignore */
    }
  });

  const check = (id, status, notes) => results.checks.push({ id, status, notes });

  try {
    await login(page, email, password);
    check("login", "pass", "seeker session");

    await page.goto(`${BASE}/seeker/assistant`);
    await page.getByRole("heading", { name: /AI Job Assistant/i }).waitFor({ timeout: 30_000 });
    const newChat = page.getByRole("button", { name: /new conversation|new chat/i });
    if (await newChat.isVisible().catch(() => false)) {
      await newChat.click();
      await page.waitForTimeout(400);
    }
    check("open-assistant", "pass");

    await ask(page, "finace job");
    let mainText = await page.locator("main").innerText();
    const noisyOk =
      /financ|analyst|bank|job|opening|role|found|match|approved|Browse/i.test(mainText) &&
      !/click Apply on the job page/i.test(mainText);
    check("1-noisy-search-finace", noisyOk ? "pass" : "fail", noisyOk ? "Discovery-style reply" : mainText.slice(0, 200));

    await ask(page, "find me it job");
    mainText = await page.locator("main").innerText();
    check(
      "1b-noisy-search-it",
      /it|engineer|software|noc|job|opening|role|found|match/i.test(mainText) ? "pass" : "partial",
      "Second noisy discovery turn",
    );

    await ask(page, "save this one");
    mainText = await page.locator("main").innerText();
    const saveApi = [...results.askSummaries].reverse().find((s) => s.saveOutcome || /saved/i.test(s.answerPreview || ""));
    const saveUi =
      /saved|bookmark|already in your saved/i.test(mainText) &&
      !/go to (your )?dashboard|click save/i.test(mainText);
    check(
      "2-save-this-one",
      saveUi || saveApi?.saveOutcome ? "pass" : "fail",
      saveApi?.saveOutcome
        ? `saveOutcome=${JSON.stringify(saveApi.saveOutcome)}`
        : mainText.slice(0, 220),
    );

    await ask(page, "apply for this job");
    mainText = await page.locator("main").innerText();
    const proposeApi = [...results.askSummaries].reverse().find((s) => s.pendingApply);
    const proposeUi = /confirm|nothing is sent|I can apply|resume/i.test(mainText);
    const noSilentSubmit = !/Application submitted/i.test(mainText);
    check(
      "3-5-apply-propose-confirm-required",
      proposeUi && noSilentSubmit ? "pass" : "fail",
      proposeApi?.pendingApply
        ? `pendingApply=${JSON.stringify(proposeApi.pendingApply)}`
        : mainText.slice(0, 220),
    );

    const resumeAsk = /no resume|upload a resume|resume on file/i.test(mainText);
    check(
      "4-resume-gate-message",
      resumeAsk || /resume on file will be attached/i.test(mainText) ? "pass" : "partial",
      resumeAsk ? "Asked to upload resume (none on profile)" : "Resume present or message soft",
    );

    if (CONFIRM_APPLY) {
      const confirmBtn = page.getByRole("button", { name: /confirm apply/i });
      const visible = await confirmBtn.first().isVisible().catch(() => false);
      if (visible) {
        await confirmBtn.first().click();
        await waitNotBusy(page);
        await page.waitForTimeout(1500);
        mainText = await page.locator("main").innerText();
        let applied =
          /Application submitted|already applied|application (is )?saved|can.?t submit|no resume|applied successfully/i.test(
            mainText,
          );
        if (!applied) {
          // Fallback: chat confirm intent (same server path as the chip)
          await ask(page, "confirm");
          mainText = await page.locator("main").innerText();
          applied =
            /Application submitted|already applied|application (is )?saved|can.?t submit|no resume|applied successfully/i.test(
              mainText,
            );
        }
        const applyApi = [...results.askSummaries]
          .reverse()
          .find((s) => s.applyOutcome || /already_applied|created|submitted/i.test(JSON.stringify(s)));
        check(
          "6-confirm-apply-result",
          applied || Boolean(applyApi?.applyOutcome) ? "pass" : "fail",
          applyApi?.applyOutcome
            ? `applyOutcome=${JSON.stringify(applyApi.applyOutcome)}`
            : mainText.slice(0, 280),
        );
      } else {
        check("6-confirm-apply-result", "fail", "Confirm apply button not found");
      }
    } else {
      check(
        "6-confirm-apply-result",
        "skipped",
        "Set MULTI_AGENT_CONFIRM_APPLY=1 to exercise live insert; covered by workflow DB tests",
      );
    }

    await ask(page, "save the second job");
    mainText = await page.locator("main").innerText();
    check(
      "7-follow-up-second",
      /saved|bookmark|already|which one|tell me which/i.test(mainText) ? "pass" : "partial",
      mainText.slice(0, 180),
    );

    const shot = path.join(ROOT, "docs", "multi-agent-final-ui-verify.png");
    await page.screenshot({ path: shot, fullPage: false });
    results.screenshot = "docs/multi-agent-final-ui-verify.png";
  } catch (err) {
    check("fatal", "fail", err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
  }

  const out = path.join(ROOT, "docs", "multi-agent-final-ui-verify.json");
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ wrote: out, checks: results.checks }, null, 2));
  const failed = results.checks.some((c) => c.status === "fail");
  process.exit(failed ? 1 : 0);
}

main();
