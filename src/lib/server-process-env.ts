import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Normalize env strings that may include wrapping quotes or whitespace.
 * Never logs or returns secret values — presence helpers only.
 */
export function normalizeProcessEnvValue(value: string | undefined | null): string {
  let v = (value ?? "").trim();
  if (!v) return "";
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'")) ||
    (v.startsWith("\u201C") && v.endsWith("\u201D")) ||
    (v.startsWith("\u2018") && v.endsWith("\u2019"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

let dotenvLoaded = false;

/**
 * One-time `.env` → `process.env` fill for Node server paths that run outside
 * Vite's config hook (or started before keys were added). Skips keys already set.
 * No-op in non-Node runtimes / when `.env` is absent (e.g. Vercel with injected secrets).
 */
export function ensureProcessEnvFromDotenv(cwd = process.cwd()): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  if (typeof process === "undefined" || typeof process.env !== "object") return;

  const envPath = path.join(cwd, ".env");
  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = normalizeProcessEnvValue(line.slice(eq + 1));
  }
}

/** Test-only: allow re-running ensure after clearing process.env keys. */
export function resetProcessEnvFromDotenvForTests(): void {
  dotenvLoaded = false;
}
