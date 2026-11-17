/**
 * Read-only DB check after multi-agent UI verify.
 * Confirms recent saved_jobs rows for the seeker; does not write or delete.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  let email = process.env.E2E_SEEKER_EMAIL?.trim() ?? "";
  let password = process.env.E2E_SEEKER_PASSWORD?.trim() ?? "";
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const em = lines[i].trim().match(/^seeker\s+email\s*:\s*(.+)$/i);
    if (em) {
      email = em[1].trim();
      const pw = (lines[i + 1] ?? "").trim().match(/^password\s*:\s*(.+)$/i);
      if (pw) password = pw[1].trim();
    }
  }
  return { env, email, password };
}

async function main() {
  const { env, email, password } = loadEnv();
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey || !email) {
    console.error("Missing env for DB verify");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Resolve seeker id via profiles/auth without printing credentials.
  let seekerId = null;
  const { data: byEmail, error: emailErr } = await admin
    .from("profiles")
    .select("id, email, role")
    .ilike("email", email)
    .limit(3);
  if (!emailErr && byEmail?.length) {
    const seeker = byEmail.find((p) => p.role === "seeker") ?? byEmail[0];
    seekerId = seeker.id;
  }
  if (!seekerId && password) {
    const anon =
      env.SUPABASE_PUBLISHABLE_KEY ||
      env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      env.VITE_SUPABASE_ANON_KEY;
    if (anon) {
      const userClient = createClient(url, anon, { auth: { persistSession: false } });
      const { data: auth } = await userClient.auth.signInWithPassword({ email, password });
      seekerId = auth?.user?.id ?? null;
    }
  }
  if (!seekerId) {
    console.error("Could not resolve seeker id");
    process.exit(1);
  }

  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: saved, error: savedErr } = await admin
    .from("saved_jobs")
    .select("id, job_id, created_at, jobs(title)")
    .eq("seeker_id", seekerId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);

  if (savedErr) {
    console.error("saved_jobs query failed:", savedErr.message);
    process.exit(1);
  }

  const titles = (saved ?? []).map((r) => r.jobs?.title ?? r.job_id);
  const hasJunior = titles.some((t) => /junior software developer/i.test(String(t)));
  const hasIntern = titles.some((t) => /software engineer intern/i.test(String(t)));

  const { data: apps, error: appErr } = await admin
    .from("applications")
    .select("id, job_id, created_at, status")
    .eq("seeker_id", seekerId)
    .gte("created_at", since)
    .limit(5);

  const report = {
    seekerIdPrefix: seekerId.slice(0, 8),
    recentSavedCount: saved?.length ?? 0,
    recentSavedTitles: titles,
    saveThisOneVerified: hasJunior,
    saveSecondVerified: hasIntern,
    recentApplications: appErr ? { error: appErr.message } : apps ?? [],
    note: "Confirm-apply live insert was skipped in UI; no new application expected unless MULTI_AGENT_CONFIRM_APPLY=1",
  };

  const out = path.join(ROOT, "docs", "multi-agent-final-db-verify.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(hasJunior && hasIntern ? 0 : 1);
}

main();
