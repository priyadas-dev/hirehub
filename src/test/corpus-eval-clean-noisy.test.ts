import { describe, expect, it } from "vitest";
import {
  EVAL_QUERY_BANK,
  formatCleanVsNoisyMarkdown,
  listCleanNoisyPairs,
  summarizeCleanVsNoisy,
} from "@/lib/ai/corpus-eval";

describe("clean vs noisy eval helpers", () => {
  it("defines at least twelve clean/noisy pairs in the bank", () => {
    const pairs = listCleanNoisyPairs();
    expect(pairs.length).toBeGreaterThanOrEqual(12);
    for (const p of pairs) {
      const clean = EVAL_QUERY_BANK.find((q) => q.id === p.cleanQueryId);
      const noisy = EVAL_QUERY_BANK.find((q) => q.id === p.noisyQueryId);
      expect(clean?.pairRole).toBe("clean");
      expect(noisy?.pairRole).toBe("noisy");
      expect(clean?.kind).toBe("matching");
      expect(noisy?.kind).toBe("noisy");
    }
  });

  it("summarizes with-vs-without-noise metrics from case results", () => {
    const pairs = listCleanNoisyPairs();
    const cases = pairs.flatMap((p) => [
      {
        id: p.cleanQueryId,
        ok: true,
        categoryHit: true,
        topSimilarity: 0.9,
        resultCount: 5,
      },
      {
        id: p.noisyQueryId,
        ok: true,
        categoryHit: false,
        topSimilarity: 0.7,
        resultCount: 5,
      },
    ]);
    const report = summarizeCleanVsNoisy(cases);
    expect(report.pairCount).toBe(pairs.length);
    expect(report.cleanCategoryHitRate).toBe(1);
    expect(report.noisyCategoryHitRate).toBe(0);
    expect(report.avgSimilarityDeltaCleanMinusNoisy).toBeCloseTo(0.2);
    expect(report.pairs.every((p) => p.cleanHitNoisyMiss)).toBe(true);
    const md = formatCleanVsNoisyMarkdown(report);
    expect(md).toMatch(/Clean \(without noise\)/);
    expect(md).toMatch(/Noisy \(with typos\)/);
  });
});
