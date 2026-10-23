import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server-only Gemini embedding helpers for HireHub Track 0+.
 * Never use a VITE_ prefix for the API key — it must not reach the browser.
 */

export const GEMINI_SERVER_ENV = {
  apiKey: "GEMINI_API_KEY",
} as const;

/**
 * Current Gemini embedding model (replaces discontinued text-embedding-004).
 * Default output is 3072; we request 768 to match extensions.vector(768).
 */
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001" as const;

/** Must stay aligned with job_corpus.embedding and match_job_corpus(). */
export const GEMINI_EMBEDDING_DIMENSIONS = 768 as const;

const GEMINI_EMBED_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent` as const;

/** Sync multi-text embed endpoint (same model). Hard-capped at 100 texts per request by Gemini. */
const GEMINI_BATCH_EMBED_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents` as const;

/** Official Gemini Developer API limit for `:batchEmbedContents` requests[]. */
export const GEMINI_BATCH_EMBED_MAX_REQUESTS = 100 as const;

export const embedTextInputSchema = z.object({
  text: z.string().trim().min(1, "Text to embed is required").max(8000, "Text is too long to embed"),
});

export type EmbedTextInput = z.infer<typeof embedTextInputSchema>;

export type EmbedTextSuccess = {
  ok: true;
  embedding: number[];
  dimensions: number;
  model: string;
};

/** Safe, non-secret metadata for embed failures (never includes key or input text). */
export type GeminiEmbedDiagnostic = {
  httpStatus: number | null;
  category:
    | "auth"
    | "rate_limit"
    | "invalid_argument"
    | "not_found"
    | "permission"
    | "server"
    | "network"
    | "empty_response"
    | "unexpected_shape"
    | "wrong_dimensions"
    | "validation"
    | "unknown";
  geminiStatus: string | null;
  geminiCode: number | null;
  inputChars: number;
  retryable: boolean;
  /** Parsed from Retry-After when present (milliseconds). */
  retryAfterMs: number | null;
};

export type EmbedTextFailure = {
  ok: false;
  message: string;
  diagnostic?: GeminiEmbedDiagnostic;
};

export type EmbedTextResult = EmbedTextSuccess | EmbedTextFailure;

/** Request body for Gemini embedContent (768-dim Matryoshka truncation). */
export function buildGeminiEmbedRequestBody(text: string) {
  return {
    model: `models/${GEMINI_EMBEDDING_MODEL}`,
    content: {
      parts: [{ text }],
    },
    // Supported Gemini API field — keep embeddings compatible with vector(768).
    outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
  };
}

/**
 * Request body for Gemini batchEmbedContents.
 * One EmbedContentRequest per text; response embeddings[] matches this order.
 * Caller must keep texts.length in 1..GEMINI_BATCH_EMBED_MAX_REQUESTS.
 */
export function buildGeminiBatchEmbedRequestBody(texts: string[]) {
  return {
    requests: texts.map((text) => buildGeminiEmbedRequestBody(text)),
  };
}

/**
 * Classify a Gemini embedContent error without logging secrets or document text.
 * Reads only status codes / structured error fields.
 */
export function classifyGeminiEmbedError(input: {
  httpStatus: number | null;
  body: unknown;
  inputChars: number;
}): GeminiEmbedDiagnostic {
  const err =
    input.body && typeof input.body === "object"
      ? ((input.body as { error?: { status?: unknown; code?: unknown } }).error ?? null)
      : null;
  const geminiStatus = typeof err?.status === "string" ? err.status : null;
  const geminiCode = typeof err?.code === "number" ? err.code : null;
  const http = input.httpStatus;

  let category: GeminiEmbedDiagnostic["category"] = "unknown";
  if (http === 401 || geminiStatus === "UNAUTHENTICATED") {
    category = "auth";
  } else if (http === 403 || geminiStatus === "PERMISSION_DENIED") {
    category = "permission";
  } else if (http === 429 || geminiStatus === "RESOURCE_EXHAUSTED") {
    category = "rate_limit";
  } else if (http === 404 || geminiStatus === "NOT_FOUND") {
    category = "not_found";
  } else if (http === 400 || geminiStatus === "INVALID_ARGUMENT" || geminiStatus === "FAILED_PRECONDITION") {
    category = "invalid_argument";
  } else if (http !== null && http >= 500) {
    category = "server";
  }

  const retryable =
    category === "rate_limit" || category === "server" || category === "network" || http === 408 || http === 409;

  return {
    httpStatus: http,
    category,
    geminiStatus,
    geminiCode,
    inputChars: input.inputChars,
    retryable,
    retryAfterMs: null,
  };
}

/** Parse Retry-After (seconds or HTTP-date) into milliseconds; capped at 120s. */
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(Math.round(asSeconds * 1000), 120_000);
  }
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    return Math.min(Math.max(0, asDate - Date.now()), 120_000);
  }
  return null;
}

