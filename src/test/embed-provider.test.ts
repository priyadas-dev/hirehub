import { describe, expect, it, vi } from "vitest";
import {
  embedText,
  embedTexts,
  resolveEmbeddingProvider,
} from "@/lib/ai/embed-provider";
import { LOCAL_EMBEDDING_MODEL } from "@/lib/ai/local-embed";
import { GTE_EMBEDDING_MODEL } from "@/lib/ai/gte-embed";
import { GEMINI_EMBEDDING_DIMENSIONS, GEMINI_EMBEDDING_MODEL } from "@/lib/ai/gemini";

function vectorOf(length: number, fill = 0.01): number[] {
  return Array.from({ length }, (_, i) => fill + i * 0.0001);
}

describe("resolveEmbeddingProvider", () => {
  it("defaults to gemini and accepts local and gte", () => {
    const prev = process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDING_PROVIDER;
    expect(resolveEmbeddingProvider()).toBe("gemini");
    expect(resolveEmbeddingProvider("local")).toBe("local");
    expect(resolveEmbeddingProvider("gte")).toBe("gte");
    expect(resolveEmbeddingProvider("gte-small")).toBe("gte");
    expect(resolveEmbeddingProvider("GEMINI")).toBe("gemini");
    process.env.EMBEDDING_PROVIDER = "local";
    expect(resolveEmbeddingProvider()).toBe("local");
    process.env.EMBEDDING_PROVIDER = "gte";
    expect(resolveEmbeddingProvider()).toBe("gte");
    if (prev === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = prev;
  });

  it("rejects unknown providers", () => {
    expect(() => resolveEmbeddingProvider("openai")).toThrow(/Invalid EMBEDDING_PROVIDER/);
  });
});

describe("embedTexts / embedText with inject", () => {
  it("returns ordered 768-dim vectors for local provider via inject", async () => {
    const a = vectorOf(GEMINI_EMBEDDING_DIMENSIONS, 0.1);
    const b = vectorOf(GEMINI_EMBEDDING_DIMENSIONS, 0.2);
    const impl = vi.fn(async (texts: string[]) => {
      expect(texts).toEqual(["one", "two"]);
      return [a, b];
    });

    const result = await embedTexts(["one", "two"], {
      provider: "local",
      embedTextsImpl: impl,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("local");
      expect(result.model).toBe(LOCAL_EMBEDDING_MODEL);
      expect(result.embeddings).toHaveLength(2);
      expect(result.embeddings[0]).toHaveLength(768);
      expect(result.embeddings[0]?.[0]).toBeCloseTo(0.1, 5);
      expect(result.embeddings[1]?.[0]).toBeCloseTo(0.2, 5);
    }
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("embedText wraps single vector and labels gemini model", async () => {
    const v = vectorOf(768, 0.5);
    const result = await embedText("hello", {
      provider: "gemini",
      embedTextsImpl: async () => [v],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("gemini");
      expect(result.model).toBe(GEMINI_EMBEDDING_MODEL);
      expect(result.embedding).toHaveLength(768);
    }
  });

  it("fails closed when inject returns mismatched count", async () => {
    const result = await embedTexts(["a", "b"], {
      provider: "local",
      embedTextsImpl: async () => [vectorOf(768)],
    });
    expect(result.ok).toBe(false);
  });

  it("labels gte provider with Xenova/gte-small and accepts 384-dim inject", async () => {
    const v = vectorOf(384, 0.11);
    const result = await embedText("skills query", {
      provider: "gte",
      embedTextsImpl: async () => [v],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("gte");
      expect(result.model).toBe(GTE_EMBEDDING_MODEL);
      expect(result.embedding).toHaveLength(384);
    }
  });
});
