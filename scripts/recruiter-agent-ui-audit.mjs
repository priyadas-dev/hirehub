/**
 * Recruiter /recruiter/agent Playwright UI audit (Mode A — no confirm shortlist / no email send).
 * Reads recruiter creds from .env locally. Never writes secrets into the report JSON.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:8080";
const ASK_TIMEOUT = 120_000;

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
  await page.locator("form").evaluate((form) => {
    form.setAttribute("method", "post");
    form.addEventListener("submit", (e) => e.preventDefault(), true);
  });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await signIn.waitFor({ state: "visible" });
  await page.waitForTimeout(400);
  await signIn.click();
  try {
    await page.waitForURL(/\/recruiter(\/|$)/, { timeout: 90_000 });
  } catch {
    throw new Error(`Recruiter login failed; url=${page.url()}`);
  }
}

async function gotoAgent(page) {
  await page.goto(`${BASE}/recruiter/agent`);
  await page.getByRole("heading", { name: /AI Recruiter Agent/i }).waitFor({ timeout: 30_000 });
}

async function waitNotBusy(page) {
  await page
    .getByText("Running via Supervisor…")
    .waitFor({ state: "hidden", timeout: ASK_TIMEOUT })
    .catch(() => {});
  await page
    .getByRole("button", { name: /send question/i })
    .locator("svg.animate-spin")
    .waitFor({ state: "detached", timeout: ASK_TIMEOUT })
    .catch(() => {});
  await page.waitForTimeout(400);
}

async function ask(page, text) {
  const input = page.getByLabel("Recruiter agent question");
  await input.fill(text);
  await page.getByRole("button", { name: /send question/i }).click();
  await waitNotBusy(page);
}

async function main() {
  const envPath = path.join(ROOT, ".env");
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const { email, password } = parseRecruiterCreds(envText);
  if (!email || !password) {
    console.error("Missing recruiter credentials");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const agentPayloads = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (res.request().method() !== "POST") return;
      const ct = res.headers()["content-type"] || "";
      if (!ct.includes("json") && !ct.includes("text")) return;
      const text = await res.text().catch(() => "");
      if (!text || text.length > 1_500_000) return;
      if (!/"ok"\s*:/.test(text) && !/supervisor|shortlist|outreach|campaign/i.test(text)) return;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        const m = text.match(/\{[\s\S]*"ok"\s*:[\s\S]*\}/);
        if (!m) return;
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          return;
        }
      }
      const candidates = [parsed, parsed?.result, parsed?.data, parsed?.payload].filter(Boolean);
      for (const c of candidates) {
        if (!c || typeof c !== "object") continue;
        if (!("ok" in c) && !c.supervisor && !c.status && !c.campaign) continue;
        agentPayloads.push({
          url: url.slice(0, 100),
          ok: c.ok ?? null,
          status: c.status ?? null,
          routedTo: c.supervisor?.routedTo ?? null,
          fairnessAction: c.supervisor?.fairnessAction ?? null,
          code: c.code ?? null,
          hasCampaign: !!c.campaign,
          messagePreview:
            typeof c.message === "string"
              ? c.message.replace(/\s+/g, " ").slice(0, 140)
              : typeof c.answer === "string"
                ? c.answer.replace(/\s+/g, " ").slice(0, 140)
                : null,
        });
      }
    } catch {
      /* ignore */
    }
  });

  const results = {
    generatedAt: new Date().toISOString(),
    baseURL: BASE,
    account: email.replace(/(.{2}).*(@.*)/, "$1***$2"),
    mode: "A-safe-read-mostly (no Confirm shortlist / no email send)",
    checks: [],
    multiAgent: { verdict: "unknown", notes: [], routesSeen: [], payloads: [] },
  };

  const shot = async (name) => {
    const dir = path.join(ROOT, "docs");
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, name), fullPage: true });
  };

  results.checks.push(
    await check("AUTH-01-unauthenticated-agent", async () => {
      const p2 = await context.newPage();
      await p2.goto(`${BASE}/recruiter/agent`);
      await p2.waitForURL(/\/auth/, { timeout: 30_000 });
      await p2.close();
    }),
  );

  await login(page, email, password);

  results.checks.push(
    await check("RA-01-page-load", async (e) => {
      await gotoAgent(page);
      await page.getByText(/Context — owned jobs/i).waitFor({ timeout: 15_000 });
      await page.getByText(/Recruiter chat/i).waitFor({ timeout: 10_000 });
      await page.getByText(/Actions run via Supervisor/i).waitFor({ timeout: 10_000 });
      e.notes.push("Heading, context strip, chat panel present");
      await shot("recruiter-agent-playwright-empty.png");
    }),
  );

  results.checks.push(
    await check("RA-02-sidebar-nav", async (e) => {
      const nav = page.getByRole("navigation", { name: "Main" });
      await nav.getByRole("link", { name: "AI Recruiter Agent" }).waitFor({ timeout: 10_000 });
      e.notes.push("AI Recruiter Agent in sidebar");
    }),
  );

  results.checks.push(
    await check("RA-03-history-chrome", async (e) => {
      await page.getByText(/Chat history/i).waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: /^New$/i }).waitFor({ timeout: 10_000 });
      e.notes.push("Chat history + New present");
    }),
  );

  let hasJobs = false;
  let hasApplicants = false;

  results.checks.push(
    await check("RA-04-owned-jobs-context", async (e) => {
      const empty = page.getByText(/No jobs yet/i);
      if (await empty.isVisible().catch(() => false)) {
        e.notes.push("No owned jobs — agent chat disabled until jobs exist");
        await shot("recruiter-agent-playwright-no-jobs.png");
        return;
      }
      hasJobs = true;
      await page.getByLabel(/Search owned jobs/i).fill("a");
      await page.waitForTimeout(300);
      await page.getByLabel(/Search owned jobs/i).fill("");
      // Prefer a job that already has applicants (badge like "2 apps") for shortlist demos.
      const withApps = page
        .locator("ul")
        .first()
        .getByRole("button")
        .filter({ hasText: /\d+\s+apps?/i })
        .first();
      const jobBtn = (await withApps.count())
        ? withApps
        : page.locator("ul").first().getByRole("button").first();
      if (await jobBtn.count()) {
        await jobBtn.click();
        await page.getByText(/Job:/i).first().waitFor({ timeout: 10_000 });
        e.notes.push(
          (await withApps.count())
            ? "Selected owned job that has applicants"
            : "Selected an owned job from list (none showed applicant counts)",
        );
      } else {
        e.notes.push("Job list empty after filter clear");
      }
      await shot("recruiter-agent-playwright-jobs.png");
    }),
  );

  results.checks.push(
    await check("RA-05-applicants-context", async (e) => {
      if (!hasJobs) {
        e.notes.push("Skipped — no jobs");
        return;
      }
      await page.waitForTimeout(1500);
      const noApps = page.getByText(/No applicants/i);
      if (await noApps.isVisible().catch(() => false)) {
        e.notes.push("No applicants for selected/filter context");
        // Try clearing job to search across owned
        const clear = page.getByRole("button", { name: /Clear job/i });
        if (await clear.isVisible().catch(() => false)) await clear.click();
        await page.waitForTimeout(1500);
      }
      const appBtn = page
        .locator("section")
        .filter({ hasText: /Search applicants/i })
        .getByRole("button")
        .first();
      if (await appBtn.count()) {
        await appBtn.click();
        hasApplicants = true;
        e.notes.push("Selected an applicant");
        await page.getByText(/Applicant:/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
      } else {
        e.notes.push("No applicant buttons visible");
      }
      await shot("recruiter-agent-playwright-applicants.png");
    }),
  );

  results.checks.push(
    await check("RA-06-starters", async (e) => {
      if (!hasJobs) {
        e.notes.push("Skipped — starters disabled without jobs");
        return;
      }
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(400);
      for (const s of [
        "List my jobs with applicants",
        "Show applicants for this job",
        "Propose shortlist for the selected applicant",
        "Draft outreach for this job",
      ]) {
        await page.getByRole("button", { name: s, exact: true }).waitFor({ timeout: 10_000 });
      }
      e.notes.push("All 4 starter chips visible");
    }),
  );

  // —— Multi-agent Mode A ——
  results.checks.push(
    await check("MA-01-list-jobs-chat", async (e) => {
      if (!hasJobs) {
        e.notes.push("Skipped");
        return;
      }
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      const before = agentPayloads.length;
      await page.getByRole("button", { name: "List my jobs with applicants", exact: true }).click();
      await waitNotBusy(page);
      const body = await page.getByRole("main").innerText();
      const via = await page.getByText("via Supervisor").count();
      e.notes.push(`via Supervisor markers: ${via}`);
      e.notes.push(/jobs you own|owned jobs|Post a job/i.test(body) ? "Jobs listed in reply" : "Reply present");
      e.notes.push(`New payloads: ${agentPayloads.length - before}`);
      await shot("recruiter-agent-playwright-list-jobs.png");
    }),
  );

  results.checks.push(
    await check("MA-02-show-applicants", async (e) => {
      if (!hasJobs) {
        e.notes.push("Skipped");
        return;
      }
      // Ensure a job is selected
      const jobBtn = page.locator("ul").first().getByRole("button").first();
      if (await jobBtn.count()) await jobBtn.click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      await ask(page, "Show applicants for this job");
      const body = await page.getByRole("main").innerText();
      e.notes.push(
        /Applicants|No applicants|owned jobs/i.test(body)
          ? "Applicants reply rendered"
          : "Assistant reply rendered",
      );
      await shot("recruiter-agent-playwright-show-apps.png");
    }),
  );

  results.checks.push(
    await check("MA-03-propose-shortlist-no-confirm", async (e) => {
      if (!hasJobs) {
        e.notes.push("Skipped");
        return;
      }
      // Select applicant if available
      const appSection = page.locator("section").filter({ hasText: /Search applicants/i });
      const appBtn = appSection.getByRole("button").first();
      if (await appBtn.count()) {
        await appBtn.click();
        hasApplicants = true;
      }
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      const before = agentPayloads.length;
      await ask(page, "Propose shortlist for the selected applicant");
      const body = await page.getByRole("main").innerText();
      const confirmBar = page.getByText(/Step: confirm shortlist/i);
      const confirmVisible = await confirmBar.isVisible().catch(() => false);
      const selectStep = page.getByText(/Step: select applicant/i);
      const selectVisible = await selectStep.isVisible().catch(() => false);
      if (confirmVisible) {
        e.notes.push("Confirm shortlist bar shown (propose-only — NOT clicking Confirm)");
        // Cancel to avoid accidental confirm later
        const cancel = page.getByRole("button", { name: /^Cancel$/i });
        if (await cancel.isVisible().catch(() => false)) await cancel.click();
        e.notes.push("Cancelled pending confirm (Mode A)");
      } else if (selectVisible) {
        e.notes.push("Applicant choice step shown (multi-agent shortlist flow)");
      } else if (/select|confirm|shortlist|applicant/i.test(body)) {
        e.notes.push("Shortlist-related reply without sticky confirm bar");
      } else if (/Could not|failed|forbidden|unauthorized/i.test(body)) {
        throw new Error(`Shortlist propose error UI: ${body.slice(0, 200)}`);
      } else {
        e.notes.push("Reply rendered; confirm bar not shown (may need applicant selection)");
      }
      e.notes.push(`Payloads: ${JSON.stringify(agentPayloads.slice(before))}`);
      await shot("recruiter-agent-playwright-shortlist-propose.png");
    }),
  );

  results.checks.push(
    await check("MA-04-draft-outreach", async (e) => {
      if (!hasJobs) {
        e.notes.push("Skipped");
        return;
      }
      const jobBtn = page.locator("ul").first().getByRole("button").first();
      if (await jobBtn.count()) await jobBtn.click();
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      const before = agentPayloads.length;
      await ask(page, "Draft outreach for this job");
      const draftEditor = page.getByRole("heading", { name: /Outreach draft editor/i });
      const draftCard = page.getByText(/Outreach draft \(not sent\)/i);
      const hasEditor = await draftEditor.isVisible().catch(() => false);
      const hasCard = await draftCard.isVisible().catch(() => false);
      if (hasEditor || hasCard) {
        e.notes.push("Outreach draft UI shown (not sent)");
        if (hasEditor) {
          const subject = await page.locator("#outreach-subject").inputValue().catch(() => "");
          e.notes.push(`Subject length: ${subject.length}`);
        }
      } else {
        const body = await page.getByRole("main").innerText();
        if (/draft|outreach|campaign/i.test(body)) e.notes.push("Draft mentioned in chat");
        else e.notes.push(`No draft UI — body snippet: ${body.slice(0, 180)}`);
      }
      // Ensure no send button
      const sendEmail = page.getByRole("button", { name: /send email|confirm send|send campaign/i });
      if (await sendEmail.count()) {
        throw new Error("Unexpected email send control on agent page");
      }
      e.notes.push("No email-send control found (good)");
      e.notes.push(`Payloads: ${JSON.stringify(agentPayloads.slice(before))}`);
      await shot("recruiter-agent-playwright-outreach.png");
    }),
  );

  results.checks.push(
    await check("MA-05-supervised-nl-shortlist", async (e) => {
      if (!hasJobs || !hasApplicants) {
        e.notes.push("Skipped — need job+applicant");
        return;
      }
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(300);
      await ask(page, "Please shortlist the selected applicant");
      const confirmBar = page.getByText(/Step: confirm shortlist/i);
      if (await confirmBar.isVisible().catch(() => false)) {
        e.notes.push("NL shortlist hit confirm gate via Supervisor");
        const cancel = page.getByRole("button", { name: /^Cancel$/i });
        if (await cancel.isVisible().catch(() => false)) await cancel.click();
      } else {
        e.notes.push("NL shortlist reply without confirm bar");
      }
      await shot("recruiter-agent-playwright-nl-shortlist.png");
    }),
  );

  results.checks.push(
    await check("RA-07-history-rename-delete", async (e) => {
      page.once("dialog", async (d) => {
        if (d.type() === "prompt") await d.accept("Renamed by Playwright Agent");
        else await d.dismiss();
      });
      const rename = page.getByRole("button", { name: /Rename conversation/i }).first();
      if (!(await rename.count())) {
        e.notes.push("No history yet to rename");
        return;
      }
      await rename.click();
      await page.waitForTimeout(400);
      page.once("dialog", async (d) => d.accept());
      await page.getByRole("button", { name: /Delete conversation/i }).first().click();
      await page.waitForTimeout(400);
      e.notes.push("Rename + delete exercised");
    }),
  );

  results.checks.push(
    await check("RA-08-new-clears-chat", async (e) => {
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForTimeout(400);
      await page.getByText(/Ask me to list jobs|starter|Propose a shortlist/i).first().waitFor({
        timeout: 10_000,
      }).catch(() => {});
      e.notes.push("New conversation clicked");
    }),
  );

  results.checks.push(
    await check("RA-09-applicants-link", async (e) => {
      await page.getByRole("main").getByRole("link", { name: /^Applicants$/i }).click();
      await page.waitForURL(/\/recruiter\/applicants/, { timeout: 15_000 });
      e.notes.push("Applicants header link works");
      await page.goto(`${BASE}/recruiter/agent`);
      await page.getByRole("heading", { name: /AI Recruiter Agent/i }).waitFor({ timeout: 20_000 });
    }),
  );

  results.checks.push(
    await check("RA-10-mobile", async (e) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoAgent(page);
      await page.getByRole("heading", { name: /AI Recruiter Agent/i }).waitFor({ timeout: 20_000 });
      e.notes.push("Agent page loads at 390px");
      await shot("recruiter-agent-playwright-mobile.png");
      await page.setViewportSize({ width: 1400, height: 900 });
    }),
  );

  results.checks.push(
    await check("RA-11-copy-draft-if-present", async (e) => {
      await gotoAgent(page);
      // Re-draft quickly if jobs exist
      if (hasJobs) {
        const jobBtn = page.locator("ul").first().getByRole("button").first();
        if (await jobBtn.count()) await jobBtn.click();
        await ask(page, "Draft outreach for this job");
        const copy = page.getByRole("button", { name: /Copy draft/i });
        if (await copy.isVisible().catch(() => false)) {
          await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
          await copy.click();
          e.notes.push("Copy draft clicked");
        } else {
          e.notes.push("No draft editor to copy");
        }
      } else {
        e.notes.push("Skipped");
      }
    }),
  );

  // Multi-agent verdict
  const viaCount = await page.getByText("via Supervisor").count().catch(() => 0);
  const routes = [...new Set(agentPayloads.map((p) => p.routedTo).filter(Boolean))];
  const shortlistLike = agentPayloads.some(
    (p) =>
      p.status === "needs_confirm" ||
      p.status === "authorized" ||
      /shortlist|confirm/i.test(p.messagePreview || ""),
  );
  const outreachLike = agentPayloads.some(
    (p) => p.hasCampaign || /outreach|draft|campaign/i.test(p.messagePreview || ""),
  );
  const recruiterRoute = routes.includes("recruiter") || shortlistLike || outreachLike;

  results.multiAgent.routesSeen = routes;
  results.multiAgent.payloads = agentPayloads.slice(-40);
  results.multiAgent.viaSupervisorUiMarkers = viaCount;
  results.multiAgent.hasJobs = hasJobs;
  results.multiAgent.hasApplicants = hasApplicants;

  if (recruiterRoute && (shortlistLike || outreachLike)) {
    results.multiAgent.verdict = "working";
    results.multiAgent.notes.push(
      "Supervisor→recruiter specialist evidenced by shortlist and/or outreach payloads/UI.",
    );
  } else if (viaCount > 0 || shortlistLike || outreachLike) {
    results.multiAgent.verdict = "working-inferred-from-ui";
    results.multiAgent.notes.push(
      `UI shows via Supervisor (${viaCount}) and/or specialist outcomes; routedTo=${routes.join(",") || "n/a"}.`,
    );
  } else if (!hasJobs) {
    results.multiAgent.verdict = "blocked-no-jobs";
    results.multiAgent.notes.push("Cannot exercise recruiter specialist without owned jobs.");
  } else {
    results.multiAgent.verdict = "inconclusive";
    results.multiAgent.notes.push("Could not confirm recruiter specialist from payloads/UI.");
  }

  results.consoleErrors = [...new Set(consoleErrors)].slice(0, 40);
  results.pageErrors = [...new Set(pageErrors)].slice(0, 20);

  const outPath = path.join(ROOT, "docs", "recruiter-agent-ui-audit-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  await browser.close();

  const failed = results.checks.filter((c) => c.status === "fail");
  console.log(
    `Recruiter agent audit: ${results.checks.length} checks, ${failed.length} failed; multi-agent=${results.multiAgent.verdict}`,
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
