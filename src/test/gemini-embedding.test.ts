import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGeminiEmbedRequestBody,
  classifyGeminiEmbedError,
  fetchGeminiEmbedding,
  formatEmbedDiagnostic,
  GEMINI_EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_SERVER_ENV,
} from "@/lib/ai/gemini";

function vectorOf(length: number, fill = 0.01): number[] {
  return Array.from({ length }, (_, i) => fill + i * 0.0001);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Gemini embedding model config", () => {
  it("uses gemini-embedding-001 with explicit 768 outputDimensionality", () => {
    expect(GEMINI_EMBEDDING_MODEL).toBe("gemini-embedding-001");
    expect(GEMINI_EMBEDDING_DIMENSIONS).toBe(768);
    expect(GEMINI_EMBEDDING_MODEL).not.toBe("text-embedding-004");

    const body = buildGeminiEmbedRequestBody("React TypeScript");
    expect(body.model).toBe(`models/${GEMINI_EMBEDDING_MODEL}`);
    expect(body.outputDimensionality).toBe(768);
    expect(body.content.parts[0]?.text).toBe("React TypeScript");
  });
});

describe("fetchGeminiEmbedding", () => {
  it("returns a 768-dimensional embedding on success and requests outputDimensionality 768", async () => {
    const values = vectorOf(GEMINI_EMBEDDING_DIMENSIONS);
    const fetchMock = vi.fn(async () =>
      Response.json({ embedding: { values } }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGeminiEmbedding("TypeScript React", "test-gemini-key-secret");

    expect(result).toEqual({
      ok: true,
      embedding: values,
      dimensions: GEMINI_EMBEDDING_DIMENSIONS,
      model: GEMINI_EMBEDDING_MODEL,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`models/${GEMINI_EMBEDDING_MODEL}:embedContent`);
    expect(url).not.toContain("text-embedding-004");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("x-goog-api-key")).toBe("test-gemini-key-secret");
    expect(String(url)).not.toContain("test-gemini-key-secret");

    const sent = JSON.parse(String(init.body)) as {
      outputDimensionality?: number;
      model?: string;
    };
    expect(sent.outputDimensionality).toBe(768);
    expect(sent.model).toBe(`models/${GEMINI_EMBEDDING_MODEL}`);
  });

  it("rejects non-OK HTTP responses without leaking the API key and attaches diagnostics", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { message: "API key invalid: test-gemini-key-secret", status: "UNAUTHENTICATED", code: 401 } },
        { status: 401 },
      ),
    );

    const result = await fetchGeminiEmbedding("hello", "test-gemini-key-secret", fetchMock);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/embedding service returned an error/i);
      expect(JSON.stringify(result)).not.toContain("test-gemini-key-secret");
      expect(result.message).not.toContain("test-gemini-key-secret");
      expect(result.diagnostic).toMatchObject({
        httpStatus: 401,
        category: "auth",
        geminiStatus: "UNAUTHENTICATED",
        geminiCode: 401,
        inputChars: 5,
        retryable: false,
      });
      expect(formatEmbedDiagnostic(result.diagnostic!)).not.toContain("test-gemini-key-secret");
      expect(formatEmbedDiagnostic(result.diagnostic!)).not.toContain("hello");
    }
  });

  it("classifies rate-limit and invalid-argument Gemini errors", () => {
    expect(
      classifyGeminiEmbedError({
        httpStatus: 429,
        body: { error: { status: "RESOURCE_EXHAUSTED", code: 429 } },
        inputChars: 120,
      }),
    ).toMatchObject({ category: "rate_limit", retryable: true, httpStatus: 429 });

    expect(
      classifyGeminiEmbedError({
        httpStatus: 400,
        body: { error: { status: "INVALID_ARGUMENT", code: 400 } },
        inputChars: 9000,
      }),
    ).toMatchObject({ category: "invalid_argument", retryable: false, httpStatus: 400 });
  });

  it("rejects invalid response shapes", async () => {
    const fetchMock = vi.fn(async () => Response.json({ embedding: { values: "nope" } }, { status: 200 }));

    const result = await fetchGeminiEmbedding("hello", "test-gemini-key-secret", fetchMock);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("The embedding service returned an unexpected response shape.");
      expect(result.diagnostic?.category).toBe("unexpected_shape");
      expect(result.diagnostic?.httpStatus).toBe(200);
    }
  });

  it("rejects wrong embedding dimensions including default 3072 without truncation", async () => {
    const wrongDefault = await fetchGeminiEmbedding(
      "hello",
      "test-gemini-key-secret",
      vi.fn(async () => Response.json({ embedding: { values: vectorOf(3072) } }, { status: 200 })),
    );
    expect(wrongDefault.ok).toBe(false);
    if (!wrongDefault.ok) {
      expect(wrongDefault.message).toMatch(/768-dimensional/);
      expect(wrongDefault.message).toMatch(/got 3072/);
    }

    const result = await fetchGeminiEmbedding(
      "hello",
      "test-gemini-key-secret",
      vi.fn(async () => Response.json({ embedding: { values: vectorOf(16) } }, { status: 200 })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/768-dimensional/);
      expect(result.message).toMatch(/got 16/);
    }
  });

  it("never includes the API key in successful returned data", async () => {
    const secret = "super-secret-gemini-key-do-not-leak";
    const values = vectorOf(GEMINI_EMBEDDING_DIMENSIONS);
    const fetchMock = vi.fn(async () => Response.json({ embedding: { values } }, { status: 200 }));

    const result = await fetchGeminiEmbedding("skills: sql", secret, fetchMock);

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(GEMINI_SERVER_ENV.apiKey);
    if (result.ok) {
      expect(result).not.toHaveProperty("apiKey");
      expect(Object.keys(result).sort()).toEqual(["dimensions", "embedding", "model", "ok"]);
    }
  });

  it("returns a clear error when the API key is empty", async () => {
    const result = await fetchGeminiEmbedding("hello", "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Embedding is not configured on this server yet.");
      expect(result.diagnostic?.category).toBe("validation");
      expect(result.diagnostic?.retryable).toBe(false);
    }
  });

  it("handles network failures gracefully", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await fetchGeminiEmbedding("hello", "test-gemini-key-secret", fetchMock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("The embedding service could not be reached. Try again shortly.");
      expect(result.diagnostic?.category).toBe("network");
      expect(result.diagnostic?.retryable).toBe(true);
    }
    expect(JSON.stringify(result)).not.toContain("test-gemini-key-secret");
  });
});
