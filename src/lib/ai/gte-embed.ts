/**
 * Local 384-dim embeddings via @xenova/transformers + Xenova/gte-small (CPU/WASM).
 * Used when EMBEDDING_PROVIDER=gte. Writes/reads job_corpus.embedding_gte only.
 * Lazy-loaded — do not import from browser routes.
 */

/** Xenova ONNX mirror of thenlper/gte-small (384-dim). */
export const GTE_EMBEDDING_MODEL = "Xenova/gte-small" as const;

/** Must match job_corpus.embedding_gte / match_job_corpus_gte (PROPOSED_0011). */
export const GTE_EMBEDDING_DIMENSIONS = 384 as const;

type FeatureExtractionPipeline = (
  text: string,
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array | number[]; dims?: number[] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getFeatureExtractor(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      env.allowLocalModels = true;
      env.backends.onnx.wasm.numThreads = 1;
      return (await pipeline("feature-extraction", GTE_EMBEDDING_MODEL)) as FeatureExtractionPipeline;
    })();
  }
  return pipelinePromise;
}

/** Test seam: replace the pipeline without downloading weights. */
export function setGteEmbedPipelineForTests(
  factory: (() => Promise<FeatureExtractionPipeline>) | null,
): void {
  pipelinePromise = factory ? factory() : null;
}

function toFiniteGteVector(data: Float32Array | number[]): number[] {
  const values = Array.from(data, (n) => Number(n));
  if (
    values.length !== GTE_EMBEDDING_DIMENSIONS ||
    values.some((n) => !Number.isFinite(n))
  ) {
    throw new Error(
      `gte-small embedder returned ${values.length} dims; expected ${GTE_EMBEDDING_DIMENSIONS}.`,
    );
  }
  // Transformers.js is called with normalize:true — require approx unit L2 norm.
  let sumSq = 0;
  for (const n of values) sumSq += n * n;
  const norm = Math.sqrt(sumSq);
  if (!(norm > 0.98 && norm < 1.02)) {
    throw new Error(
      `gte-small embedding expected L2-normalized (~1.0), got norm=${norm.toFixed(4)}.`,
    );
  }
  return values;
}

/**
 * Embed texts with Xenova/gte-small (mean pool + L2 normalize → 384 floats).
 * Sequential to keep peak memory predictable on office PCs.
 */
export async function embedTextsGte(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const extractor = await getFeatureExtractor();
  const out: number[][] = [];
  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Cannot embed empty text with the gte-small provider.");
    }
    const tensor = await extractor(trimmed, { pooling: "mean", normalize: true });
    out.push(toFiniteGteVector(tensor.data));
  }
  return out;
}

export async function embedTextGte(text: string): Promise<number[]> {
  const [embedding] = await embedTextsGte([text]);
  if (!embedding) throw new Error("gte-small embedder returned no vector.");
  return embedding;
}
