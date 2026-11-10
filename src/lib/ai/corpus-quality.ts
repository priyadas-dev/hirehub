/**
 * Phase 8 Stages B–C — sample quality / leakage checks on generated corpus docs.
 * Offline-safe; does not touch the database.
 */

import type { GeneratedCorpusDoc } from "@/lib/ai/corpus-generate";
import { JOB_CORPUS_CATEGORIES } from "@/lib/ai/corpus";

export type CorpusQualityReport = {
  docCount: number;
  uniqueKeys: number;
  duplicateKeys: string[];
  categoryCounts: Record<string, number>;
  categoryBalanceOk: boolean;
  exactContentDupes: number;
  nearDupPairsSampled: number;
  sharedBoilerplateRatio: number;
  keyRange: { min: string | null; max: string | null };
  disjointFromBaseline5k: boolean;
  leakageFlags: string[];
  ok: boolean;
};

const BASELINE_KEY_RE = /^synthetic:v1:0[0-4]\d{3}$/;

function normalizeContent(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function jaccardTokens(a: string, b: string): number {
  const ta = new Set(a.split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const tb = new Set(b.split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Evaluate a generated sample for dups, balance, and leakage risk vs baseline key space.
 */
export function evaluateCorpusSample(
  docs: GeneratedCorpusDoc[],
  options?: { baselineExclusive?: boolean; nearDupSamplePairs?: number },
): CorpusQualityReport {
  const baselineExclusive = options?.baselineExclusive ?? true;
  const nearDupSamplePairs = options?.nearDupSamplePairs ?? 200;

  const keyCounts = new Map<string, number>();
  const contentCounts = new Map<string, number>();
  const categoryCounts: Record<string, number> = {};
  for (const cat of JOB_CORPUS_CATEGORIES) categoryCounts[cat] = 0;

  let minKey: string | null = null;
  let maxKey: string | null = null;

  for (const doc of docs) {
    keyCounts.set(doc.corpus_key, (keyCounts.get(doc.corpus_key) ?? 0) + 1);
    const norm = normalizeContent(doc.content);
    contentCounts.set(norm, (contentCounts.get(norm) ?? 0) + 1);
    categoryCounts[doc.category] = (categoryCounts[doc.category] ?? 0) + 1;
    if (minKey == null || doc.corpus_key < minKey) minKey = doc.corpus_key;
    if (maxKey == null || doc.corpus_key > maxKey) maxKey = doc.corpus_key;
  }

  const duplicateKeys = [...keyCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([k]) => k)
    .slice(0, 20);

  const exactContentDupes = [...contentCounts.values()].filter((n) => n > 1).length;

  // Sample adjacent pairs for near-dup (deterministic)
  let nearDupPairsSampled = 0;
  const limit = Math.min(nearDupSamplePairs, Math.max(0, docs.length - 1));
  for (let i = 0; i < limit; i++) {
    const a = normalizeContent(docs[i]!.content);
    const b = normalizeContent(docs[i + 1]!.content);
    if (jaccardTokens(a, b) >= 0.92) nearDupPairsSampled += 1;
  }

  // Shared boilerplate: fraction of docs containing the same long sentence stem
  const stem = "synthetic training document";
  const withStem = docs.filter((d) => d.content.toLowerCase().includes(stem)).length;
  const sharedBoilerplateRatio = docs.length ? withStem / docs.length : 0;

  const counts = JOB_CORPUS_CATEGORIES.map((c) => categoryCounts[c] ?? 0);
  const mean = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
  const categoryBalanceOk =
    docs.length === 0 ||
    counts.every((n) => Math.abs(n - mean) <= Math.max(2, mean * 0.35));

  const leakageFlags: string[] = [];
  if (duplicateKeys.length) leakageFlags.push("duplicate_corpus_keys");
  if (exactContentDupes > 0) leakageFlags.push("exact_content_duplicates");
  if (nearDupPairsSampled > limit * 0.5 && limit > 0) {
    leakageFlags.push("high_adjacent_near_dup_rate");
  }

  let disjointFromBaseline5k = true;
  if (baselineExclusive) {
    // Append sample should use keys outside 00000–04999
    const overlapsBaseline = docs.some((d) => BASELINE_KEY_RE.test(d.corpus_key));
    if (overlapsBaseline && docs.every((d) => BASELINE_KEY_RE.test(d.corpus_key))) {
      // Entire sample is baseline range — ok for Stage A regen check, flag for Stage B append
      disjointFromBaseline5k = false;
      leakageFlags.push("sample_keys_overlap_baseline_5k");
    } else if (overlapsBaseline) {
      disjointFromBaseline5k = false;
      leakageFlags.push("partial_key_overlap_baseline_5k");
    }
  }

  const ok =
    duplicateKeys.length === 0 &&
    categoryBalanceOk &&
    !leakageFlags.includes("high_adjacent_near_dup_rate");

  return {
    docCount: docs.length,
    uniqueKeys: keyCounts.size,
    duplicateKeys,
    categoryCounts,
    categoryBalanceOk,
    exactContentDupes,
    nearDupPairsSampled,
    sharedBoilerplateRatio,
    keyRange: { min: minKey, max: maxKey },
    disjointFromBaseline5k,
    leakageFlags,
    ok,
  };
}

/**
 * Slice append-only docs for Stage B/D/E (new keys only).
 * Indices [start, end) map to corpusKeyForIndex.
 */
export function sliceAppendCorpus(
  allDocs: GeneratedCorpusDoc[],
  startIndex: number,
  endIndexExclusive: number,
): GeneratedCorpusDoc[] {
  return allDocs.slice(startIndex, endIndexExclusive);
}

export function baselineKeySpaceIntact(keys: string[]): boolean {
  const set = new Set(keys);
  for (let i = 0; i < 5000; i++) {
    const key = `synthetic:v1:${String(i).padStart(5, "0")}`;
    if (!set.has(key)) return false;
  }
  return true;
}
