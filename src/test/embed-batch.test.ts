import { describe, expect, it, vi } from "vitest";
import {
  batchEmbedJobCorpus,
  embedTextsWithRetries,
} from "@/lib/ai/corpus-embed";
import {
  buildGeminiBatchEmbedRequestBody,
  extractBatchEmbeddingValues,
  fetchGeminiEmbeddingsBatch,
  GEMINI_BATCH_EMBED_MAX_REQUESTS,
  GEMINI_EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
} from "@/lib/ai/gemini";

function vectorOf(length: number, fill = 0.01): number[] {
  return Array.from({ length }, (_, i) => fill + i * 0.0001);
}

function rateLimitResponse(retryAfter?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (retryAfter != null) headers.set("Retry-After", retryAfter);
  return new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", code: 429 } }), {
    status: 429,
    headers,
  });
}

function batchOkResponse(vectors: number[][]) {
  return Response.json(
    { embeddings: vectors.map((values) => ({ values })) },
    { status: 200 },
  );
}

function makeRow(id: string, content: string, embedding: number[] | null = null) {
  return {
    id,
    content,
    embedding,
    corpus_key: `synthetic:v1:${id}`,
    job_id: null,
    title: "Engineer",
    location: "Dhaka",
    category: "engineering",
    skills_text: "TypeScript",
    source: "hirehub-synthetic-v1",
    is_synthetic: true,
  };
}

describe("buildGeminiBatchEmbedRequestBody / extractBatchEmbeddingValues", () => {
  it("builds ordered requests with model and 768 outputDimensionality", () => {
    const body = buildGeminiBatchEmbedRequestBody(["alpha", "beta"]);
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0]).toMatchObject({
      model: `models/${GEMINI_EMBEDDING_MODEL}`,
      outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
      content: { parts: [{ text: "alpha" }] },
    });
    expect(body.requests[1]?.content.parts[0]?.text).toBe("beta");
  });

  it("rejects length or dimension mismatches", () => {
    const a = vectorOf(768, 0.1);
    const b = vectorOf(768, 0.2);
    expect(extractBatchEmbeddingValues({ embeddings: [{ values: a }, { values: b }] }, 2)).toEqual([
      a,
      b,
    ]);
    expect(extractBatchEmbeddingValues({ embeddings: [{ values: a }] }, 2)).toBeNull();
    expect(
      extractBatchEmbeddingValues({ embeddings: [{ values: vectorOf(16) }, { values: b }] }, 2),
    ).toBeNull();
  });
});

