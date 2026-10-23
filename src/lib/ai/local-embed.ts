/**
 * Free local 768-dim embeddings via @xenova/transformers (CPU).
 * Used when EMBEDDING_PROVIDER=local so corpus embed + query retrieve share one space.
 * Lazy-loaded — do not import from browser routes.
 */

import { GEMINI_EMBEDDING_DIMENSIONS } from "@/lib/ai/gemini";

/** Fixed Xenova mirror of sentence-transformers/all-mpnet-base-v2 (768-dim). */
export const LOCAL_EMBEDDING_MODEL = "Xenova/all-mpnet-base-v2" as const;

/** Must match job_corpus.embedding / match_job_corpus (same as Gemini Matryoshka 768). */
export const LOCAL_EMBEDDING_DIMENSIONS = GEMINI_EMBEDDING_DIMENSIONS;

type FeatureExtractionPipeline = (
  text: string,
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array | number[]; dims?: number[] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getFeatureExtractor(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      // Prefer WASM so install works without native sharp/onnxruntime-node builds (Windows CI/laptops).
      env.allowLocalModels = true;
      env.backends.onnx.wasm.numThreads = 1;
      return (await pipeline("feature-extraction", LOCAL_EMBEDDING_MODEL)) as FeatureExtractionPipeline;
    })();
  }
  return pipelinePromise;
}

/** Test seam: replace the pipeline without downloading weights. */
export function setLocalEmbedPipelineForTests(
  factory: (() => Promise<FeatureExtractionPipeline>) | null,
): void {
  pipelinePromise = factory ? factory() : null;
}

function toFiniteVector(data: Float32Array | number[]): number[] {
  const values = Array.from(data, (n) => Number(n));
  if (
    values.length !== LOCAL_EMBEDDING_DIMENSIONS ||
    values.some((n) => !Number.isFinite(n))
  ) {
    throw new Error(
      `Local embedder returned ${values.length} dims; expected ${LOCAL_EMBEDDING_DIMENSIONS}.`,
    );
  }
  return values;
}

/**
 * Embed texts with the local 768-dim model (mean pool + L2 normalize).
 * Processes sequentially to keep peak memory predictable on laptops.
 */
export async function embedTextsLocal(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const extractor = await getFeatureExtractor();
  const out: number[][] = [];
  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Cannot embed empty text with the local provider.");
    }
    const tensor = await extractor(trimmed, { pooling: "mean", normalize: true });
    out.push(toFiniteVector(tensor.data));
  }
  return out;
}

export async function embedTextLocal(text: string): Promise<number[]> {
  const [embedding] = await embedTextsLocal([text]);
  if (!embedding) throw new Error("Local embedder returned no vector.");
  return embedding;
}
