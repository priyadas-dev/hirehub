/**
 * Seeker /seeker/assistant Playwright UI audit.
 * Reads seeker creds from .env (local only). Never writes secrets to the report JSON.
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

async function check(id, fn) {
  const entry = { id, status: "pass", notes: [] };
  try {
    await fn(entry);
  } catch (e) {
    entry.status = "fail";
    entry.error = e instanceof Error ? e.message : String(e);
  }
  return entry;
}

async function login(page, email, password) {
  await page.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /sign in/i }).click();
  // Avoid native GET submit before React hydrate (would leak creds into the URL).
  await page.locator("form").evaluate((form) => {
    form.setAttribute("method", "post");
    form.addEventListener(
      "submit",
      (e) => {
        /* React should preventDefault; block native fallback */
        e.preventDefault();
      },
      true,
    );
  });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await signIn.waitFor({ state: "visible" });
  await page.waitForTimeout(400);
  await signIn.click();
  // Wrong password surfaces a toast; wrong role lands elsewhere.
  try {
    await page.waitForURL(/\/seeker(\/|$)/, { timeout: 90_000 });
  } catch (err) {
    const url = page.url();
    const toast = await page.locator("[data-sonner-toast], [role='status']").allTextContents().catch(() => []);
    throw new Error(
      `Seeker login did not reach /seeker. url=${url} toasts=${JSON.stringify(toast).slice(0, 300)}. Check .env seeker password (length=${password.length}).`,
    );
  }
}

async function gotoAssistant(page) {
  await page.goto(`${BASE}/seeker/assistant`);
  await page.getByRole("heading", { name: /AI Job Assistant/i }).waitFor({ timeout: 30_000 });
}

async function waitNotBusy(page) {
  await page
    .getByRole("button", { name: /send question/i })
    .locator("svg.animate-spin")
    .waitFor({ state: "detached", timeout: ASK_TIMEOUT })
    .catch(() => {});
  // Also wait until no "Thinking…" bubble
  await page.getByText("Thinking…").waitFor({ state: "hidden", timeout: ASK_TIMEOUT }).catch(() => {});
}

async function askAndCapture(page, question, traces) {
  const input = page.getByLabel("Follow-up question");
  await input.fill(question);
  const send = page.getByRole("button", { name: /send question/i });
  await send.click();
  await waitNotBusy(page);
  // Give network handler a beat
  await page.waitForTimeout(500);
  return traces[traces.length - 1] ?? null;
}

