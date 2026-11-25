import { normalizeProcessEnvValue } from "@/lib/process-env-normalize";

export { normalizeProcessEnvValue };

let dotenvLoaded = false;

/**
 * One-time `.env` → `process.env` fill for Node server paths that run outside
 * Vite's config hook (or started before keys were added). Skips keys already set.
 * No-op in browsers / when `.env` is absent (e.g. Vercel with injected secrets).
 *
 * Intentionally avoids top-level `node:fs` imports so this module is safe to
 * appear in a client dependency graph (server fns imported by routes). FS is
 * only required after a browser guard.
 */
export function ensureProcessEnvFromDotenv(cwd = typeof process !== "undefined" ? process.cwd() : ""): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  if (typeof process === "undefined" || typeof process.env !== "object") return;
  // Real Node only — Vite client has no process.versions.node; jsdom tests still do.
  if (typeof process.versions?.node !== "string") return;
  if (!cwd) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const envPath = path.join(cwd, ".env");
    if (!fs.existsSync(envPath)) return;

    const text = fs.readFileSync(envPath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = normalizeProcessEnvValue(line.slice(eq + 1));
    }
  } catch {
    /* hosted runtimes inject secrets; local without Node fs is a no-op */
  }
}

/** Test-only: allow re-running ensure after clearing process.env keys. */
export function resetProcessEnvFromDotenvForTests(): void {
  dotenvLoaded = false;
}