/**
 * Exponential backoff with jitter. Prefer Retry-After when the API provides it.
 * attempt is 1-based (first failure → attempt 1).
 */
export function computeEmbedBackoffMs(
  attempt: number,
  retryAfterMs: number | null | undefined = null,
  random: () => number = Math.random,
): number {
  if (retryAfterMs != null && retryAfterMs > 0) {
    const jitter = Math.floor(random() * 250);
    return Math.min(retryAfterMs + jitter, 120_000);
  }
  const exp = Math.max(0, attempt - 1);
  const base = Math.min(500 * 2 ** exp, 30_000);
  const jitter = Math.floor(random() * base * 0.25);
  return base + jitter;
}

/** CLI-safe one-line diagnostic (no secrets, no document content). */
export function formatEmbedDiagnostic(diagnostic: GeminiEmbedDiagnostic): string {
  return [
    `http=${diagnostic.httpStatus ?? "n/a"}`,
    `category=${diagnostic.category}`,
    `geminiStatus=${diagnostic.geminiStatus ?? "n/a"}`,
    `geminiCode=${diagnostic.geminiCode ?? "n/a"}`,
    `inputChars=${diagnostic.inputChars}`,
    `retryable=${diagnostic.retryable}`,
    `retryAfterMs=${diagnostic.retryAfterMs ?? "n/a"}`,
  ].join(" ");
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

function extractEmbeddingValues(body: unknown): number[] | null {
  if (!body || typeof body !== "object") return null;
  const embedding = (body as { embedding?: unknown }).embedding;
  if (!embedding || typeof embedding !== "object") return null;
  const values = (embedding as { values?: unknown }).values;
  return isNumberArray(values) ? values : null;
}

/**
 * Extract ordered embeddings from a batchEmbedContents response.
 * Returns null when shape/count/dimensions are unsafe to map by index.
 */
export function extractBatchEmbeddingValues(
  body: unknown,
  expectedCount: number,
): number[][] | null {
  if (!body || typeof body !== "object") return null;
  const embeddings = (body as { embeddings?: unknown }).embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) return null;

  const out: number[][] = [];
  for (const item of embeddings) {
    if (!item || typeof item !== "object") return null;
    const values = (item as { values?: unknown }).values;
    if (!isNumberArray(values) || values.length !== GEMINI_EMBEDDING_DIMENSIONS) return null;
    out.push(values);
  }
  return out;
}

export type EmbedTextsSuccess = {
  ok: true;
  embeddings: number[][];
  dimensions: number;
  model: string;
};

export type EmbedTextsResult = EmbedTextsSuccess | EmbedTextFailure;

/**
 * Calls Gemini embedContent and validates a 768-float response.
 * Accepts an injected fetch for tests. Never returns the API key.
 */
export async function fetchGeminiEmbedding(
  text: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EmbedTextResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return {
      ok: false,
      message: "Embedding is not configured on this server yet.",
      diagnostic: {
        httpStatus: null,
        category: "validation",
        geminiStatus: null,
        geminiCode: null,
        inputChars: 0,
        retryable: false,
        retryAfterMs: null,
      },
    };
  }

  const parsed = embedTextInputSchema.safeParse({ text });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid embedding input.",
      diagnostic: {
        httpStatus: null,
        category: "validation",
        geminiStatus: null,
        geminiCode: null,
        inputChars: text.trim().length,
        retryable: false,
        retryAfterMs: null,
      },
    };
  }

  const inputChars = parsed.data.text.length;

  let response: Response;
  try {
    response = await fetchImpl(GEMINI_EMBED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": trimmedKey,
      },
      body: JSON.stringify(buildGeminiEmbedRequestBody(parsed.data.text)),
    });
  } catch {
    return {
      ok: false,
      message: "The embedding service could not be reached. Try again shortly.",
      diagnostic: {
        httpStatus: null,
        category: "network",
        geminiStatus: null,
        geminiCode: null,
        inputChars,
        retryable: true,
        retryAfterMs: null,
      },
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const diagnostic: GeminiEmbedDiagnostic = {
      ...classifyGeminiEmbedError({
        httpStatus: response.status,
        body,
        inputChars,
      }),
      retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After")),
    };
    return {
      ok: false,
      message: "The embedding service returned an error. Check the server configuration and try again.",
      diagnostic,
    };
  }

  const values = extractEmbeddingValues(body);
  if (!values) {
    return {
      ok: false,
      message: "The embedding service returned an unexpected response shape.",
      diagnostic: {
        httpStatus: response.status,
        category: body == null ? "empty_response" : "unexpected_shape",
        geminiStatus: null,
        geminiCode: null,
        inputChars,
        retryable: false,
        retryAfterMs: null,
      },
    };
  }

  if (values.length !== GEMINI_EMBEDDING_DIMENSIONS) {
    return {
      ok: false,
      message: `Expected a ${GEMINI_EMBEDDING_DIMENSIONS}-dimensional embedding, got ${values.length}.`,
      diagnostic: {
        httpStatus: response.status,
        category: "wrong_dimensions",
        geminiStatus: null,
        geminiCode: null,
        inputChars,
        retryable: false,
        retryAfterMs: null,
      },
    };
  }

  return {
    ok: true,
    embedding: values,
    dimensions: values.length,
    model: GEMINI_EMBEDDING_MODEL,
  };
}

