import { describe, expect, it, vi } from "vitest";
import {
  buildCorpusContent,
  CORPUS_DISCLAIMER,
  corpusKeyForIndex,
  hasValidEmbedding,
  isSafeCorpusMatch,
} from "@/lib/ai/corpus";
import { generateSyntheticJobCorpus } from "@/lib/ai/corpus-generate";
import { batchEmbedJobCorpus, shouldSkipEmbedding } from "@/lib/ai/corpus-embed";
import { retrieveCorpusMatches } from "@/lib/ai/corpus-retrieve";
import { isLiveRecommendationSource, recommendApprovedLiveJobs } from "@/lib/ai/live-recommend";
import { EVAL_QUERY_BANK } from "@/lib/ai/corpus-eval";
import { GEMINI_EMBEDDING_DIMENSIONS } from "@/lib/ai/gemini";

function vectorOf(length: number, fill = 0.01): number[] {
  return Array.from({ length }, (_, i) => fill + i * 0.0001);
}

describe("synthetic corpus generator", () => {
  it("builds at least 5000 clearly synthetic documents without claiming real vacancies", () => {
    const docs = generateSyntheticJobCorpus(5000);
    expect(docs).toHaveLength(5000);
    expect(docs[0]?.corpus_key).toBe(corpusKeyForIndex(0));
    expect(docs[4999]?.corpus_key).toBe(corpusKeyForIndex(4999));
    expect(docs.every((d) => d.is_synthetic === true)).toBe(true);
    expect(docs.every((d) => d.content.includes(CORPUS_DISCLAIMER))).toBe(true);
    expect(docs.every((d) => d.content.toLowerCase().includes("synthetic"))).toBe(true);
    const categories = new Set(docs.map((d) => d.category));
    expect(categories.size).toBeGreaterThan(5);
    const locations = new Set(docs.map((d) => d.location));
    expect(locations.size).toBeGreaterThan(5);
  });

  it("builds embeddable content from structured fields", () => {
    const content = buildCorpusContent({
      corpus_key: "synthetic:v1:00001",
      title: "Senior Software Engineer",
      location: "Dhaka",
      category: "engineering",
      skills_text: "TypeScript, React",
      description: "A synthetic engineering role used only for RAG evaluation corpus diversity.",
      source: "hirehub-synthetic-v1",
      is_synthetic: true,
    });
    expect(content).toContain("Title: Senior Software Engineer");
    expect(content).toContain(CORPUS_DISCLAIMER);
  });
});

describe("embedding validity helpers", () => {
  it("accepts 768-dim by default and 384-dim when requested", () => {
    expect(hasValidEmbedding(vectorOf(768))).toBe(true);
    expect(hasValidEmbedding(vectorOf(384))).toBe(false);
    expect(hasValidEmbedding(vectorOf(384), 384)).toBe(true);
    expect(hasValidEmbedding(vectorOf(16))).toBe(false);
    expect(hasValidEmbedding(null)).toBe(false);
    expect(shouldSkipEmbedding({ embedding: vectorOf(768) })).toBe(true);
    expect(shouldSkipEmbedding({ embedding: null })).toBe(false);
    expect(shouldSkipEmbedding({ embedding: null, embedding_gte: vectorOf(384) }, "gte")).toBe(true);
    expect(shouldSkipEmbedding({ embedding: vectorOf(768), embedding_gte: null }, "gte")).toBe(false);
  });
});

