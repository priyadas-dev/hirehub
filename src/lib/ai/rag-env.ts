import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Load `.env` into process.env for Track 1 CLI scripts (never prints secret values).
 * Vite already loads env for the app; scripts run outside Vite.
 */
export function loadProjectEnv(cwd = process.cwd()): string[] {
  const envPath = path.join(cwd, ".env");
  if (!existsSync(envPath)) return [];

  const loaded: string[] = [];
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}

export type RagEnvStatus = {
  supabaseUrl: boolean;
  serviceRoleKey: boolean;
  geminiApiKey: boolean;
  missing: string[];
};

/**
 * Env checks for RAG CLIs.
 * When provider is `local` or `gte`, GEMINI_API_KEY is not required for embed/retrieve
 * (Gemini flash for answers still needs the key in the app server).
 */
export function getRagEnvStatus(options?: {
  /** When false, skip GEMINI_API_KEY requirement (local / gte embed paths). */
  requireGemini?: boolean;
}): RagEnvStatus {
  const requireGemini = options?.requireGemini !== false;
  const supabaseUrl = Boolean(process.env["SUPABASE_URL"]?.trim());
  const serviceRoleKey = Boolean(process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim());
  const geminiApiKey = Boolean(process.env["GEMINI_API_KEY"]?.trim());
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (requireGemini && !geminiApiKey) missing.push("GEMINI_API_KEY");
  return { supabaseUrl, serviceRoleKey, geminiApiKey, missing };
}

export function requireRagServiceEnv(): { url: string; serviceRoleKey: string } {
  const url = process.env["SUPABASE_URL"]?.trim();
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error(
      [
        "Missing server env for corpus DB access.",
        "Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (never VITE_ / never commit real keys).",
        "Also review/apply drizzle/migrations/PROPOSED_0009_ai_foundation.sql",
        "then drizzle/migrations/PROPOSED_0010_rag_corpus.sql",
        "(and PROPOSED_0011_gte_small_embeddings.sql when using EMBEDDING_PROVIDER=gte).",
      ].join(" "),
    );
  }
  return { url, serviceRoleKey };
}

export function requireGeminiApiKey(): string {
  const key = process.env["GEMINI_API_KEY"]?.trim();
  if (!key) {
    throw new Error("Missing GEMINI_API_KEY in server env (no VITE_ prefix).");
  }
  return key;
}