/**
 * Calls Gemini batchEmbedContents for multiple texts (max 100).
 * Preserves request order in embeddings[]. Accepts injected fetch for tests.
 * Never returns the API key or document text.
 */
export async function fetchGeminiEmbeddingsBatch(
  texts: string[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EmbedTextsResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return {
      ok: false,
      message: "Embedding is not configured on this server yet.",
      diagnostic: {
        httpStatus: null,
        category: "validation",
        geminiStatus: null,
        geminiCode: null,
        inputChars: 0,
        retryable: false,
        retryAfterMs: null,
      },
    };
  }

  if (!Array.isArray(texts) || texts.length === 0) {
    return {
      ok: false,
      message: "At least one text is required for batch embedding.",
      diagnostic: {
        httpStatus: null,
        category: "validation",
        geminiStatus: null,
        geminiCode: null,
        inputChars: 0,
        retryable: false,
        retryAfterMs: null,
      },
    };
  }

  if (texts.length > GEMINI_BATCH_EMBED_MAX_REQUESTS) {
    return {
      ok: false,
      message: `Batch embedding supports at most ${GEMINI_BATCH_EMBED_MAX_REQUESTS} texts per request.`,
      diagnostic: {
        httpStatus: null,
        category: "validation",
        geminiStatus: null,
        geminiCode: null,
        inputChars: texts.reduce((sum, t) => sum + t.trim().length, 0),
        retryable: false,
        retryAfterMs: null,
      },
    };
  }

  const normalized: string[] = [];
  for (const text of texts) {
    const parsed = embedTextInputSchema.safeParse({ text });
    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Invalid embedding input.",
        diagnostic: {
          httpStatus: null,
          category: "validation",
          geminiStatus: null,
          geminiCode: null,
          inputChars: typeof text === "string" ? text.trim().length : 0,
          retryable: false,
          retryAfterMs: null,
        },
      };
    }
    normalized.push(parsed.data.text);
  }

  const inputChars = normalized.reduce((sum, t) => sum + t.length, 0);

  let response: Response;
  try {
    response = await fetchImpl(GEMINI_BATCH_EMBED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": trimmedKey,
      },
      body: JSON.stringify(buildGeminiBatchEmbedRequestBody(normalized)),
    });
  } catch {
    return {
      ok: false,
      message: "The embedding service could not be reached. Try again shortly.",
      diagnostic: {
        httpStatus: null,
        category: "network",
        geminiStatus: null,
        geminiCode: null,
        inputChars,
        retryable: true,
        retryAfterMs: null,
      },
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const diagnostic: GeminiEmbedDiagnostic = {
      ...classifyGeminiEmbedError({
        httpStatus: response.status,
        body,
        inputChars,
      }),
      retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After")),
    };
    return {
      ok: false,
      message: "The embedding service returned an error. Check the server configuration and try again.",
      diagnostic,
    };
  }

  const values = extractBatchEmbeddingValues(body, normalized.length);
  if (!values) {
    return {
      ok: false,
      message: "The embedding service returned an unexpected batch response shape.",
      diagnostic: {
        httpStatus: response.status,
        category: body == null ? "empty_response" : "unexpected_shape",
        geminiStatus: null,
        geminiCode: null,
        inputChars,
        retryable: false,
        retryAfterMs: null,
      },
    };
  }

  return {
    ok: true,
    embeddings: values,
    dimensions: GEMINI_EMBEDDING_DIMENSIONS,
    model: GEMINI_EMBEDDING_MODEL,
  };
}

/**
 * Server function: embed text with Gemini. Reads GEMINI_API_KEY from process.env only.
 * Return value never includes the API key or raw provider error payloads.
 */
export const embedText = createServerFn({ method: "POST" })
  .validator((data: unknown) => embedTextInputSchema.parse(data))
  .handler(async ({ data }): Promise<EmbedTextResult> => {
    const apiKey = process.env[GEMINI_SERVER_ENV.apiKey]?.trim();
    if (!apiKey) {
      return { ok: false, message: "Embedding is not configured on this server yet." };
    }
    return fetchGeminiEmbedding(data.text, apiKey);
  });