describe("batchEmbedJobCorpus", () => {
  it("embeds pending rows, skips valid embeddings, and never returns the API key", async () => {
    const values = vectorOf(GEMINI_EMBEDDING_DIMENSIONS);
    const fetchMock = vi.fn(async () =>
      Response.json({ embeddings: [{ values }] }, { status: 200 }),
    );
    const updates: Array<{ id: string; embedding: string }> = [];

    const client = {
      from: () => ({
        select: () => ({
          is: () => ({
            range: async () => ({
              data: [
                {
                  id: "a",
                  content: "Synthetic engineering role TypeScript React",
                  embedding: null,
                  corpus_key: "synthetic:v1:00000",
                  job_id: null,
                  title: "Engineer",
                  location: "Dhaka",
                  category: "engineering",
                  skills_text: "TypeScript",
                  source: "hirehub-synthetic-v1",
                  is_synthetic: true,
                },
                {
                  id: "b",
                  content: "Already embedded",
                  embedding: values,
                  corpus_key: "synthetic:v1:00001",
                  job_id: null,
                  title: "Engineer",
                  location: "Dhaka",
                  category: "engineering",
                  skills_text: "TypeScript",
                  source: "hirehub-synthetic-v1",
                  is_synthetic: true,
                },
              ],
              error: null,
            }),
          }),
          not: () => ({
            range: async () => ({ data: [], error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: async (column: string, id: string) => {
            expect(column).toBe("id");
            updates.push({ id, embedding: String(payload.embedding) });
            return { error: null };
          },
        }),
      }),
    };

    const result = await batchEmbedJobCorpus(client, {
      apiKey: "secret-gemini-key",
      fetchImpl: fetchMock,
      concurrency: 1,
      batchSize: 8,
      pauseMs: 0,
      sleep: async () => {},
    });

    // Pending select returns both; valid embedding is filtered before work.
    expect(result.embedded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.id).toBe("a");
    expect(JSON.stringify(result)).not.toContain("secret-gemini-key");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(":batchEmbedContents");
  });
});

describe("retrieveCorpusMatches", () => {
  it("returns only safe synthetic corpus matches and never leaks the API key", async () => {
    const values = vectorOf(GEMINI_EMBEDDING_DIMENSIONS);
    const fetchMock = vi.fn(async () => Response.json({ embedding: { values } }, { status: 200 }));
    const client = {
      rpc: async () => ({
        data: [
          {
            id: "1",
            corpus_key: "synthetic:v1:00010",
            title: "Frontend Developer",
            content: CORPUS_DISCLAIMER,
            location: "Dhaka",
            category: "engineering",
            skills_text: "React",
            is_synthetic: true,
            source: "hirehub-synthetic-v1",
            similarity: 0.82,
          },
          {
            id: "2",
            corpus_key: null,
            title: "Should be filtered",
            content: "nope",
            location: null,
            category: null,
            skills_text: null,
            is_synthetic: false,
            source: null,
            similarity: 0.99,
          },
        ],
        error: null,
      }),
    };

    const result = await retrieveCorpusMatches(
      client,
      { query: "React developer Dhaka", matchCount: 5 },
      { apiKey: "secret-gemini-key", fetchImpl: fetchMock },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches).toHaveLength(1);
      expect(result.provider).toBe("gemini");
      expect(isSafeCorpusMatch(result.matches[0]!)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret-gemini-key");
    }
  });

  it("embeds queries with the local provider inject so corpus + query share one space", async () => {
    const values = vectorOf(GEMINI_EMBEDDING_DIMENSIONS, 0.33);
    const client = {
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        expect(args.query_embedding).toEqual(values);
        return {
          data: [
            {
              id: "1",
              corpus_key: "synthetic:v1:00010",
              title: "Frontend Developer",
              content: CORPUS_DISCLAIMER,
              location: "Dhaka",
              category: "engineering",
              skills_text: "React",
              is_synthetic: true,
              source: "hirehub-synthetic-v1",
              similarity: 0.9,
            },
          ],
          error: null,
        };
      },
    };

    const result = await retrieveCorpusMatches(
      client,
      { query: "React developer", matchCount: 3 },
      {
        provider: "local",
        embedTextsImpl: async (texts) => {
          expect(texts).toEqual(["React developer"]);
          return [values];
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("local");
      expect(result.matches).toHaveLength(1);
    }
  });
});

describe("retrieveCorpusMatches gte provider", () => {
  it("calls match_job_corpus_gte with a 384-dim query embedding", async () => {
    const values = vectorOf(384, 0.44);
    let rpcName = "";
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcName = fn;
        expect(args.query_embedding).toEqual(values);
        expect((args.query_embedding as number[]).length).toBe(384);
        return {
          data: [
            {
              id: "1",
              corpus_key: "synthetic:v1:00010",
              title: "Frontend Developer",
              content: CORPUS_DISCLAIMER,
              location: "Dhaka",
              category: "engineering",
              skills_text: "React",
              is_synthetic: true,
              source: "hirehub-synthetic-v1",
              similarity: 0.91,
            },
          ],
          error: null,
        };
      },
    };

    const result = await retrieveCorpusMatches(
      client,
      { query: "React developer", matchCount: 3 },
      {
        provider: "gte",
        embedTextsImpl: async () => [values],
      },
    );

    expect(rpcName).toBe("match_job_corpus_gte");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("gte");
      expect(result.matches).toHaveLength(1);
    }
  });
});

describe("batchEmbedJobCorpus local provider", () => {
  it("writes ordered local embeddings without calling Gemini", async () => {
    const vA = vectorOf(768, 0.01);
    const vB = vectorOf(768, 0.02);
    const updates: Array<{ id: string; first: number }> = [];
    const client = {
      from: () => ({
        select: () => ({
          is: () => ({
            range: async () => ({
              data: [
                {
                  id: "a",
                  content: "Local A",
                  embedding: null,
                  corpus_key: "synthetic:v1:00000",
                  job_id: null,
                  title: "A",
                  location: "Dhaka",
                  category: "engineering",
                  skills_text: "TS",
                  source: "hirehub-synthetic-v1",
                  is_synthetic: true,
                },
                {
                  id: "b",
                  content: "Local B",
                  embedding: null,
                  corpus_key: "synthetic:v1:00001",
                  job_id: null,
                  title: "B",
                  location: "Dhaka",
                  category: "engineering",
                  skills_text: "TS",
                  source: "hirehub-synthetic-v1",
                  is_synthetic: true,
                },
              ],
              error: null,
            }),
          }),
          not: () => ({ range: async () => ({ data: [], error: null }) }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: async (_column: string, id: string) => {
            const parsed = JSON.parse(String(payload.embedding)) as number[];
            updates.push({ id, first: parsed[0]! });
            return { error: null };
          },
        }),
      }),
    };

    const result = await batchEmbedJobCorpus(client, {
      provider: "local",
      batchSize: 8,
      pauseMs: 0,
      embedTextsImpl: async (texts) => {
        expect(texts).toEqual(["Local A", "Local B"]);
        return [vA, vB];
      },
    });

    expect(result.provider).toBe("local");
    expect(result.embedded).toBe(2);
    expect(result.failed).toBe(0);
    expect(updates.map((u) => u.id)).toEqual(["a", "b"]);
    expect(updates[0]?.first).toBeCloseTo(0.01, 5);
    expect(updates[1]?.first).toBeCloseTo(0.02, 5);
  });
});

describe("batchEmbedJobCorpus gte provider", () => {
  it("writes embedding_gte (384) only and never touches embedding", async () => {
    const vA = vectorOf(384, 0.03);
    const updates: Array<Record<string, unknown>> = [];
    const client = {
      from: () => ({
        select: () => ({
          is: (column: string, value: null) => {
            expect(column).toBe("embedding_gte");
            expect(value).toBeNull();
            return {
              range: async () => ({
                data: [
                  {
                    id: "g1",
                    content: "Gte A",
                    embedding: vectorOf(768, 0.9),
                    embedding_gte: null,
                    corpus_key: "synthetic:v1:00000",
                    job_id: null,
                    title: "A",
                    location: "Dhaka",
                    category: "engineering",
                    skills_text: "TS",
                    source: "hirehub-synthetic-v1",
                    is_synthetic: true,
                  },
                ],
                error: null,
              }),
            };
          },
          not: () => ({ range: async () => ({ data: [], error: null }) }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: async (_column: string, id: string) => {
            updates.push({ id, ...payload });
            return { error: null };
          },
        }),
      }),
    };

    const result = await batchEmbedJobCorpus(client, {
      provider: "gte",
      batchSize: 8,
      pauseMs: 0,
      embedTextsImpl: async (texts) => {
        expect(texts).toEqual(["Gte A"]);
        return [vA];
      },
    });

    expect(result.provider).toBe("gte");
    expect(result.embedded).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.id).toBe("g1");
    expect(updates[0]?.embedding).toBeUndefined();
    const parsed = JSON.parse(String(updates[0]?.embedding_gte)) as number[];
    expect(parsed).toHaveLength(384);
    expect(parsed[0]).toBeCloseTo(0.03, 5);
  });
});

describe("live recommendations stay separate from corpus RAG", () => {
  it("queries only approved live jobs and labels the source correctly", async () => {
    const calls: string[] = [];
    const client = {
      from: (table: "jobs") => {
        calls.push(table);
        const builder = {
          select: () => builder,
          eq: (column: string, value: string) => {
            expect(column).toBe("status");
            expect(value).toBe("approved");
            return builder;
          },
          ilike: () => builder,
          order: () => builder,
          limit: async () => ({
            data: [
              {
                id: "live-1",
                title: "Approved HireHub Role",
                description: "Real vacancy",
                location: "Dhaka",
                status: "approved",
                company_id: "co-1",
                created_at: "2026-01-01T00:00:00Z",
              },
              {
                id: "live-2",
                title: "Should filter",
                description: null,
                location: null,
                status: "pending",
                company_id: "co-1",
                created_at: "2026-01-02T00:00:00Z",
              },
            ],
            error: null,
          }),
        };
        return builder;
      },
    };

    const result = await recommendApprovedLiveJobs(client, { limit: 10 });
    expect(calls).toEqual(["jobs"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("live_jobs_approved");
      expect(isLiveRecommendationSource(result.source)).toBe(true);
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0]?.id).toBe("live-1");
    }
  });
});

describe("evaluation bank", () => {
  it("covers matching, noisy, and edge queries", () => {
    const kinds = new Set(EVAL_QUERY_BANK.map((q) => q.kind));
    expect(kinds.has("matching")).toBe(true);
    expect(kinds.has("noisy")).toBe(true);
    expect(kinds.has("edge")).toBe(true);
    expect(EVAL_QUERY_BANK.length).toBeGreaterThanOrEqual(8);
  });
});
