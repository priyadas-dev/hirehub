/**
 * Phase 1 auth verification — reads local .env, never prints secret values.
 * Usage: node scripts/auth-phase1-verify.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
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
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const publishable =
  env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: profiles, error: pErr } = await admin
  .from("profiles")
  .select("id,email,role,created_at,full_name");
if (pErr) {
  console.error("profiles query failed:", pErr.message);
  process.exit(1);
}

const byRole = {};
for (const p of profiles) {
  byRole[p.role] = (byRole[p.role] || 0) + 1;
}

const users = [];
for (let page = 1; page <= 10; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error("listUsers failed:", error.message);
    process.exit(1);
  }
  users.push(...(data.users || []));
  if (!data.users || data.users.length < 200) break;
}

const profileById = Object.fromEntries(profiles.map((p) => [p.id, p]));
const orphans = users
  .filter((u) => !profileById[u.id])
  .map((u) => ({ id: u.id, email: u.email, created_at: u.created_at }));
const missingAuth = profiles
  .filter((p) => !users.find((u) => u.id === p.id))
  .map((p) => ({ id: p.id, email: p.email, role: p.role }));

function hasGoogle(u) {
  const providers = [
    ...(u.identities || []).map((i) => i.provider),
    u.app_metadata?.provider,
    ...(Array.isArray(u.app_metadata?.providers) ? u.app_metadata.providers : []),
  ].filter(Boolean);
  return providers.includes("google");
}

const googleSeekers = [];
const googleRecruiters = [];
for (const u of users) {
  if (!hasGoogle(u)) continue;
  const p = profileById[u.id];
  if (!p) continue;
  const ageMs = Date.now() - Date.parse(u.created_at);
  const row = {
    email: p.email || u.email,
    role: p.role,
    userCreatedAt: u.created_at,
    ageHours: Math.round(ageMs / 3_600_000),
    requested_role: u.user_metadata?.requested_role ?? null,
  };
  if (p.role === "job_seeker") googleSeekers.push(row);
  if (p.role === "recruiter") googleRecruiters.push(row);
}

const report = {
  checkedAt: new Date().toISOString(),
  projectHost: new URL(url).host,
  env: {
    supabaseUrlSet: true,
    publishableKeySet: Boolean(publishable),
    publishableKeyLen: publishable?.length ?? 0,
    serviceRoleKeySet: true,
    serviceRoleKeyLen: serviceKey.length,
  },
  profileCount: profiles.length,
  byRole,
  authUserCount: users.length,
  orphanAuthUsersWithoutProfile: orphans.length,
  orphanAuthSample: orphans.slice(0, 10),
  profilesWithoutAuthUser: missingAuth.length,
  googleSeekerCount: googleSeekers.length,
  googleRecruiterCount: googleRecruiters.length,
  googleSeekersLast30d: googleSeekers
    .filter((g) => g.ageHours <= 24 * 30)
    .sort((a, b) => a.ageHours - b.ageHours)
    .slice(0, 50),
  googleRecruitersSample: googleRecruiters.slice(0, 20),
  notes: [
    "Function definitions for migration 0001/0007 must be confirmed in Supabase SQL Editor (see docs).",
    "Google seekers cannot be proven as 'failed recruiter claims' without intent logs; treat list as inventory.",
  ],
};

const outPath = resolve(process.cwd(), "docs/authentication-phase-1-verify-result.json");
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log(`\nWrote ${outPath}`);
