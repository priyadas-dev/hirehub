import { GEMINI_SERVER_ENV } from "@/lib/ai/gemini";
import { GEMINI_ASSISTANT_MODEL } from "@/lib/ai/job-assistant";

export type GenerateTextResult =
  | { ok: true; text: string; model: string }
  | {
      ok: false;
      message: string;
      category?: "config" | "unavailable" | "rate_limit" | "empty" | "other";
    };

function extractGeneratedText(body: unknown): {
  text: string | null;
  finishReason: string | null;
} {
  if (!body || typeof body !== "object") return { text: null, finishReason: null };
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { text: null, finishReason: null };
  }
  const first = candidates[0] as { content?: unknown; finishReason?: unknown };
  const finishReason = typeof first.finishReason === "string" ? first.finishReason : null;
  const content = first?.content;
  if (!content || typeof content !== "object") return { text: null, finishReason };
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return { text: null, finishReason };
  const texts = parts
    .map((p) => (p && typeof p === "object" ? (p as { text?: unknown }).text : null))
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  if (!texts.length) return { text: null, finishReason };
  return { text: texts.join("\n").trim(), finishReason };
}

/** Reject obviously cut-off fragments (e.g. ends with ", React"). */
export function looksLikeTruncatedAssistantAnswer(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // Short but complete sentences are fine.
  if (/[.!?]"?$/.test(trimmed) && trimmed.split(/\s+/).length >= 2) return false;
  if (/^[A-Z][a-zA-Z0-9+.#]{0,24}$/.test(trimmed)) return true;
  // Ends mid-sentence on a dangling capitalised token after a comma/disclaimer.
  if (/,\s*[A-Z][A-Za-z0-9+.#]*\s*$/.test(trimmed)) return true;
  if (trimmed.length < 24 && !/[.!?]$/.test(trimmed)) return true;
  return false;
}

const FALLBACK_ASSISTANT_MODELS = ["gemini-flash-latest"] as const;

async function generateOnce(
  prompt: string,
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch,
  maxOutputTokens: number,
): Promise<GenerateTextResult & { http?: number; providerStatus?: string | null }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens,
        },
      }),
    });
  } catch {
    return {
      ok: false,
      message: "The assistant could not reach Gemini. Try again shortly.",
      category: "unavailable",
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const err =
      body && typeof body === "object"
        ? (body as { error?: { status?: unknown; message?: unknown } }).error
        : null;
    const providerStatus = err && typeof err.status === "string" ? err.status : null;
    console.error(
      `[rag:assistant] gemini generate failed http=${response.status} status=${providerStatus ?? "n/a"} model=${model}`,
    );

    if (response.status === 404 || providerStatus === "NOT_FOUND") {
      return {
        ok: false,
        message:
          "The configured Gemini answer model is unavailable. Update GEMINI_ASSISTANT_MODEL / server config and try again.",
        category: "config",
        http: response.status,
        providerStatus,
      };
    }
    if (response.status === 429 || providerStatus === "RESOURCE_EXHAUSTED") {
      return {
        ok: false,
        message: "The assistant is rate-limited right now. Please try again in a moment.",
        category: "rate_limit",
        http: response.status,
        providerStatus,
      };
    }
    if (response.status === 503 || providerStatus === "UNAVAILABLE") {
      return {
        ok: false,
        message: "Gemini is temporarily unavailable (high demand). Please retry shortly.",
        category: "unavailable",
        http: response.status,
        providerStatus,
      };
    }
    return {
      ok: false,
      message: "The assistant service returned an error. Please try again shortly.",
      category: "other",
      http: response.status,
      providerStatus,
    };
  }

  const extracted = extractGeneratedText(body);
  if (!extracted.text) {
    return {
      ok: false,
      message: "The assistant returned an empty response.",
      category: "empty",
      http: response.status,
      providerStatus: null,
    };
  }

  // Only hard-fail on explicit MAX_TOKENS cutoffs. Heuristic truncation checks are
  // too aggressive and were rejecting valid short answers.
  if (
    extracted.finishReason === "MAX_TOKENS" &&
    looksLikeTruncatedAssistantAnswer(extracted.text)
  ) {
    return {
      ok: false,
      message: "The assistant response was incomplete. Please try again.",
      category: "empty",
      http: response.status,
      providerStatus: null,
    };
  }

  return { ok: true, text: extracted.text, model, http: response.status, providerStatus: null };
}

/**
 * Server-only Gemini text generation. Never returns the API key.
 * Retries once with a fallback Flash model on transient 503/UNAVAILABLE.
 */
export async function fetchGeminiGeneratedText(
  prompt: string,
  apiKey: string,
  options?: {
    model?: string;
    fetchImpl?: typeof fetch;
    maxOutputTokens?: number;
  },
): Promise<GenerateTextResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return {
      ok: false,
      message: "The AI Job Assistant is not configured on this server yet.",
      category: "config",
    };
  }

  const text = prompt.trim();
  if (!text) return { ok: false, message: "Prompt is empty.", category: "other" };

  const primary = options?.model ?? GEMINI_ASSISTANT_MODEL;
  const fetchImpl = options?.fetchImpl ?? fetch;
  // Keep outputs concise for faster chat latency.
  const maxOutputTokens = options?.maxOutputTokens ?? 512;
  const models = [primary, ...FALLBACK_ASSISTANT_MODELS.filter((m) => m !== primary)];

  let lastFailure: GenerateTextResult = {
    ok: false,
    message: "The assistant service returned an error. Please try again shortly.",
    category: "other",
  };

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex]!;
    // One short backoff on 429 before trying the same model again, then fall through to fallback model.
    let result = await generateOnce(text, trimmedKey, model, fetchImpl, maxOutputTokens);
    if (!result.ok && result.category === "rate_limit" && modelIndex === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      result = await generateOnce(text, trimmedKey, model, fetchImpl, maxOutputTokens);
    }
    if (result.ok) {
      return { ok: true, text: result.text, model: result.model };
    }
    lastFailure = {
      ok: false,
      message: result.message,
      category: result.category,
    };
    const retryable =
      result.category === "unavailable" ||
      result.category === "rate_limit" ||
      result.category === "empty" ||
      result.http === 503 ||
      result.providerStatus === "UNAVAILABLE";
    if (!retryable) break;
  }

  return lastFailure;
}

export function readGeminiApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env[GEMINI_SERVER_ENV.apiKey]?.trim() ?? "";
}
