/**
 * Assessment 3 Gap 2 — capture ONE real Sentry event when DSN is configured.
 *
 * Guardian: does NOT edit .env. Reads SENTRY_DSN from process env or local .env
 * (never prints the DSN). Safe no-op exit with instructions if DSN missing.
 *
 * Usage:
 *   node scripts/sentry-smoke-capture.mjs
 *   # or after setting SENTRY_DSN in your shell / Vercel, then redeploy and run locally once
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
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
const dsn = (process.env.SENTRY_DSN || fileEnv.SENTRY_DSN || "").trim();

if (!dsn) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        reason: "SENTRY_DSN_missing",
        instructions: [
          "Create a free Sentry project and copy the DSN.",
          "Set SENTRY_DSN (server) and optional VITE_SENTRY_DSN (browser) in Vercel + local .env yourself — do not commit.",
          "Redeploy, then re-run: node scripts/sentry-smoke-capture.mjs",
          "Screenshot the resulting event in Sentry → Issues for DCT + report §7.",
        ],
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const require = createRequire(import.meta.url);
const Sentry = require("@sentry/node");

Sentry.init({
  dsn,
  tracesSampleRate: 0,
  sendDefaultPii: false,
});

const marker = `hirehub-a3-sentry-smoke-${new Date().toISOString()}`;
Sentry.captureException(new Error(marker), {
  tags: { source: "a3-sentry-smoke", assessment: "3" },
});

await Sentry.flush(5000);

console.log(
  JSON.stringify(
    {
      ok: true,
      marker,
      note: "Open Sentry → Issues and screenshot the event matching this marker. Do not paste the DSN into docs.",
    },
    null,
    2,
  ),
);
process.exit(0);
