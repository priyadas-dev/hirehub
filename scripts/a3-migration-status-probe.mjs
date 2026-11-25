/**
 * Assessment 3 Gap 5 — read-only remote presence probe for Amol migration ask.
 * Never applies SQL. Never prints secrets.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = loadEnvFile();
const url = (process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || "").trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!url || !key) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        reason: "missing_service_role",
        fallback:
          "npx supabase db query --remote=munqgybiuqpncxbgfvdp --yes --read-only \"select to_regclass('public.agent_sessions')::text, to_regclass('public.google_calendar_watch_channels')::text;\"",
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function tableOk(name) {
  const { error } = await admin.from(name).select("*").limit(1);
  if (!error) return { present: true };
  if (/schema cache|does not exist|PGRST205|42P01/i.test(error.message)) {
    return { present: false, message: error.message };
  }
  return { present: true, note: error.message?.slice(0, 120) };
}

const agent_sessions = await tableOk("agent_sessions");
const google_calendar_watch_channels = await tableOk("google_calendar_watch_channels");
const crm_campaigns = await tableOk("crm_campaigns");

const report = {
  checkedAt: new Date().toISOString(),
  projectHost: new URL(url).host,
  agent_sessions,
  google_calendar_watch_channels,
  crm_campaigns,
  interpretation: {
    PROPOSED_0027_agent_sessions: agent_sessions.present ? "APPLIED (live)" : "MISSING",
    PROPOSED_0028_google_calendar_watch_channels: google_calendar_watch_channels.present
      ? "APPLIED (live)"
      : "MISSING",
    PROPOSED_0022_crm_ownership: crm_campaigns.present
      ? "CRM tables present — confirm composite FKs in ASSESSMENT_3_MIGRATION_STATUS.md"
      : "CRM tables missing",
  },
};

const out = resolve(process.cwd(), "docs/a3-migration-status-probe.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`Wrote ${out}`);
