import { z } from "zod";
import { GEMINI_EMBEDDING_DIMENSIONS } from "@/lib/ai/gemini";

/** Stable source label for HireHub Assessment 2 synthetic corpus (not real vacancies). */
export const CORPUS_SOURCE_SYNTHETIC_V1 = "hirehub-synthetic-v1" as const;

export const CORPUS_DISCLAIMER =
  "SYNTHETIC TRAINING DOCUMENT — not a real HireHub vacancy. Do not apply or recommend as a live job." as const;

export const JOB_CORPUS_CATEGORIES = [
  "engineering",
  "data",
  "design",
  "product",
  "marketing",
  "sales",
  "operations",
  "finance",
  "healthcare",
  "education",
  "customer_support",
  "hr",
] as const;

export type JobCorpusCategory = (typeof JOB_CORPUS_CATEGORIES)[number];

export const corpusRecordSchema = z.object({
  corpus_key: z.string().trim().min(3).max(120),
  title: z.string().trim().min(3).max(200),
  location: z.string().trim().min(2).max(120),
  category: z.enum(JOB_CORPUS_CATEGORIES),
  skills_text: z.string().trim().min(2).max(2000),
  description: z.string().trim().min(20).max(8000),
  source: z.string().trim().min(3).max(120).default(CORPUS_SOURCE_SYNTHETIC_V1),
  is_synthetic: z.boolean().default(true),
});

export type CorpusRecordInput = z.infer<typeof corpusRecordSchema>;

export type JobCorpusRow = {
  id: string;
  corpus_key: string | null;
  job_id: string | null;
  title: string | null;
  content: string;
  location: string | null;
  category: string | null;
  skills_text: string | null;
  source: string | null;
  is_synthetic: boolean;
  embedding: number[] | string | null;
  created_at?: string;
  updated_at?: string;
};

/** Build the text blob stored in job_corpus.content and embedded. */
export function buildCorpusContent(record: CorpusRecordInput): string {
  const parsed = corpusRecordSchema.parse(record);
  return [
    CORPUS_DISCLAIMER,
    `Title: ${parsed.title}`,
    `Category: ${parsed.category}`,
    `Location: ${parsed.location}`,
    `Skills: ${parsed.skills_text}`,
    `Source: ${parsed.source}`,
    "",
    parsed.description,
  ].join("\n");
}

export function corpusKeyForIndex(index: number, version = "v1"): string {
  return `synthetic:${version}:${String(index).padStart(5, "0")}`;
}

/** True when a stored embedding looks like a usable 768-dim vector. */
export function hasValidEmbedding(value: unknown): boolean {
  if (Array.isArray(value)) {
    return (
      value.length === GEMINI_EMBEDDING_DIMENSIONS &&
      value.every((n) => typeof n === "number" && Number.isFinite(n))
    );
  }
  if (typeof value === "string") {
    // PostgREST may return vector as "[0.1,0.2,...]"
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return false;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return hasValidEmbedding(parsed);
    } catch {
      return false;
    }
  }
  return false;
}

export function formatEmbeddingForPgvector(values: number[]): string {
  if (!hasValidEmbedding(values)) {
    throw new Error(`Embedding must be a ${GEMINI_EMBEDDING_DIMENSIONS}-length number array.`);
  }
  return `[${values.join(",")}]`;
}

/** Rows returned by match_job_corpus — never treat as applyable HireHub jobs. */
export type CorpusMatch = {
  id: string;
  corpus_key: string | null;
  title: string | null;
  content: string;
  location: string | null;
  category: string | null;
  skills_text: string | null;
  is_synthetic: boolean;
  source: string | null;
  similarity: number;
};

/** Corpus RAG hits must be synthetic corpus docs — never live HireHub vacancies. */
export function isSafeCorpusMatch(match: Pick<CorpusMatch, "is_synthetic" | "corpus_key">): boolean {
  return match.is_synthetic === true && typeof match.corpus_key === "string" && match.corpus_key.length > 0;
}
