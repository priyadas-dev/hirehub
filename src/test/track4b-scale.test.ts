import { describe, expect, it } from "vitest";
import path from "node:path";
import { generateSyntheticJobCorpus } from "@/lib/ai/corpus-generate";
import { corpusKeyForIndex } from "@/lib/ai/corpus";
import {
  evaluateCorpusSample,
  sliceAppendCorpus,
} from "@/lib/ai/corpus-quality";
import {
  appendRangeForStage,
  expectedAppendKeys,
  loadFrozenEvalCheckpoints,
  scaleLabelForTarget,
  summarizeCheckpoint,
} from "@/lib/ai/corpus-checkpoint";
import { GTE_EMBEDDING_DIMENSIONS } from "@/lib/ai/gte-embed";

describe("Track 4B corpus scale helpers", () => {
  it("Stage D/E append ranges are disjoint from baseline 5k", () => {
    const d = appendRangeForStage("D");
    const e = appendRangeForStage("E");
    expect(d).toEqual({ start: 5000, end: 10000, target: 10000 });
    expect(e).toEqual({ start: 10000, end: 20000, target: 20000 });

    const docs10k = generateSyntheticJobCorpus(10000);
    const appendD = sliceAppendCorpus(docs10k, d.start, d.end);
    expect(appendD).toHaveLength(5000);
    expect(appendD[0]?.corpus_key).toBe(corpusKeyForIndex(5000));
    expect(appendD.at(-1)?.corpus_key).toBe(corpusKeyForIndex(9999));

    const qualityD = evaluateCorpusSample(appendD, { baselineExclusive: true });
    expect(qualityD.duplicateKeys).toHaveLength(0);
    expect(qualityD.disjointFromBaseline5k).toBe(true);
    expect(qualityD.ok).toBe(true);

    const docs20k = generateSyntheticJobCorpus(20000);
    const appendE = sliceAppendCorpus(docs20k, e.start, e.end);
    expect(appendE).toHaveLength(10000);
    expect(appendE[0]?.corpus_key).toBe(corpusKeyForIndex(10000));
    expect(appendE.at(-1)?.corpus_key).toBe(corpusKeyForIndex(19999));
    const qualityE = evaluateCorpusSample(appendE, { baselineExclusive: true });
    expect(qualityE.disjointFromBaseline5k).toBe(true);
    expect(qualityE.duplicateKeys).toHaveLength(0);
  });

  it("expected append keys are unique and resumable-friendly", () => {
    const keys = expectedAppendKeys(5000, 5010);
    expect(keys).toHaveLength(10);
    expect(new Set(keys).size).toBe(10);
    expect(keys.every((k) => !k.includes("00000"))).toBe(true);
  });

  it("checkpoint summary uses gte 384 dims and missing counts", () => {
    const inv = summarizeCheckpoint({
      totalCorpusRows: 5000,
      uniqueKeys: 5000,
      baselineKeysPresent: 5000,
      embeddedGte: 5000,
      embedded768: 1015,
      targetRows: 5000,
    });
    expect(inv.scaleLabel).toBe(scaleLabelForTarget(5000));
    expect(inv.missingGteCount).toBe(0);
    expect(inv.embeddingDimensionsExpected).toBe(GTE_EMBEDDING_DIMENSIONS);
    expect(inv.baselineIntact).toBe(true);
  });

  it("loads frozen eval checkpoints without inventing 10k/20k", () => {
    const rows = loadFrozenEvalCheckpoints(process.cwd());
    expect(rows.map((r) => r.scale)).toEqual(["5k", "10k", "20k"]);
    const five = rows.find((r) => r.scale === "5k");
    // Workspace has a prior 5k artifact from Task 4A.
    if (five?.verified) {
      expect(typeof five.hitRate).toBe("number");
      expect(five.sourcePath).toMatch(/a3-frozen-5k-/);
    }
    for (const scale of ["10k", "20k"] as const) {
      const row = rows.find((r) => r.scale === scale)!;
      if (!row.verified) {
        expect(row.hitRate).toBeNull();
        expect(row.precisionAtK).toBeNull();
      }
    }
    expect(path.isAbsolute(process.cwd())).toBe(true);
  });
});
