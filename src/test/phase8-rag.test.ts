import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  aggregateRetrievalMetrics,
  hitAtK,
  metricsLookSuspicious,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  scoreAnswerRelevance,
  scoreFaithfulness,
  scoreRetrievalCase,
} from "@/lib/ai/rag-metrics";
import {
  evaluateCorpusSample,
  sliceAppendCorpus,
} from "@/lib/ai/corpus-quality";
import { generateSyntheticJobCorpus } from "@/lib/ai/corpus-generate";
import { corpusKeyForIndex } from "@/lib/ai/corpus";
import { runAgentScenarios } from "@/lib/ai/agents/agent-scenarios";

describe("Phase 8 rag-metrics", () => {
  const relevant = [
    { id: "a", grade: 2 as const },
    { id: "b", grade: 1 as const },
  ];
  const ranked = [{ id: "x" }, { id: "a" }, { id: "b" }];

  it("computes hit / precision / recall / mrr / ndcg", () => {
    expect(hitAtK(ranked, relevant, 2)).toBe(true);
    expect(hitAtK(ranked, relevant, 1)).toBe(false);
    expect(precisionAtK(ranked, relevant, 3)).toBeCloseTo(2 / 3);
    expect(recallAtK(ranked, relevant, 3)).toBe(1);
    expect(reciprocalRank(ranked, relevant)).toBeCloseTo(0.5);
    expect(ndcgAtK(ranked, relevant, 3)).toBeGreaterThan(0);
  });

  it("aggregates case metrics and flags suspicion >90%", () => {
    const c = scoreRetrievalCase({
      id: "t1",
      ranked,
      relevant,
      k: 3,
      categoryHit: true,
    });
    const agg = aggregateRetrievalMetrics([c]);
    expect(agg.caseCount).toBe(1);
    expect(agg.hitRate).toBe(1);
    expect(metricsLookSuspicious(0.95)).toBe(true);
    expect(metricsLookSuspicious(0.7)).toBe(false);
  });

  it("scores faithfulness and answer relevance heuristically", () => {
    const faith = scoreFaithfulness(
      "React and TypeScript are used in the frontend role.",
      ["Title: React Engineer. Skills: React, TypeScript, CSS."],
    );
    expect(faith.score).toBeGreaterThan(0.5);
    const rel = scoreAnswerRelevance("React TypeScript Dhaka", "React jobs in Dhaka need TypeScript.");
    expect(rel.score).toBeGreaterThan(0.5);
  });
});

describe("Phase 8 corpus quality / leakage", () => {
  it("Stage B append sample is disjoint from baseline 5k keys", () => {
    const all = generateSyntheticJobCorpus(5100);
    const sample = sliceAppendCorpus(all, 5000, 5100);
    expect(sample[0]?.corpus_key).toBe(corpusKeyForIndex(5000));
    expect(sample.at(-1)?.corpus_key).toBe(corpusKeyForIndex(5099));
    const report = evaluateCorpusSample(sample, { baselineExclusive: true });
    expect(report.duplicateKeys).toHaveLength(0);
    expect(report.disjointFromBaseline5k).toBe(true);
    expect(report.categoryBalanceOk).toBe(true);
  });

  it("detects duplicate keys", () => {
    const docs = generateSyntheticJobCorpus(10);
    const dup = [...docs, { ...docs[0]! }];
    const report = evaluateCorpusSample(dup, { baselineExclusive: false });
    expect(report.duplicateKeys.length).toBeGreaterThan(0);
    expect(report.ok).toBe(false);
  });
});

describe("Phase 8 frozen eval set artifact", () => {
  it("a3_v1.json exists with independent cases and freeze metadata", () => {
    const p = path.join(process.cwd(), "scripts/rag/eval-sets/a3_v1.json");
    const frozen = JSON.parse(readFileSync(p, "utf8"));
    expect(frozen.id).toBe("a3_v1");
    expect(frozen.frozenAt).toBeTruthy();
    expect(frozen.cases.length).toBeGreaterThanOrEqual(15);
    expect(frozen.cases.some((c: { kind: string }) => c.kind === "no_hit")).toBe(true);
    expect(frozen.cases.some((c: { kind: string }) => c.kind === "paraphrase")).toBe(true);
  });
});

describe("Phase 8 agent scenario harness", () => {
  it("reports task-success across Phase 6–7 / Track 4A scenarios", async () => {
    const report = await runAgentScenarios();
    expect(report.total).toBeGreaterThanOrEqual(7);
    expect(report.failed).toBe(0);
    expect(report.taskSuccessRate).toBe(1);
    expect(report.byAgent).toBeTruthy();
  });
});
