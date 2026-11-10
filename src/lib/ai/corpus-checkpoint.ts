/**
 * Track 4B — corpus scale checkpoint helpers (5k / 10k / 20k).
 * Offline-safe utilities; live inventory lives in scripts/rag/*.mjs.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { corpusKeyForIndex } from "@/lib/ai/corpus";
import { GTE_EMBEDDING_DIMENSIONS } from "@/lib/ai/gte-embed";
import { GEMINI_EMBEDDING_DIMENSIONS } from "@/lib/ai/gemini";

export const CORPUS_SCALE_CHECKPOINTS = [5000, 10000, 20000] as const;
export type CorpusScaleCheckpoint = (typeof CORPUS_SCALE_CHECKPOINTS)[number];

export type CorpusCheckpointInventory = {
  scaleLabel: string;
  targetRows: number;
  totalCorpusRows: number;
  uniquePostingKeys: number;
  baselineKeysPresent: number;
  baselineIntact: boolean;
  embeddedGteCount: number;
  missingGteCount: number;
  embedded768Count: number;
  missing768Count: number;
  /** Failures are recorded during embed runs; inventory uses pending nulls as proxy. */
  failedEmbeddingCount: number | null;
  embeddingProviderExpected: "gte";
  embeddingDimensionsExpected: number;
  legacyEmbeddingDimensions: number;
  measuredAt: string;
};

export function scaleLabelForTarget(target: number): string {
  if (target <= 5000) return "5k";
  if (target <= 10000) return "10k";
  return "20k";
}

export function appendRangeForStage(stage: "D" | "E"): { start: number; end: number; target: number } {
  if (stage === "D") return { start: 5000, end: 10000, target: 10000 };
  return { start: 10000, end: 20000, target: 20000 };
}

/** Keys that Stage D/E would introduce (exclusive of baseline). */
export function expectedAppendKeys(start: number, endExclusive: number): string[] {
  const keys: string[] = [];
  for (let i = start; i < endExclusive; i++) keys.push(corpusKeyForIndex(i));
  return keys;
}

export function summarizeCheckpoint(input: {
  totalCorpusRows: number;
  uniqueKeys: number;
  baselineKeysPresent: number;
  embeddedGte: number;
  embedded768: number;
  failedEmbeddingCount?: number | null;
  targetRows: number;
}): CorpusCheckpointInventory {
  const missingGte = Math.max(0, input.totalCorpusRows - input.embeddedGte);
  const missing768 = Math.max(0, input.totalCorpusRows - input.embedded768);
  return {
    scaleLabel: scaleLabelForTarget(input.targetRows),
    targetRows: input.targetRows,
    totalCorpusRows: input.totalCorpusRows,
    uniquePostingKeys: input.uniqueKeys,
    baselineKeysPresent: input.baselineKeysPresent,
    baselineIntact: input.baselineKeysPresent === 5000,
    embeddedGteCount: input.embeddedGte,
    missingGteCount: missingGte,
    embedded768Count: input.embedded768,
    missing768Count: missing768,
    failedEmbeddingCount: input.failedEmbeddingCount ?? null,
    embeddingProviderExpected: "gte",
    embeddingDimensionsExpected: GTE_EMBEDDING_DIMENSIONS,
    legacyEmbeddingDimensions: GEMINI_EMBEDDING_DIMENSIONS,
    measuredAt: new Date().toISOString(),
  };
}

export type FrozenEvalCheckpointRow = {
  scale: string;
  sourcePath: string | null;
  hitRate: number | null;
  precisionAtK: number | null;
  mrr: number | null;
  ndcgAtK: number | null;
  categoryHitRate: number | null;
  faithfulness: number | null;
  answerRelevance: number | null;
  verified: boolean;
};

/** Load newest a3-frozen-{scale}-*.json per scale label; never invent metrics. */
export function loadFrozenEvalCheckpoints(repoRoot: string): FrozenEvalCheckpointRow[] {
  const outDir = path.join(repoRoot, "scripts/rag/out");
  const scales = ["5k", "10k", "20k"] as const;
  const rows: FrozenEvalCheckpointRow[] = [];

  for (const scale of scales) {
    if (!existsSync(outDir)) {
      rows.push({
        scale,
        sourcePath: null,
        hitRate: null,
        precisionAtK: null,
        mrr: null,
        ndcgAtK: null,
        categoryHitRate: null,
        faithfulness: null,
        answerRelevance: null,
        verified: false,
      });
      continue;
    }
    const files = readdirSync(outDir)
      .filter((f) => f.startsWith(`a3-frozen-${scale}-`) && f.endsWith(".json"))
      .sort();
    const latest = files.at(-1);
    if (!latest) {
      rows.push({
        scale,
        sourcePath: null,
        hitRate: null,
        precisionAtK: null,
        mrr: null,
        ndcgAtK: null,
        categoryHitRate: null,
        faithfulness: null,
        answerRelevance: null,
        verified: false,
      });
      continue;
    }
    const sourcePath = path.join(outDir, latest);
    try {
      const raw = JSON.parse(readFileSync(sourcePath, "utf8")) as {
        retrieval?: {
          hitRate?: number | null;
          meanPrecisionAtK?: number | null;
          meanMrr?: number | null;
          meanNdcgAtK?: number | null;
          categoryHitRate?: number | null;
        };
        answer?: Array<{
          faithfulness?: { score?: number };
          answerRelevance?: { score?: number };
        }>;
      };
      const faithScores = (raw.answer ?? [])
        .map((a) => a.faithfulness?.score)
        .filter((n): n is number => typeof n === "number");
      const relScores = (raw.answer ?? [])
        .map((a) => a.answerRelevance?.score)
        .filter((n): n is number => typeof n === "number");
      const mean = (xs: number[]) =>
        xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      rows.push({
        scale,
        sourcePath: path.relative(repoRoot, sourcePath).replace(/\\/g, "/"),
        hitRate: raw.retrieval?.hitRate ?? null,
        precisionAtK: raw.retrieval?.meanPrecisionAtK ?? null,
        mrr: raw.retrieval?.meanMrr ?? null,
        ndcgAtK: raw.retrieval?.meanNdcgAtK ?? null,
        categoryHitRate: raw.retrieval?.categoryHitRate ?? null,
        faithfulness: mean(faithScores),
        answerRelevance: mean(relScores),
        verified: true,
      });
    } catch {
      rows.push({
        scale,
        sourcePath: null,
        hitRate: null,
        precisionAtK: null,
        mrr: null,
        ndcgAtK: null,
        categoryHitRate: null,
        faithfulness: null,
        answerRelevance: null,
        verified: false,
      });
    }
  }
  return rows;
}

