import type { CorpusMatch } from "@/lib/ai/corpus";

/** Ranked hit from one retrieval channel (dense or FTS). */
export type RankedCorpusHit = CorpusMatch & {
  channel: "vector" | "fts";
  /** Channel-native score (cosine similarity or ts_rank). */
  channelScore: number;
};

export type HybridRerankOptions = {
  query: string;
  limit: number;
  /** RRF constant; classic default is 60. */
  rrfK?: number;
  /** Weight for reciprocal-rank fusion vs lexical overlap (0..1). Default 0.7. */
  rrfWeight?: number;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09FF]+/gi, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** Cheap typo-tolerant token equality (edit distance ≤ 1 for short, ≤ 2 for longer). */
export function tokensFuzzyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 3) return false;
  const allowed = maxLen <= 5 ? 1 : 2;
  if (Math.abs(a.length - b.length) > allowed) return false;
  return editDistance(a, b) <= allowed;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, prevDiag + cost);
      prevDiag = temp;
    }
  }
  return prev[b.length]!;
}

/**
 * Fraction of query tokens that fuzzy-match any doc token (title/skills/category/location/content).
 * Helps typo/noisy queries where pure FTS stems miss.
 */
export function lexicalOverlapScore(query: string, doc: Pick<CorpusMatch, "title" | "skills_text" | "category" | "location" | "content">): number {
  const qTokens = tokenize(query);
  if (!qTokens.length) return 0;
  const docTokens = tokenize(
    [doc.title, doc.skills_text, doc.category, doc.location, doc.content].filter(Boolean).join(" "),
  );
  if (!docTokens.length) return 0;

  let hits = 0;
  for (const qt of qTokens) {
    if (docTokens.some((dt) => tokensFuzzyEqual(qt, dt))) hits += 1;
  }
  return hits / qTokens.length;
}

/**
 * Reciprocal Rank Fusion over one or more ranked id lists.
 * score(id) = Σ 1 / (k + rank_i) across lists where id appears.
 */
export function reciprocalRankFusion(
  rankedIdLists: string[][],
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedIdLists) {
    list.forEach((id, index) => {
      const add = 1 / (k + index + 1);
      scores.set(id, (scores.get(id) ?? 0) + add);
    });
  }
  return scores;
}

function toMatch(hit: RankedCorpusHit, similarity: number): CorpusMatch {
  return {
    id: hit.id,
    corpus_key: hit.corpus_key,
    title: hit.title,
    content: hit.content,
    location: hit.location,
    category: hit.category,
    skills_text: hit.skills_text,
    is_synthetic: hit.is_synthetic,
    source: hit.source,
    similarity,
  };
}

/**
 * Merge dense + FTS candidates with RRF, then blend in lexical overlap for typo resilience.
 * Dedupes by id; returns at most `limit` CorpusMatch rows (similarity = blended score).
 */
export function rerankHybridCandidates(
  vectorHits: CorpusMatch[],
  ftsHits: CorpusMatch[],
  options: HybridRerankOptions,
): CorpusMatch[] {
  const limit = Math.max(1, Math.min(options.limit, 50));
  const rrfK = options.rrfK ?? 60;
  const rrfWeight = Math.min(1, Math.max(0, options.rrfWeight ?? 0.7));

  const byId = new Map<string, RankedCorpusHit>();
  for (const hit of vectorHits) {
    byId.set(hit.id, { ...hit, channel: "vector", channelScore: hit.similarity });
  }
  for (const hit of ftsHits) {
    const prev = byId.get(hit.id);
    if (!prev) {
      byId.set(hit.id, { ...hit, channel: "fts", channelScore: hit.similarity });
      continue;
    }
    // Keep richer content; remember both channels via higher channelScore for ties later.
    byId.set(hit.id, {
      ...prev,
      channelScore: Math.max(prev.channelScore, hit.similarity),
    });
  }

  if (!byId.size) return [];

  const rrf = reciprocalRankFusion(
    [vectorHits.map((h) => h.id), ftsHits.map((h) => h.id)].filter((l) => l.length > 0),
    rrfK,
  );

  const maxRrf = Math.max(...rrf.values(), 1e-9);
  const scored: Array<{ id: string; score: number }> = [];
  for (const [id, hit] of byId) {
    const rrfNorm = (rrf.get(id) ?? 0) / maxRrf;
    const lex = lexicalOverlapScore(options.query, hit);
    const score = rrfWeight * rrfNorm + (1 - rrfWeight) * lex;
    scored.push({ id, score });
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, limit).map(({ id, score }) => toMatch(byId.get(id)!, score));
}