describe("fetchGeminiEmbeddingsBatch ordering", () => {
  it("maps embeddings[] to input order and posts to batchEmbedContents", async () => {
    const v0 = vectorOf(768, 0.11);
    const v1 = vectorOf(768, 0.22);
    const v2 = vectorOf(768, 0.33);
    const fetchMock = vi.fn(async () => batchOkResponse([v0, v1, v2]));

    const result = await fetchGeminiEmbeddingsBatch(
      ["first", "second", "third"],
      "test-key",
      fetchMock,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.embeddings[0]?.[0]).toBeCloseTo(0.11, 5);
      expect(result.embeddings[1]?.[0]).toBeCloseTo(0.22, 5);
      expect(result.embeddings[2]?.[0]).toBeCloseTo(0.33, 5);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(":batchEmbedContents");
    const parsed = JSON.parse(String(init?.body));
    expect(parsed.requests).toHaveLength(3);
    expect(parsed.requests[0].content.parts[0].text).toBe("first");
    expect(parsed.requests[2].content.parts[0].text).toBe("third");
    expect(parsed.requests[0].outputDimensionality).toBe(768);
  });

  it("rejects batches over the Gemini 100-request cap without calling fetch", async () => {
    const texts = Array.from({ length: GEMINI_BATCH_EMBED_MAX_REQUESTS + 1 }, (_, i) => `t${i}`);
    const fetchMock = vi.fn();
    const result = await fetchGeminiEmbeddingsBatch(texts, "test-key", fetchMock);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic?.category).toBe("validation");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("embedTextsWithRetries", () => {
  it("retries 429 then recovers with ordered embeddings", async () => {
    const vectors = [vectorOf(768, 0.4), vectorOf(768, 0.5)];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rateLimitResponse("1"))
      .mockResolvedValueOnce(batchOkResponse(vectors));

    const result = await embedTextsWithRetries(["a", "b"], "test-key", {
      fetchImpl: fetchMock,
      maxAttempts: 4,
      sleep: async () => {},
      random: () => 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(2);
      expect(result.embeddings).toHaveLength(2);
      expect(result.embeddings[0]?.[0]).toBeCloseTo(0.4, 5);
      expect(result.embeddings[1]?.[0]).toBeCloseTo(0.5, 5);
    }
  });

  it("stops after retry exhaustion on persistent 429", async () => {
    const fetchMock = vi.fn(async () => rateLimitResponse());
    const result = await embedTextsWithRetries(["a", "b"], "test-key", {
      fetchImpl: fetchMock,
      maxAttempts: 3,
      sleep: async () => {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(3);
      expect(result.diagnostic?.category).toBe("rate_limit");
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("batchEmbedJobCorpus with batch API", () => {
  it("writes embeddings to the matching row ids in request order", async () => {
    const vA = vectorOf(768, 0.01);
    const vB = vectorOf(768, 0.02);
    const vC = vectorOf(768, 0.03);
    const fetchMock = vi.fn(async () => batchOkResponse([vA, vB, vC]));
    const updates: Array<{ id: string; first: number }> = [];

    const client = {
      from: () => ({
        select: () => ({
          is: () => ({
            range: async () => ({
              data: [
                makeRow("a", "Content A"),
                makeRow("b", "Content B"),
                makeRow("c", "Content C"),
              ],
              error: null,
            }),
          }),
          not: () => ({ range: async () => ({ data: [], error: null }) }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: async (_column: string, id: string) => {
            const raw = String(payload.embedding);
            const parsed = JSON.parse(raw) as number[];
            updates.push({ id, first: parsed[0]! });
            return { error: null };
          },
        }),
      }),
    };

    const result = await batchEmbedJobCorpus(client, {
      apiKey: "secret-key",
      fetchImpl: fetchMock,
      batchSize: 5,
      concurrency: 1,
      pauseMs: 0,
      sleep: async () => {},
    });

    expect(result.embedded).toBe(3);
    expect(result.failed).toBe(0);
    expect(updates.map((u) => u.id)).toEqual(["a", "b", "c"]);
    expect(updates[0]?.first).toBeCloseTo(0.01, 5);
    expect(updates[1]?.first).toBeCloseTo(0.02, 5);
    expect(updates[2]?.first).toBeCloseTo(0.03, 5);
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("skips already-embedded rows and never overwrites them", async () => {
    const existing = vectorOf(768, 0.99);
    const fresh = vectorOf(768, 0.05);
    const fetchMock = vi.fn(async () => batchOkResponse([fresh]));
    const updates: string[] = [];

    const client = {
      from: () => ({
        select: () => ({
          is: () => ({
            range: async () => ({
              // Query is embedding IS NULL, but also defend in-code filtering.
              data: [makeRow("pending", "Needs embed"), makeRow("done", "Already done", existing)],
              error: null,
            }),
          }),
          not: () => ({ range: async () => ({ data: [], error: null }) }),
        }),
        update: () => ({
          eq: async (_column: string, id: string) => {
            updates.push(id);
            return { error: null };
          },
        }),
      }),
    };

    const result = await batchEmbedJobCorpus(client, {
      apiKey: "k",
      fetchImpl: fetchMock,
      batchSize: 8,
      pauseMs: 0,
      sleep: async () => {},
    });

    expect(result.embedded).toBe(1);
    expect(result.skipped).toBe(1);
    expect(updates).toEqual(["pending"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.requests).toHaveLength(1);
  });

  it("on partial batch shape failure, does not write mismatched rows", async () => {
    // API returns fewer embeddings than requests — refuse to map by guess.
    const fetchMock = vi.fn(async () => batchOkResponse([vectorOf(768, 0.1)]));
    const updates: string[] = [];

    const client = {
      from: () => ({
        select: () => ({
          is: () => ({
            range: async () => ({
              data: [makeRow("a", "A"), makeRow("b", "B")],
              error: null,
            }),
          }),
          not: () => ({ range: async () => ({ data: [], error: null }) }),
        }),
        update: () => ({
          eq: async (_c: string, id: string) => {
            updates.push(id);
            return { error: null };
          },
        }),
      }),
    };

    const result = await batchEmbedJobCorpus(client, {
      apiKey: "k",
      fetchImpl: fetchMock,
      batchSize: 2,
      pauseMs: 0,
      maxAttempts: 1,
      sleep: async () => {},
    });

    // unexpected_shape → single fallback; singles would hit same mock once each.
    // With maxAttempts=1 and batch returning odd shape, fallback uses embedContent path.
    // Our mock always returns batch shape, so singles fail → both failed, no updates from batch path.
    expect(updates.length).toBe(0);
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it("falls back to singles when batch returns permanent invalid_argument", async () => {
    const ok = vectorOf(768, 0.7);
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("batchEmbedContents")) {
        return Response.json(
          { error: { status: "INVALID_ARGUMENT", code: 400 } },
          { status: 400 },
        );
      }
      return Response.json({ embedding: { values: ok } }, { status: 200 });
    });
    const updates: string[] = [];

    const client = {
      from: () => ({
        select: () => ({
          is: () => ({
            range: async () => ({
              data: [makeRow("x", "Row X"), makeRow("y", "Row Y")],
              error: null,
            }),
          }),
          not: () => ({ range: async () => ({ data: [], error: null }) }),
        }),
        update: () => ({
          eq: async (_c: string, id: string) => {
            updates.push(id);
            return { error: null };
          },
        }),
      }),
    };

    const result = await batchEmbedJobCorpus(client, {
      apiKey: "k",
      fetchImpl: fetchMock,
      batchSize: 2,
      pauseMs: 0,
      sleep: async () => {},
    });

    expect(result.embedded).toBe(2);
    expect(result.failed).toBe(0);
    expect(updates.sort()).toEqual(["x", "y"]);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("batchEmbedContents"))).toBe(
      true,
    );
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes(":embedContent"))).toBe(true);
  });

  it("leaves rows pending (no update) after rate-limit exhaustion", async () => {
    const fetchMock = vi.fn(async () => rateLimitResponse());
    const updates: string[] = [];

    const client = {
      from: () => ({
        select: () => ({
          is: () => ({
            range: async () => ({
              data: [makeRow("z", "Pending Z")],
              error: null,
            }),
          }),
          not: () => ({ range: async () => ({ data: [], error: null }) }),
        }),
        update: () => ({
          eq: async (_c: string, id: string) => {
            updates.push(id);
            return { error: null };
          },
        }),
      }),
    };

    const result = await batchEmbedJobCorpus(client, {
      apiKey: "k",
      fetchImpl: fetchMock,
      batchSize: 5,
      maxAttempts: 2,
      pauseMs: 0,
      sleep: async () => {},
    });

    expect(result.embedded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures[0]?.diagnostic?.category).toBe("rate_limit");
    expect(updates).toHaveLength(0);
  });
});
