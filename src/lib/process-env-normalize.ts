/**
 * Client-safe env string normalization (no Node fs/path).
 * Server-only dotenv loading stays in `server-process-env.ts`.
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