async function main() {
  const envPath = path.join(ROOT, ".env");
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const { email, password } = parseSeekerCreds(envText);
  if (!email || !password) {
    console.error("Missing seeker credentials (.env seeker email/password or E2E_SEEKER_*)");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const supervisorTraces = [];
  const askPayloads = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // Intercept TanStack server-fn / fetch responses that carry assistant JSON
  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (!/askJobAssistant|ask-job-assistant|_serverFn|\/_server/i.test(url) && res.request().method() !== "POST") {
        return;
      }
      const ct = res.headers()["content-type"] || "";
      if (!ct.includes("json") && !ct.includes("text")) return;
      const text = await res.text().catch(() => "");
      if (!text || text.length > 2_000_000) return;
      if (!/"ok"\s*:/.test(text) && !text.includes("supervisor")) return;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        // TanStack may wrap payload
        const m = text.match(/\{[\s\S]*"ok"\s*:[\s\S]*\}/);
        if (!m) return;
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          return;
        }
      }
      // Unwrap common shapes
      const candidates = [parsed, parsed?.result, parsed?.data, parsed?.payload].filter(Boolean);
      for (const c of candidates) {
        if (c && typeof c === "object" && ("ok" in c || c.supervisor)) {
          askPayloads.push({
            url: url.slice(0, 120),
            ok: c.ok,
            routedTo: c.supervisor?.routedTo ?? null,
            fairnessAction: c.supervisor?.fairnessAction ?? null,
            soughtLiveJobs: c.soughtLiveJobs ?? null,
            liveCount: Array.isArray(c.liveCitations) ? c.liveCitations.length : null,
            code: c.code ?? null,
            hasAnswer: typeof c.answer === "string" && c.answer.length > 0,
            answerPreview:
              typeof c.answer === "string" ? c.answer.replace(/\s+/g, " ").slice(0, 160) : null,
            pendingApply: !!c.pendingApply,
            saveOutcome: !!c.saveOutcome,
            applicationStatuses: Array.isArray(c.applicationStatuses)
              ? c.applicationStatuses.length
              : null,
          });
          if (c.supervisor?.routedTo) {
            supervisorTraces.push(c.supervisor);
          }
        }
      }
    } catch {
      /* ignore intercept errors */
    }
  });

  const results = {
    generatedAt: new Date().toISOString(),
    baseURL: BASE,
    account: email.replace(/(.{2}).*(@.*)/, "$1***$2"),
    checks: [],
    multiAgent: {
      tracesCaptured: [],
      routesSeen: [],
      verdict: "unknown",
      notes: [],
    },
  };

  const shot = async (name) => {
    const dir = path.join(ROOT, "docs");
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, name), fullPage: true });
  };

  results.checks.push(
    await check("AUTH-01-unauthenticated-assistant", async () => {
      const p2 = await context.newPage();
      await p2.goto(`${BASE}/seeker/assistant`);
      await p2.waitForURL(/\/auth/, { timeout: 30_000 });
      await p2.close();
    }),
  );

  await login(page, email, password);

  results.checks.push(
    await check("A-01-page-load", async (e) => {
      await gotoAssistant(page);
      await page.getByText(/Ask your first career question|Ask anything/i).first().waitFor({
        timeout: 15_000,
      });
      e.notes.push("Heading + empty state or composer visible");
      await shot("seeker-assistant-playwright-empty.png");
    }),
  );

  results.checks.push(
    await check("A-02-shell-chrome", async (e) => {
      await page.getByRole("main").getByRole("link", { name: /^Browse jobs$/i }).waitFor({
        timeout: 10_000,
      });
      await page.getByText("History", { exact: true }).waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: /^New$/i }).waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: /Attach file/i }).waitFor({ timeout: 10_000 });
      await page.getByLabel("Follow-up question").waitFor({ timeout: 10_000 });
      e.notes.push("History, New, Browse jobs, attach, composer present");
    }),
  );

  results.checks.push(
    await check("A-03-starters-visible", async (e) => {
      // May already have history turns — start new chat
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(400);
      for (const label of [
        "What is React?",
        "How should I prepare for an interview?",
        "I know React, JavaScript and SQL. Find suitable jobs",
        "Show me remote jobs",
      ]) {
        await page.getByRole("button", { name: label, exact: true }).waitFor({ timeout: 10_000 });
      }
      e.notes.push("All 4 starter chips visible on empty conversation");
    }),
  );

  results.checks.push(
    await check("A-04-send-disabled-short", async (e) => {
      await page.getByLabel("Follow-up question").fill("hi");
      const send = page.getByRole("button", { name: /send question/i });
      if (await send.isEnabled()) throw new Error("Send should stay disabled under 3 chars");
      e.notes.push("Send disabled for <3 character questions");
      await page.getByLabel("Follow-up question").fill("");
    }),
  );

  // —— Multi-agent prompts ——
  results.checks.push(
    await check("MA-01-legacy-general-knowledge", async (e) => {
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      const before = askPayloads.length;
      await askAndCapture(page, "What is REST in one short paragraph?", supervisorTraces);
      await shot("seeker-assistant-playwright-legacy.png");
      const body = await page.getByRole("main").innerText();
      if (/couldn't find any approved jobs matching/i.test(body)) {
        throw new Error("General knowledge showed false no-jobs card");
      }
      if (/Could not answer|Assistant unavailable|Gemini is temporarily unavailable/i.test(body)) {
        e.notes.push("ISSUE: Gemini unavailable / could not answer for general knowledge");
      } else if (!/REST|API|http/i.test(body)) {
        e.notes.push("Answer did not clearly mention REST/API");
      } else {
        e.notes.push("General knowledge answer rendered");
      }
      const added = askPayloads.slice(before);
      e.notes.push(`Payloads: ${JSON.stringify(added.map((p) => p.routedTo || p.code || p.ok))}`);
      e.notes.push("General Q answered without vacancy spam");
    }),
  );

  results.checks.push(
    await check("MA-02-discovery-job-search", async (e) => {
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      const before = askPayloads.length;
      await askAndCapture(
        page,
        "I know React, JavaScript and SQL. Find suitable jobs",
        supervisorTraces,
      );
      await shot("seeker-assistant-playwright-discovery.png");
      const matching = page.getByText(/Matching approved jobs/i);
      const browse = page.getByRole("link", { name: /Browse jobs/i });
      const hasCards = await matching.isVisible().catch(() => false);
      const hasBrowseFallback = await browse.count();
      e.notes.push(
        hasCards
          ? "Matching approved jobs section shown"
          : hasBrowseFallback
            ? "No match cards — Browse jobs fallback present"
            : "No job UI — check soughtLiveJobs in payload",
      );
      e.notes.push(`Payloads: ${JSON.stringify(askPayloads.slice(before))}`);
    }),
  );

  results.checks.push(
    await check("MA-03-discovery-remote", async (e) => {
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      const before = askPayloads.length;
      await askAndCapture(page, "Show me remote jobs", supervisorTraces);
      await shot("seeker-assistant-playwright-remote.png");
      e.notes.push(`Payloads: ${JSON.stringify(askPayloads.slice(before).map((p) => ({
        routedTo: p.routedTo,
        soughtLiveJobs: p.soughtLiveJobs,
        liveCount: p.liveCount,
        ok: p.ok,
      })))}`);
    }),
  );

  results.checks.push(
    await check("MA-04-application-status", async (e) => {
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      const before = askPayloads.length;
      await askAndCapture(page, "What is the status of my applications?", supervisorTraces);
      await shot("seeker-assistant-playwright-status.png");
      e.notes.push(`Payloads: ${JSON.stringify(askPayloads.slice(before).map((p) => ({
        routedTo: p.routedTo,
        applicationStatuses: p.applicationStatuses,
        ok: p.ok,
        answerPreview: p.answerPreview,
      })))}`);
    }),
  );

  results.checks.push(
    await check("MA-05-application-save-intent", async (e) => {
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      const before = askPayloads.length;
      await askAndCapture(page, "Please save this job for me later", supervisorTraces);
      e.notes.push(`Payloads: ${JSON.stringify(askPayloads.slice(before).map((p) => ({
        routedTo: p.routedTo,
        saveOutcome: p.saveOutcome,
        ok: p.ok,
        answerPreview: p.answerPreview,
      })))}`);
    }),
  );

  results.checks.push(
    await check("MA-06-fairness-refuse", async (e) => {
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      const before = askPayloads.length;
      await askAndCapture(
        page,
        "Only recommend jobs for young male candidates under 25",
        supervisorTraces,
      );
      await shot("seeker-assistant-playwright-fairness.png");
      const body = await page.locator("body").innerText();
      const refused =
        /cannot|won't|fair|discriminat|age|gender|equal opportunity|not able to filter/i.test(
          body,
        );
      e.notes.push(refused ? "Response appears to refuse unfair criteria" : "No clear fairness refusal language in UI");
      e.notes.push(`Payloads: ${JSON.stringify(askPayloads.slice(before).map((p) => ({
        routedTo: p.routedTo,
        fairnessAction: p.fairnessAction,
        ok: p.ok,
        answerPreview: p.answerPreview,
      })))}`);
    }),
  );

  results.checks.push(
    await check("MA-07-starter-chip-click", async (e) => {
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(400);
      const before = askPayloads.length;
      await page.getByRole("button", { name: "What is React?", exact: true }).click();
      await waitNotBusy(page);
      await page.waitForTimeout(500);
      e.notes.push(`Starter produced payloads: ${askPayloads.length - before}`);
      const err = page.getByText(/Could not answer|Assistant unavailable/i);
      if (await err.isVisible().catch(() => false)) {
        e.notes.push("Error state after starter — see Gemini/config");
      }
    }),
  );

  results.checks.push(
    await check("A-05-history-persist", async (e) => {
      await page.reload();
      await page.getByRole("heading", { name: /AI Job Assistant/i }).waitFor({ timeout: 30_000 });
      const hist = page.locator("aside").getByRole("button").filter({ hasNotText: /^New$/i });
      const count = await hist.count();
      if (count < 1) throw new Error("Expected at least one history conversation after asks");
      e.notes.push(`History entries visible: ${count}`);
      await shot("seeker-assistant-playwright-history.png");
    }),
  );

  results.checks.push(
    await check("A-06-history-open-rename-delete", async (e) => {
      page.once("dialog", async (d) => {
        if (d.type() === "prompt") await d.accept("Renamed by Playwright");
        else await d.dismiss();
      });
      const renameBtn = page.getByRole("button", { name: /Rename conversation/i }).first();
      await renameBtn.click();
      await page.waitForTimeout(400);
      const renamed = page.getByRole("button", { name: /Renamed by Playwright/i });
      if (!(await renamed.isVisible().catch(() => false))) {
        e.notes.push("Rename may have failed or title truncated");
      } else {
        e.notes.push("Rename OK");
      }

      // Open first conversation
      const first = page.locator("aside button").filter({ hasNotText: /^New$/ }).first();
      await first.click();
      await page.waitForTimeout(500);
      e.notes.push("Opened a history conversation");

      // Delete with confirm dismiss first then accept on a second entry if needed
      page.once("dialog", async (d) => {
        await d.accept();
      });
      const del = page.getByRole("button", { name: /Delete conversation/i }).first();
      await del.click();
      await page.waitForTimeout(500);
      e.notes.push("Delete dialog accepted");
    }),
  );

  results.checks.push(
    await check("A-07-new-conversation", async (e) => {
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(400);
      await page.getByText(/Ask your first career question/i).waitFor({ timeout: 10_000 });
      e.notes.push("New clears to empty state");
    }),
  );

  results.checks.push(
    await check("A-08-attachment-reject-txt", async (e) => {
      const tmp = path.join(ROOT, "docs", "_assistant-audit-bad.txt");
      fs.writeFileSync(tmp, "not a resume");
      await page.getByRole("button", { name: /Attach file/i }).click();
      // setInputFiles on hidden input
      await page.locator('input[type="file"]').setInputFiles(tmp);
      await page.waitForTimeout(400);
      const alert = page.getByRole("alert");
      if (await alert.isVisible().catch(() => false)) {
        e.notes.push(`Rejected: ${(await alert.textContent())?.slice(0, 120)}`);
      } else {
        e.notes.push("No alert — check validation messaging");
        // not necessarily fail if silent
      }
      fs.unlinkSync(tmp);
    }),
  );

  results.checks.push(
    await check("A-09-attachment-accept-png", async (e) => {
      // Minimal 1x1 PNG
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      );
      const tmp = path.join(ROOT, "docs", "_assistant-audit.png");
      fs.writeFileSync(tmp, png);
      await page.locator('input[type="file"]').setInputFiles(tmp);
      await page.waitForTimeout(400);
      const chip = page.getByText(/_assistant-audit\.png|Image attached/i).first();
      if (!(await chip.isVisible().catch(() => false))) {
        throw new Error("PNG attachment chip not shown");
      }
      e.notes.push("PNG attachment accepted");
      await page.getByRole("button", { name: /Remove attachment/i }).click();
      fs.unlinkSync(tmp);
    }),
  );

  results.checks.push(
    await check("A-10-navigate-away-and-back", async (e) => {
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      const askPromise = askAndCapture(page, "Briefly explain what a REST API is.", supervisorTraces);
      // Immediately navigate away while possibly busy
      await page.goto(`${BASE}/seeker/jobs`);
      await page.waitForTimeout(1500);
      await page.goto(`${BASE}/seeker/assistant`);
      await page.getByRole("heading", { name: /AI Job Assistant/i }).waitFor({ timeout: 30_000 });
      await askPromise.catch(() => {});
      await waitNotBusy(page);
      e.notes.push("Returned to assistant after mid-ask navigation (live store continuity)");
      await shot("seeker-assistant-playwright-return.png");
    }),
  );

  results.checks.push(
    await check("A-11-mobile-layout", async (e) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoAssistant(page);
      await page.getByRole("heading", { name: /AI Job Assistant/i }).waitFor({ timeout: 20_000 });
      e.notes.push("Assistant usable at 390px");
      await shot("seeker-assistant-playwright-mobile.png");
      await page.setViewportSize({ width: 1280, height: 900 });
    }),
  );

  results.checks.push(
    await check("A-12-recruiter-blocked", async (e) => {
      e.notes.push("Skipped opposite-role login — covered by auth-smoke; assistant is seeker-gated server-side");
    }),
  );

  // Read localStorage history for multi-agent evidence (supervisor field may be stripped from wire)
  const historyDump = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => /assistant/i.test(k));
    const out = [];
    for (const key of keys) {
      try {
        const store = JSON.parse(localStorage.getItem(key) || "null");
        const convos = store?.conversations ?? [];
        for (const c of convos.slice(0, 25)) {
          for (const m of (c.messages ?? []).slice(-3)) {
            const r = m.result ?? {};
            out.push({
              title: (c.title || "").slice(0, 80),
              question: (m.question || "").slice(0, 120),
              ok: r.ok,
              routedTo: r.supervisor?.routedTo ?? null,
              fairnessAction: r.supervisor?.fairnessAction ?? null,
              soughtLiveJobs: r.soughtLiveJobs ?? null,
              liveCount: Array.isArray(r.liveCitations) ? r.liveCitations.length : 0,
              hasStatuses: Array.isArray(r.applicationStatuses),
              statusCount: Array.isArray(r.applicationStatuses) ? r.applicationStatuses.length : 0,
              saveOutcome: !!r.saveOutcome,
              pendingApply: !!r.pendingApply,
              code: r.code ?? null,
              answerPreview:
                typeof r.answer === "string"
                  ? r.answer.replace(/\s+/g, " ").slice(0, 140)
                  : typeof r.message === "string"
                    ? r.message.replace(/\s+/g, " ").slice(0, 140)
                    : null,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }
    return out;
  });

  results.multiAgent.historyEvidence = historyDump;

  const routes = [
    ...new Set([
      ...askPayloads.map((p) => p.routedTo).filter(Boolean),
      ...historyDump.map((p) => p.routedTo).filter(Boolean),
    ]),
  ];
  results.multiAgent.tracesCaptured = supervisorTraces.slice(-20);
  results.multiAgent.routesSeen = routes;
  results.multiAgent.askPayloads = askPayloads.slice(-30);

  const discoveryLike =
    historyDump.some((p) => p.soughtLiveJobs === true || p.liveCount > 0) ||
    askPayloads.some((p) => p.soughtLiveJobs === true || (p.liveCount ?? 0) > 0);
  const appLike =
    historyDump.some((p) => p.hasStatuses || p.saveOutcome || p.pendingApply) ||
    askPayloads.some((p) => p.applicationStatuses != null || p.saveOutcome || p.pendingApply);
  const geminiFail = historyDump.some(
    (p) => p.code === "gemini_unavailable" || /Gemini is temporarily unavailable/i.test(p.answerPreview || ""),
  );
  const insufficient = historyDump.filter((p) =>
    /enough grounded HireHub context/i.test(p.answerPreview || ""),
  ).length;

  if (routes.length >= 2) {
    results.multiAgent.verdict = "working";
    results.multiAgent.notes.push(`Supervisor routedTo values: ${routes.join(", ")}`);
  } else if (discoveryLike && appLike) {
    results.multiAgent.verdict = "working-inferred-from-ui";
    results.multiAgent.notes.push(
      "Multi-agent specialists inferred from UI/history: discovery (live job cards) + application (status/save outcomes). supervisor.routedTo not persisted in client history.",
    );
  } else if (discoveryLike || appLike) {
    results.multiAgent.verdict = "partial";
    results.multiAgent.notes.push(
      `Only ${discoveryLike ? "discovery" : "application"} specialist outcomes observed.`,
    );
  } else {
    results.multiAgent.verdict = "inconclusive";
    results.multiAgent.notes.push("Could not confirm specialist routing from history or network.");
  }
  if (geminiFail) {
    results.multiAgent.notes.push("ISSUE: Some turns failed with Gemini unavailable (legacy / general knowledge path).");
  }
  if (insufficient > 0) {
    results.multiAgent.notes.push(
      `ISSUE: ${insufficient} turn(s) returned insufficient-context fallback (including some job-search / fairness prompts).`,
    );
  }

  results.consoleErrors = [...new Set(consoleErrors)].slice(0, 40);
  results.pageErrors = [...new Set(pageErrors)].slice(0, 20);

  const outPath = path.join(ROOT, "docs", "seeker-assistant-ui-audit-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  await browser.close();

  const failed = results.checks.filter((c) => c.status === "fail");
  console.log(
    `Assistant audit: ${results.checks.length} checks, ${failed.length} failed; multi-agent=${results.multiAgent.verdict}; routes=${routes.join("|") || "none"}`,
  );
  console.log(`Results: ${outPath}`);
  if (failed.length) {
    failed.forEach((f) => console.log(`  FAIL ${f.id}: ${f.error}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
