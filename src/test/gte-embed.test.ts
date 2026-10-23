import { describe, expect, it, vi } from "vitest";
import {
  GTE_EMBEDDING_DIMENSIONS,
  GTE_EMBEDDING_MODEL,
  embedTextsGte,
  setGteEmbedPipelineForTests,
} from "@/lib/ai/gte-embed";
import {
  embeddingDimensions,
  embeddingStorageColumn,
  matchCorpusRpcName,
  usesGte384Space,
  usesLegacy768Space,
} from "@/lib/ai/embed-space";
import { resolveEmbeddingProvider } from "@/lib/ai/embed-provider";
import {
  formatEmbeddingForPgvector,
  hasValidEmbedding,
  hasValidGteEmbedding,
} from "@/lib/ai/corpus";

function vectorOf(length: number, fill = 0.01): number[] {
  return Array.from({ length }, (_, i) => fill + i * 0.0001);
}

/** Unit-normalized vector for gte pipeline mocks (passes L2 check). */
function unitVectorOf(length: number): number[] {
  const raw = vectorOf(length, 0.2);
  let sumSq = 0;
  for (const n of raw) sumSq += n * n;
  const norm = Math.sqrt(sumSq);
  return raw.map((n) => n / norm);
}

describe("gte-small constants and space mapping", () => {
  it("uses Xenova/gte-small at 384 dims in an isolated storage space", () => {
    expect(GTE_EMBEDDING_MODEL).toBe("Xenova/gte-small");
    expect(GTE_EMBEDDING_DIMENSIONS).toBe(384);
    expect(resolveEmbeddingProvider("gte")).toBe("gte");
    expect(resolveEmbeddingProvider("gte-small")).toBe("gte");
    expect(embeddingDimensions("gte")).toBe(384);
    expect(embeddingStorageColumn("gte")).toBe("embedding_gte");
    expect(matchCorpusRpcName("gte")).toBe("match_job_corpus_gte");
    expect(usesGte384Space("gte")).toBe(true);
    expect(usesLegacy768Space("gte")).toBe(false);
    expect(usesLegacy768Space("local")).toBe(true);
    expect(embeddingStorageColumn("local")).toBe("embedding");
    expect(matchCorpusRpcName("gemini")).toBe("match_job_corpus");
  });

  it("validates 384 vs 768 without allowing cross-dimension acceptance", () => {
    const gte = vectorOf(384);
    const legacy = vectorOf(768);
    expect(hasValidGteEmbedding(gte)).toBe(true);
    expect(hasValidGteEmbedding(legacy)).toBe(false);
    expect(hasValidEmbedding(legacy)).toBe(true);
    expect(hasValidEmbedding(gte)).toBe(false);
    expect(hasValidEmbedding(gte, 384)).toBe(true);
    expect(() => formatEmbeddingForPgvector(gte, 384)).not.toThrow();
    expect(() => formatEmbeddingForPgvector(gte, 768)).toThrow(/768/);
    expect(() => formatEmbeddingForPgvector(legacy, 384)).toThrow(/384/);
  });
});

describe("embedTextsGte", () => {
  it("returns ordered 384-dim finite vectors with mean-pool normalize options", async () => {
    const calls: Array<{ text: string; opts?: { pooling?: string; normalize?: boolean } }> = [];
    setGteEmbedPipelineForTests(async () => {
      return async (text, opts) => {
        calls.push({ text, opts });
        return { data: Float32Array.from(unitVectorOf(384)) };
      };
    });

    try {
      const out = await embedTextsGte(["Hello world", "Second"]);
      expect(out).toHaveLength(2);
      expect(out[0]).toHaveLength(384);
      expect(out[0]?.every((n) => Number.isFinite(n))).toBe(true);
      const sumSq = out[0]!.reduce((acc, n) => acc + n * n, 0);
      expect(Math.sqrt(sumSq)).toBeCloseTo(1, 2);
      expect(calls[0]?.opts).toEqual({ pooling: "mean", normalize: true });
      expect(calls.map((c) => c.text)).toEqual(["Hello world", "Second"]);
    } finally {
      setGteEmbedPipelineForTests(null);
    }
  });

  it("rejects wrong-dimension pipeline output", async () => {
    setGteEmbedPipelineForTests(async () => {
      return async () => ({ data: Float32Array.from(vectorOf(768)) });
    });
    try {
      await expect(embedTextsGte(["x"])).rejects.toThrow(/expected 384/i);
    } finally {
      setGteEmbedPipelineForTests(null);
    }
  });

  it("rejects non-normalized pipeline output", async () => {
    setGteEmbedPipelineForTests(async () => {
      return async () => ({ data: Float32Array.from(vectorOf(384, 0.5)) });
    });
    try {
      await expect(embedTextsGte(["x"])).rejects.toThrow(/L2-normalized/i);
    } finally {
      setGteEmbedPipelineForTests(null);
    }
  });
});
