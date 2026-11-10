/**
 * Phase 8 RAG metrics — retrieval and answer-quality helpers.
 * Keep families separate: do not mix Hit@k with faithfulness in one score.
 */

export type GradedDoc = {
  /** corpus_key or stable doc id */
  id: string;
  /** Graded relevance: 0 = irrelevant, 1 = partial, 2 = highly relevant */
  grade: 0 | 1 | 2;
};

export type RankedHit = {
  id: string;
  score?: number | null;
};

function relevanceSet(docs: GradedDoc[], minGrade = 1): Set<string> {
  return new Set(docs.filter((d) => d.grade >= minGrade).map((d) => d.id));
}

/** Hit@k: at least one relevant doc in top-k. */
export function hitAtK(ranked: RankedHit[], relevant: GradedDoc[], k: number): boolean {
  const rel = relevanceSet(relevant);
  if (rel.size === 0) return false;
  return ranked.slice(0, k).some((h) => rel.has(h.id));
}

/** Precision@k: relevant ∩ top-k / k (binary relevance ≥1). */
export function precisionAtK(ranked: RankedHit[], relevant: GradedDoc[], k: number): number {
  if (k <= 0) return 0;
  const rel = relevanceSet(relevant);
  const top = ranked.slice(0, k);
  if (top.length === 0) return 0;
  const hits = top.filter((h) => rel.has(h.id)).length;
  return hits / k;
}

/** Recall@k: relevant ∩ top-k / |relevant|. */
export function recallAtK(ranked: RankedHit[], relevant: GradedDoc[], k: number): number {
  const rel = relevanceSet(relevant);
  if (rel.size === 0) return 0;
  const hits = ranked.slice(0, k).filter((h) => rel.has(h.id)).length;
  return hits / rel.size;
}

/** Mean Reciprocal Rank (binary relevance). */
export function reciprocalRank(ranked: RankedHit[], relevant: GradedDoc[]): number {
  const rel = relevanceSet(relevant);
  if (rel.size === 0) return 0;
  const idx = ranked.findIndex((h) => rel.has(h.id));
  if (idx < 0) return 0;
  return 1 / (idx + 1);
}

/**
 * nDCG@k with graded relevance (0/1/2).
 * Ideal DCG uses grades sorted descending.
 */
export function ndcgAtK(ranked: RankedHit[], relevant: GradedDoc[], k: number): number {
  if (k <= 0) return 0;
  const gradeById = new Map(relevant.map((d) => [d.id, d.grade]));
  const gains = ranked.slice(0, k).map((h, i) => {
    const g = gradeById.get(h.id) ?? 0;
    return ((2 ** g) - 1) / Math.log2(i + 2);
  });
  const dcg = gains.reduce((a, b) => a + b, 0);

  const idealGrades = [...relevant]
    .map((d) => d.grade)
    .filter((g) => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k);
  const idcg = idealGrades.reduce((sum, g, i) => sum + ((2 ** g) - 1) / Math.log2(i + 2), 0);
  if (idcg <= 0) return 0;
  return dcg / idcg;
}

export type RetrievalCaseMetric = {
  id: string;
  hitAtK: boolean;
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
  /** Legacy comparator only — category among top-k categories. */
  categoryHit?: boolean | null;
};

export function scoreRetrievalCase(input: {
  id: string;
  ranked: RankedHit[];
  relevant: GradedDoc[];
  k: number;
  categoryHit?: boolean | null;
}): RetrievalCaseMetric {
  const { id, ranked, relevant, k, categoryHit } = input;
  return {
    id,
    hitAtK: hitAtK(ranked, relevant, k),
    precisionAtK: precisionAtK(ranked, relevant, k),
    recallAtK: recallAtK(ranked, relevant, k),
    mrr: reciprocalRank(ranked, relevant),
    ndcgAtK: ndcgAtK(ranked, relevant, k),
    categoryHit: categoryHit ?? null,
  };
}

export function aggregateRetrievalMetrics(cases: RetrievalCaseMetric[]): {
  caseCount: number;
  hitRate: number | null;
  meanPrecisionAtK: number | null;
  meanRecallAtK: number | null;
  meanMrr: number | null;
  meanNdcgAtK: number | null;
  categoryHitRate: number | null;
} {
  if (cases.length === 0) {
    return {
      caseCount: 0,
      hitRate: null,
      meanPrecisionAtK: null,
      meanRecallAtK: null,
      meanMrr: null,
      meanNdcgAtK: null,
      categoryHitRate: null,
    };
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const withCat = cases.filter((c) => c.categoryHit != null);
  return {
    caseCount: cases.length,
    hitRate: mean(cases.map((c) => (c.hitAtK ? 1 : 0))),
    meanPrecisionAtK: mean(cases.map((c) => c.precisionAtK)),
    meanRecallAtK: mean(cases.map((c) => c.recallAtK)),
    meanMrr: mean(cases.map((c) => c.mrr)),
    meanNdcgAtK: mean(cases.map((c) => c.ndcgAtK)),
    categoryHitRate:
      withCat.length === 0
        ? null
        : mean(withCat.map((c) => (c.categoryHit ? 1 : 0))),
  };
}

/**
 * Heuristic faithfulness: claim sentences should share tokens with context.
 * Not a model judge — labelled as heuristic in reports.
 */
const FAITHFULNESS_STOP = new Set([
  "the",
  "and",
  "are",
  "was",
  "were",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "used",
  "using",
  "role",
  "jobs",
  "job",
  "based",
  "also",
  "have",
  "has",
]);

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/i)
    .filter((t) => t.length > 2 && !FAITHFULNESS_STOP.has(t));
}

export function scoreFaithfulness(answer: string, contexts: string[]): {
  score: number;
  supportedClaims: number;
  totalClaims: number;
  method: "token_overlap_heuristic";
} {
  const claims = answer
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  if (claims.length === 0) {
    return { score: 1, supportedClaims: 0, totalClaims: 0, method: "token_overlap_heuristic" };
  }
  const ctxTokens = new Set(contentTokens(contexts.join("\n")));
  let supported = 0;
  for (const claim of claims) {
    const tokens = contentTokens(claim);
    if (tokens.length === 0) continue;
    const overlap = tokens.filter((t) => ctxTokens.has(t)).length;
    if (overlap / tokens.length >= 0.35) supported += 1;
  }
  return {
    score: supported / claims.length,
    supportedClaims: supported,
    totalClaims: claims.length,
    method: "token_overlap_heuristic",
  };
}

/** Answer relevance: query token coverage in the answer. */
export function scoreAnswerRelevance(query: string, answer: string): {
  score: number;
  method: "query_token_coverage";
} {
  const qTokens = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/i)
        .filter((t) => t.length > 2),
    ),
  ];
  if (qTokens.length === 0) return { score: 0, method: "query_token_coverage" };
  const a = answer.toLowerCase();
  const hit = qTokens.filter((t) => a.includes(t)).length;
  return { score: hit / qTokens.length, method: "query_token_coverage" };
}

/** Suspicion protocol helper for Phase 8 reports. */
export function metricsLookSuspicious(primaryRate: number | null | undefined): boolean {
  if (primaryRate == null || Number.isNaN(primaryRate)) return false;
  return primaryRate > 0.9;
}
