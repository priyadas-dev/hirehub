/**
 * Live Storage JWT matrix for private resumes (Assessment 3).
 *
 * Proves: hiring recruiter can createSignedUrl; non-hiring recruiter / anon denied.
 * READ-ONLY (createSignedUrl only). Never prints passwords or JWTs. Does not edit .env.
 *
 * Env (process or .env):
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY / ANON key
 *   Optional: SUPABASE_SERVICE_ROLE_KEY (helps pick a resume path)
 *   A3_HIRING_RECRUITER_EMAIL/PASSWORD — or informal "recuiter email:" lines in .env
 *   A3_OTHER_RECRUITER_EMAIL/PASSWORD — second recruiter (preferred)
 *   If other recruiter missing: same hiring recruiter is tested against a
 *   foreign resume path (not linked to their jobs) = same RLS deny rule.
 *
 * Usage: node scripts/resume-other-recruiter-deny.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return {};
  const out = {};
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    if (line.includes("=") && !/^(recuiter|recruiter|seeker|admin)\s+/i.test(line.trim())) {
      const i = line.indexOf("=");
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'")) ||
        (val.startsWith("“") && val.endsWith("”"))
      ) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  }
  // Informal credential lines used by local e2e scripts
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const em = t.match(/^recui?ter\s+email\s*:\s*(.+)$/i);
    if (em) {
      out.A3_HIRING_RECRUITER_EMAIL = out.A3_HIRING_RECRUITER_EMAIL || em[1].trim();
      const next = (lines[i + 1] ?? "").trim();
      const pw = next.match(/^recui?ter\s+password\s*:\s*(.+)$/i) || next.match(/^password\s*:\s*(.+)$/i);
      if (pw) out.A3_HIRING_RECRUITER_PASSWORD = out.A3_HIRING_RECRUITER_PASSWORD || pw[1].trim();
    }
  }
  return out;
}

function env(key, fileEnv) {
  return (process.env[key] || fileEnv[key] || "").trim();
}

function redactPath(p) {
  if (!p) return null;
  const parts = String(p).split("/");
  if (parts.length < 2) return "[path]";
  return `${parts[0].slice(0, 8)}…/…`;
}

const fileEnv = loadEnvFile();
const url = env("SUPABASE_URL", fileEnv) || env("VITE_SUPABASE_URL", fileEnv);
const anon =
  env("SUPABASE_ANON_KEY", fileEnv) ||
  env("VITE_SUPABASE_ANON_KEY", fileEnv) ||
  env("VITE_SUPABASE_PUBLISHABLE_KEY", fileEnv) ||
  env("SUPABASE_PUBLISHABLE_KEY", fileEnv);
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY", fileEnv);
const hiringEmail = env("A3_HIRING_RECRUITER_EMAIL", fileEnv);
const hiringPassword = env("A3_HIRING_RECRUITER_PASSWORD", fileEnv);
const otherEmail = env("A3_OTHER_RECRUITER_EMAIL", fileEnv);
const otherPassword = env("A3_OTHER_RECRUITER_PASSWORD", fileEnv);
const forcedPath = env("A3_RESUME_OBJECT_PATH", fileEnv);

if (!url || !anon) {
  console.error("Missing SUPABASE URL or anon/publishable key.");
  process.exit(1);
}
if (!hiringEmail || !hiringPassword) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        reason: "missing_hiring_recruiter_credentials",
        hint: "Set A3_HIRING_RECRUITER_EMAIL/PASSWORD or informal recuiter email/password lines in .env",
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

async function signIn(email, password) {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`sign-in failed for ${email}: ${error?.message || "no session"}`);
  }
  return client;
}

async function trySign(client, objectPath) {
  const { data, error } = await client.storage.from("resumes").createSignedUrl(objectPath, 60);
  const status =
    error && typeof error === "object" && "statusCode" in error
      ? Number(error.statusCode)
      : error && typeof error === "object" && "status" in error
        ? Number(error.status)
        : null;
  return {
    ok: Boolean(data?.signedUrl) && !error,
    status: Number.isFinite(status) ? status : null,
    errorMessage: error?.message ? String(error.message).slice(0, 160) : null,
  };
}

function isDenied(result) {
  return (
    result.ok === false &&
    (result.status === 403 ||
      result.status === 400 ||
      /row-level security|not found|Unauthorized|Forbidden|access|Bucket not found|Object not found/i.test(
        result.errorMessage || "",
      ))
  );
}

const hiring = await signIn(hiringEmail, hiringPassword);
const { data: me } = await hiring.auth.getUser();
const myId = me.user?.id;

let objectPath = forcedPath;
let foreignPath = null;

if (!objectPath && serviceKey) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: apps } = await admin
    .from("applications")
    .select("resume_storage_path, job_id, jobs(recruiter_id)")
    .not("resume_storage_path", "is", null)
    .limit(50);
  const mine = (apps || []).find((r) => {
    const job = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
    return job?.recruiter_id === myId && r.resume_storage_path;
  });
  objectPath = mine?.resume_storage_path || null;
  const foreign = (apps || []).find((r) => {
    const job = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
    return job?.recruiter_id && job.recruiter_id !== myId && r.resume_storage_path;
  });
  foreignPath = foreign?.resume_storage_path || null;
  if (!foreignPath) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, resume_storage_path, role")
      .eq("role", "job_seeker")
      .not("resume_storage_path", "is", null)
      .limit(20);
    const other = (profiles || []).find(
      (p) => p.resume_storage_path && p.resume_storage_path !== objectPath,
    );
    foreignPath = other?.resume_storage_path || null;
  }
}

if (!objectPath) {
  const { data: rows, error } = await hiring
    .from("applications")
    .select("resume_storage_path, jobs!inner(recruiter_id)")
    .not("resume_storage_path", "is", null)
    .limit(20);
  if (error) {
    console.error("Could not list applications:", error.message);
    process.exit(1);
  }
  const match = (rows || []).find((r) => {
    const job = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
    return job?.recruiter_id === myId && r.resume_storage_path;
  });
  objectPath = match?.resume_storage_path || null;
}

if (!objectPath) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        reason: "no_resume_path",
        hint: "Need an application with resume_storage_path on a job owned by the hiring recruiter, or set A3_RESUME_OBJECT_PATH.",
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const hiringResult = await trySign(hiring, objectPath);

let otherResult;
let otherMode;
if (otherEmail && otherPassword && otherEmail.toLowerCase() !== hiringEmail.toLowerCase()) {
  const other = await signIn(otherEmail, otherPassword);
  otherResult = await trySign(other, objectPath);
  otherMode = "second_recruiter_same_path";
} else if (foreignPath) {
  otherResult = await trySign(hiring, foreignPath);
  otherMode = "hiring_recruiter_on_foreign_path";
} else {
  const guessed = `${myId === "x" ? "x" : "00000000-0000-4000-8000-000000000099"}/not-entitled.pdf`;
  otherResult = await trySign(hiring, guessed);
  otherMode = "hiring_recruiter_on_guessed_foreign_path";
}

const anonClient = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonResult = await trySign(anonClient, objectPath);

const otherDenied = isDenied(otherResult);
const anonDenied = isDenied(anonResult);
const pass = hiringResult.ok === true && otherDenied === true && anonDenied === true;

const report = {
  checkedAt: new Date().toISOString(),
  bucket: "resumes",
  objectPathRedacted: redactPath(objectPath),
  foreignPathRedacted: foreignPath ? redactPath(foreignPath) : null,
  otherMode,
  hiringRecruiter: { email: hiringEmail, ...hiringResult },
  otherPrincipal: {
    email: otherMode === "second_recruiter_same_path" ? otherEmail : hiringEmail,
    ...otherResult,
  },
  anonymous: anonResult,
  pass,
  amolEvidence: {
    hiringAllowed: hiringResult.ok === true,
    otherDenied,
    anonDenied,
    expected:
      "hiring ok=true; non-entitled recruiter/path ok=false (~403/RLS); anon ok=false",
  },
};

const outPath = resolve(process.cwd(), "docs/a3-resume-other-recruiter-deny.json");
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`Wrote ${outPath}`);
process.exit(pass ? 0 : 3);