export function renderTrack4BMarkdown(input: {
  generatedAt: string;
  inventories: CorpusCheckpointInventory[];
  evalRows: FrozenEvalCheckpointRow[];
  liveStatus: "verified_live" | "pipeline_only" | "partial";
  manualSteps: string[];
}): string {
  const lines: string[] = [];
  lines.push("# Assessment 3 Track 4B — 20k Corpus Scale");
  lines.push("");
  lines.push(`**Generated:** ${input.generatedAt}`);
  lines.push(`**Live status:** ${input.liveStatus}`);
  lines.push("");
  lines.push("## 1. Pipeline (reuse)");
  lines.push("");
  lines.push("- Seed: `scripts/rag/seed-job-corpus.mjs` + Stage D/E in `scripts/rag/scale-corpus-stages.mjs`");
  lines.push("- Embed: `scripts/rag/embed-job-corpus.mjs --provider=gte` → `embedding_gte` (384) only");
  lines.push("- Eval: frozen `a3_v1` via `scripts/rag/eval-frozen-set.mjs`");
  lines.push("- Checkpoints: 5k → 10k (Stage D) → 20k (Stage E); baseline keys preserved");
  lines.push("");
  lines.push("## 2. Corpus / embedding checkpoints");
  lines.push("");
  lines.push(
    "| Scale | Total rows | Unique keys | Embedded gte | Missing gte | Failed (embed run) | Dims | Baseline intact |",
  );
  lines.push("|---|---:|---:|---:|---:|---:|---:|---|");
  if (!input.inventories.length) {
    lines.push("| — | — | — | — | — | — | 384 | — |");
    lines.push("");
    lines.push("_No live inventory captured this session._");
  } else {
    for (const inv of input.inventories) {
      lines.push(
        `| ${inv.scaleLabel} | ${inv.totalCorpusRows} | ${inv.uniquePostingKeys} | ${inv.embeddedGteCount} | ${inv.missingGteCount} | ${inv.failedEmbeddingCount ?? "n/a"} | ${inv.embeddingDimensionsExpected} | ${inv.baselineIntact ? "yes" : "NO"} |`,
      );
    }
  }
  lines.push("");
  lines.push("## 3. RAG eval at checkpoints (same bank / K / metrics)");
  lines.push("");
  lines.push("| Scale | Hit@5 | Precision@5 | Category-hit | Faithfulness | Answer relevance | Verified |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const row of input.evalRows) {
    const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(3));
    lines.push(
      `| ${row.scale} | ${fmt(row.hitRate)} | ${fmt(row.precisionAtK)} | ${fmt(row.categoryHitRate)} | ${fmt(row.faithfulness)} | ${fmt(row.answerRelevance)} | ${row.verified ? "yes" : "no"} |`,
    );
  }
  lines.push("");
  lines.push("Unverified checkpoints are left blank — **not invented**.");
  lines.push("");
  lines.push(
    "**Note:** A blank **10k** cell means no frozen eval was captured while the live corpus was exactly at 10k (e.g. corpus already at 20k). Do not backfill invented scores.",
  );
  lines.push("");
  lines.push("## 4. Manual steps (if live scale not completed here)");
  lines.push("");
  lines.push("```bash");
  for (const step of input.manualSteps) lines.push(step);
  lines.push("```");
  lines.push("");
  lines.push("## 5. Safety");
  lines.push("");
  lines.push("- Upsert on `corpus_key` only; embeddings omitted on seed (never wiped).");
  lines.push("- gte writes `embedding_gte` only; never mixes into 768 `embedding`.");
  lines.push("- Stage D/E refuse to seed if baseline 5k keys are incomplete.");
  lines.push("- Bulk gte embed requires `--confirm-gte-bulk`.");
  lines.push("");
  return lines.join("\n");
}
