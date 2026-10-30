/**
 * READ-ONLY probe for Auth Phase 2 / migration reconciliation.
 * Does not INSERT/UPDATE/DELETE/DDL. Never prints secrets.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnv(path) {
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

const env = loadEnv(resolve(process.cwd(), ".env"));
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Probe RPC existence without mutating: call with a random UUID that won't match a user.
const probeUser = "00000000-0000-4000-8000-000000000000";
const claimRpc = await admin.rpc("claim_oauth_recruiter_role", { p_user_id: probeUser });
const seekerFn = await admin.rpc("seeker_has_applied_to_job", {
  _job_id: probeUser,
});
const ftsFn = await admin.rpc("search_job_corpus_fts", {
  query_text: "test",
  match_count: 1,
});

// Schema presence checks via information_schema through PostgREST is limited;
// use known tables/columns as proxies for applied migrations.
const probes = {};

for (const [label, query] of [
  ["profiles_role", () => admin.from("profiles").select("id,role").limit(1)],
  [
    "jobs_closed_reason",
    () => admin.from("jobs").select("id,closed_reason").limit(1),
  ],
  [
    "profiles_skills",
    () => admin.from("profiles").select("id,skills").limit(1),
  ],
  [
    "job_corpus",
    () => admin.from("job_corpus").select("id").limit(1),
  ],
  [
    "notifications",
    () => admin.from("notifications").select("id").limit(1),
  ],
]) {
  try {
    const { error } = await query();
    probes[label] = error
      ? { ok: false, message: error.message, code: error.code }
      : { ok: true };
  } catch (e) {
    probes[label] = { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      projectHost: new URL(url).host,
      claim_oauth_recruiter_role: {
        error: claimRpc.error
          ? { message: claimRpc.error.message, code: claimRpc.error.code, details: claimRpc.error.details }
          : null,
        data: claimRpc.data ?? null,
        interpretation: claimRpc.error
          ? /could not find|schema cache|PGRST202|42883/i.test(claimRpc.error.message)
            ? "RPC_MISSING"
            : "RPC_PRESENT_BUT_CALL_ERROR"
          : "RPC_PRESENT",
      },
      seeker_has_applied_to_job: {
        error: seekerFn.error
          ? { message: seekerFn.error.message, code: seekerFn.error.code }
          : null,
        data: seekerFn.data ?? null,
        interpretation: seekerFn.error
          ? /could not find|schema cache|PGRST202|42883/i.test(seekerFn.error.message)
            ? "FN_MISSING_OR_NOT_EXPOSED"
            : "FN_PRESENT_OR_CALLABLE"
          : "FN_CALLABLE",
      },
      search_job_corpus_fts: {
        error: ftsFn.error
          ? { message: ftsFn.error.message, code: ftsFn.error.code }
          : null,
        interpretation: ftsFn.error
          ? /could not find|schema cache|PGRST202|42883/i.test(ftsFn.error.message)
            ? "RPC_MISSING_LIKELY_0018_NOT_APPLIED"
            : "RPC_PRESENT_OR_CALL_ERROR"
          : "RPC_PRESENT",
      },
      schemaProbes: probes,
      notes: [
        "claim_oauth_recruiter_role with nonexistent UUID should return profile_missing/user_missing if RPC exists.",
        "seeker_has_applied_to_job is the hallmark of PROPOSED_0017 (fix_jobs_applications_rls_recursion).",
        "This script performs no DDL and no schema_migrations writes.",
      ],
    },
    null,
    2,
  ),
);
