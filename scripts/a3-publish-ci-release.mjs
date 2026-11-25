/**
 * Gap 1 helper — find green CI run + create assessment-3 GitHub Release.
 * Uses git credential-manager for auth. Never prints tokens/passwords.
 *
 * Usage:
 *   node scripts/a3-publish-ci-release.mjs           # dry status (list green run)
 *   node scripts/a3-publish-ci-release.mjs --publish  # create tag (if missing) + Release
 */
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OWNER = "priyadas-dev";
const REPO = "hirehub";
const TAG = "assessment-3";
const publish = process.argv.includes("--publish");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function getGithubAuth() {
  const input = "protocol=https\nhost=github.com\n\n";
  const r = spawnSync("git", ["credential", "fill"], {
    input,
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error("git credential fill failed — sign in to GitHub via Git Credential Manager first");
  }
  const lines = r.stdout.split(/\r?\n/);
  const map = {};
  for (const line of lines) {
    const i = line.indexOf("=");
    if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
  }
  const user = map.username || "";
  const pass = map.password || "";
  if (!pass) throw new Error("No GitHub password/token from credential manager");
  return { user, pass };
}

async function ghApi(auth, path, init = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "hirehub-a3-closeout",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${auth.pass}`,
    ...(init.headers || {}),
  };
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, body };
}

const auth = getGithubAuth();
const head = git(["rev-parse", "origin/main"]);

const runs = await ghApi(
  auth,
  `/repos/${OWNER}/${REPO}/actions/workflows/ci.yml/runs?branch=main&per_page=15`,
);
if (!runs.ok) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        step: "list_runs",
        status: runs.status,
        message: runs.body?.message || "failed",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const all = runs.body?.workflow_runs || [];
const green = all.find((r) => r.conclusion === "success" && r.status === "completed");
const latest = all[0] || null;

const result = {
  ok: true,
  originMainSha: head,
  latestRun: latest
    ? {
        id: latest.id,
        status: latest.status,
        conclusion: latest.conclusion,
        html_url: latest.html_url,
        head_sha: latest.head_sha,
        created_at: latest.created_at,
      }
    : null,
  greenRun: green
    ? {
        id: green.id,
        html_url: green.html_url,
        head_sha: green.head_sha,
        created_at: green.created_at,
      }
    : null,
  release: null,
  tag: null,
};

if (!publish) {
  const out = resolve(process.cwd(), "docs/a3-ci-release-status.json");
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`Wrote ${out}`);
  if (!green) {
    console.error(
      "No green CI run on main yet. Push a commit that triggers CI, wait for green, re-run.",
    );
    process.exit(2);
  }
  process.exit(0);
}

if (!green) {
  console.error("Refusing --publish without a green CI run on main.");
  process.exit(2);
}

// Ensure annotated tag points at origin/main (or existing tag)
let tagSha = null;
try {
  tagSha = git(["rev-list", "-n", "1", TAG]);
} catch {
  tagSha = null;
}

if (!tagSha) {
  try {
    git([
      "tag",
      "-a",
      TAG,
      "origin/main",
      "-m",
      "Assessment 3 submission — integrated HireHub (CI, Sentry, agents, RAG 20k, resume RLS)",
    ]);
    tagSha = git(["rev-list", "-n", "1", TAG]);
    result.tag = { created: true, sha: tagSha };
  } catch (e) {
    console.error("tag create failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
} else {
  result.tag = { created: false, sha: tagSha, note: "tag already existed locally" };
}

// Push tag
const push = spawnSync("git", ["push", "origin", TAG], {
  encoding: "utf8",
  windowsHide: true,
});
result.tagPush = {
  status: push.status,
  stderr: (push.stderr || "").split(/\r?\n/).filter(Boolean).slice(-5),
};
if (push.status !== 0) {
  writeFileSync(
    resolve(process.cwd(), "docs/a3-ci-release-status.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  console.error("git push origin assessment-3 failed — fix auth and retry --publish");
  process.exit(1);
}

const releaseBody = `HireHub Assessment 3 — multi-role recruitment portal with:

- Real integrations (Resend outbound + Svix inbound; Google Calendar)
- Recruiter CRM (contacts / segments / campaigns)
- Supervised multi-agent stack + guardrails + confirm-to-apply
- RAG eval at 20k (Hit@5 0.55 → 0.70) and honest classifier Macro F1 0.861
- Production surface: GitHub Actions CI, Sentry, private resume Storage RLS, idempotent apply

Green CI: ${green.html_url}
`;

const existing = await ghApi(auth, `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
if (existing.ok && existing.body?.html_url) {
  result.release = {
    created: false,
    html_url: existing.body.html_url,
    tag_name: existing.body.tag_name,
  };
} else {
  const created = await ghApi(auth, `/repos/${OWNER}/${REPO}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: TAG,
      name: "assessment-3",
      body: releaseBody,
      draft: false,
      prerelease: false,
      target_commitish: "main",
    }),
  });
  if (!created.ok) {
    result.release = { created: false, error: created.body, status: created.status };
    writeFileSync(
      resolve(process.cwd(), "docs/a3-ci-release-status.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  result.release = {
    created: true,
    html_url: created.body.html_url,
    tag_name: created.body.tag_name,
  };
}

result.greenRun = {
  id: green.id,
  html_url: green.html_url,
  head_sha: green.head_sha,
  created_at: green.created_at,
};

const out = resolve(process.cwd(), "docs/a3-ci-release-status.json");
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
console.log(`Wrote ${out}`);
