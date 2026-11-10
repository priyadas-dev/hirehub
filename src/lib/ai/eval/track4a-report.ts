/**
 * Assessment 3 Track 4A — compose agent + RAG evaluation report from existing artifacts.
 * Does not invent Assessment 2 numbers; reads measured JSON only.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { AgentScenarioReport } from "@/lib/ai/agents/agent-scenarios";
import {
  loadFrozenEvalCheckpoints,
  type FrozenEvalCheckpointRow,
} from "@/lib/ai/corpus-checkpoint";

export type A2EvalSnapshot = {
  sourcePath: string;
  generatedAt?: string;
  provider?: string;
  k?: number;
  hybrid?: boolean;
  totalCases?: number;
  categoryHitRate?: number;
  cleanCategoryHitRate?: number;
  noisyCategoryHitRate?: number;
  emptyResultRate?: number;
};

export type A3FrozenSnapshot = {
  sourcePath: string;
  evalSetId?: string;
  scaleLabel?: string;
  provider?: string;
  k?: number;
  hitRate?: number | null;
  meanPrecisionAtK?: number | null;
  meanMrr?: number | null;
  meanNdcgAtK?: number | null;
  categoryHitRate?: number | null;
  suspicionProtocolTriggered?: boolean;
  answerCases: Array<{
    id: string;
    faithfulnessScore?: number;
    answerRelevanceScore?: number;
    faithfulnessMethod?: string;
    answerRelevanceMethod?: string;
  }>;
  caseCount?: number;
  generatedAt?: string;
};

export type Track4AReport = {
  title: string;
  generatedAt: string;
  agents: AgentScenarioReport;
  assessment2: A2EvalSnapshot | null;
  assessment3Rag: A3FrozenSnapshot | null;
  /** 5k / 10k / 20k frozen-eval rows (null metrics when not measured). */
  scaleEvalRows: FrozenEvalCheckpointRow[];
  comparisonNotes: string[];
  reproduceCommands: string[];
  limitations: string[];
};

function readJsonIfExists(filePath: string): unknown | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Load Assessment 2 category-hit metrics from the existing eval-report.json. */
export function loadAssessment2Snapshot(repoRoot: string): A2EvalSnapshot | null {
  const sourcePath = path.join(repoRoot, "scripts/rag/out/eval-report.json");
  const raw = readJsonIfExists(sourcePath) as
    | {
        generatedAt?: string;
        provider?: string;
        matchCount?: number;
        hybrid?: boolean;
        metrics?: {
          totalCases?: number;
          categoryHitRate?: number;
          cleanCategoryHitRate?: number;
          noisyCategoryHitRate?: number;
          emptyResultRate?: number;
        };
      }
    | null;
  if (!raw?.metrics) return null;
  return {
    sourcePath: path.relative(repoRoot, sourcePath).replace(/\\/g, "/"),
    generatedAt: raw.generatedAt,
    provider: raw.provider,
    k: raw.matchCount,
    hybrid: raw.hybrid,
    totalCases: raw.metrics.totalCases,
    categoryHitRate: raw.metrics.categoryHitRate,
    cleanCategoryHitRate: raw.metrics.cleanCategoryHitRate,
    noisyCategoryHitRate: raw.metrics.noisyCategoryHitRate,
    emptyResultRate: raw.metrics.emptyResultRate,
  };
}

/** Prefer newest a3-frozen-*.json under scripts/rag/out. */
export function loadLatestA3FrozenSnapshot(repoRoot: string): A3FrozenSnapshot | null {
  const outDir = path.join(repoRoot, "scripts/rag/out");
  if (!existsSync(outDir)) return null;
  const files = readdirSync(outDir)
    .filter((f) => f.startsWith("a3-frozen-") && f.endsWith(".json"))
    .sort();
  if (!files.length) return null;
  const latest = files[files.length - 1]!;
  const sourcePath = path.join(outDir, latest);
  const raw = readJsonIfExists(sourcePath) as
    | {
        evalSetId?: string;
        scaleLabel?: string;
        provider?: string;
        k?: number;
        generatedAt?: string;
        suspicionProtocolTriggered?: boolean;
        retrieval?: {
          caseCount?: number;
          hitRate?: number | null;
          meanPrecisionAtK?: number | null;
          meanMrr?: number | null;
          meanNdcgAtK?: number | null;
          categoryHitRate?: number | null;
        };
        answer?: Array<{
          id: string;
          faithfulness?: { score?: number; method?: string };
          answerRelevance?: { score?: number; method?: string };
        }>;
        cases?: unknown[];
      }
    | null;
  if (!raw) return null;
  return {
    sourcePath: path.relative(repoRoot, sourcePath).replace(/\\/g, "/"),
    evalSetId: raw.evalSetId,
    scaleLabel: raw.scaleLabel,
    provider: raw.provider,
    k: raw.k,
    hitRate: raw.retrieval?.hitRate ?? null,
    meanPrecisionAtK: raw.retrieval?.meanPrecisionAtK ?? null,
    meanMrr: raw.retrieval?.meanMrr ?? null,
    meanNdcgAtK: raw.retrieval?.meanNdcgAtK ?? null,
    categoryHitRate: raw.retrieval?.categoryHitRate ?? null,
    suspicionProtocolTriggered: raw.suspicionProtocolTriggered,
    answerCases: (raw.answer ?? []).map((a) => ({
      id: a.id,
      faithfulnessScore: a.faithfulness?.score,
      answerRelevanceScore: a.answerRelevance?.score,
      faithfulnessMethod: a.faithfulness?.method,
      answerRelevanceMethod: a.answerRelevance?.method,
    })),
    caseCount: raw.retrieval?.caseCount ?? raw.cases?.length,
    generatedAt: raw.generatedAt,
  };
}

export function buildTrack4AReport(input: {
  agents: AgentScenarioReport;
  assessment2: A2EvalSnapshot | null;
  assessment3Rag: A3FrozenSnapshot | null;
  scaleEvalRows?: FrozenEvalCheckpointRow[];
  repoRoot?: string;
}): Track4AReport {
  const comparisonNotes: string[] = [
    "Assessment 2 headline metric is category-hit@k on EVAL_QUERY_BANK (56 cases).",
    "Assessment 3 frozen set a3_v1 uses independent paraphrases/noisy/no-hit/answer probes (20 cases).",
    "A3 Precision@k / Hit@k use category_proxy grades unless relevantCorpusKeys are filled — not identical to A2 category-hit.",
    "Do not claim A3 “beats” A2 on category-hit: query banks and grading differ.",
    "Faithfulness and answer relevance are automated token-overlap heuristics — not LLM-as-judge.",
  ];

  if (!input.assessment2) {
    comparisonNotes.push(
      "Assessment 2 artifact scripts/rag/out/eval-report.json was missing — A2 column left empty (no invented numbers).",
    );
  }
  if (!input.assessment3Rag) {
    comparisonNotes.push(
      "No a3-frozen-*.json found under scripts/rag/out — run npm run rag:eval:frozen -- --provider=gte --scale-label=5k when Supabase RAG env is available.",
    );
  }

  const scaleEvalRows =
    input.scaleEvalRows ??
    loadFrozenEvalCheckpoints(input.repoRoot ?? process.cwd());

  return {
    title: "Assessment 3 Track 4A — Agent & RAG Evaluation",
    generatedAt: new Date().toISOString(),
    agents: input.agents,
    assessment2: input.assessment2,
    assessment3Rag: input.assessment3Rag,
    scaleEvalRows,
    comparisonNotes,
    reproduceCommands: [
      "npm run rag:eval:agents",
      "npm run rag:eval:frozen -- --provider=gte --k=5 --scale-label=5k",
      "npm run rag:eval:track4a",
      "npm run rag:checkpoint",
      "npm run rag:eval -- --provider=gte   # Assessment 2 bank (optional refresh)",
    ],
    limitations: [
      "Agent harness is offline with deterministic mocks — not live E2E against production DB.",
      "RAG frozen metrics require live Supabase corpus + embeddings; Track 4A reuses last measured artifact when present.",
      "10k mid-checkpoint eval may be blank if the corpus was already past 10k before that eval ran — never invent that cell.",
      "Category-proxy Precision@k is weaker than gold corpus_key labels.",
      "Recruiter UI is out of scope for Track 4A.",
    ],
  };
}

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function num(n: number | null | undefined, digits = 3): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

/** Render Markdown report for docs/ and scripts/rag/out/. */
export function renderTrack4AMarkdown(report: Track4AReport): string {
  const a2 = report.assessment2;
  const a3 = report.assessment3Rag;
  const lines: string[] = [];

  lines.push(`# ${report.title}`);
  lines.push("");
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push("");
  lines.push("## 1. Methodology");
  lines.push("");
  lines.push("- **Agent task-success:** labelled offline scenarios in `src/lib/ai/agents/agent-scenarios.ts` (deterministic mocks; no real apply/email/DB).");
  lines.push("- **RAG retrieval:** frozen set `scripts/rag/eval-sets/a3_v1.json` via `scripts/rag/eval-frozen-set.mjs` → Hit@k, Precision@k, MRR, nDCG, category-hit.");
  lines.push("- **RAG answer quality:** heuristic faithfulness + answer relevance (`src/lib/ai/rag-metrics.ts`) — **automated**, not LLM-judged.");
  lines.push("- **Assessment 2 baseline:** `scripts/rag/out/eval-report.json` (category-hit on 56-query bank).");
  lines.push("- Generated JSON/MD under `scripts/rag/out/` (gitignored); fixtures stay under `scripts/rag/eval-sets/`.");
  lines.push("");

  lines.push("## 2. Agent task-success");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---:|`);
  lines.push(`| Scenarios | ${report.agents.total} |`);
  lines.push(`| Passed | ${report.agents.passed} |`);
  lines.push(`| Failed | ${report.agents.failed} |`);
  lines.push(`| **Task-success rate** | **${pct(report.agents.taskSuccessRate)}** |`);
  lines.push("");
  lines.push("### By agent family");
  lines.push("");
  lines.push("| Agent | Total | Passed | Failed | Rate |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const [agent, stats] of Object.entries(report.agents.byAgent).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(
      `| ${agent} | ${stats.total} | ${stats.passed} | ${stats.failed} | ${pct(stats.rate)} |`,
    );
  }
  lines.push("");
  lines.push("### Scenario detail");
  lines.push("");
  lines.push("| ID | Agent | Expected route | Result | Detail |");
  lines.push("|---|---|---|---|---|");
  for (const s of report.agents.scenarios) {
    lines.push(
      `| \`${s.id}\` | ${s.agent} | ${s.expectedRoute ?? "—"} | ${s.ok ? "PASS" : "FAIL"} | ${s.detail.replace(/\|/g, "/")} |`,
    );
  }
  lines.push("");

  lines.push("## 3. RAG metrics (Assessment 3 frozen set)");
  lines.push("");
  if (!a3) {
    lines.push("_No measured `a3-frozen-*.json` artifact found. Re-run frozen eval when RAG env is available._");
  } else {
    lines.push(`**Artifact:** \`${a3.sourcePath}\``);
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Eval set | ${a3.evalSetId ?? "—"} |`);
    lines.push(`| Scale label | ${a3.scaleLabel ?? "—"} |`);
    lines.push(`| Provider | ${a3.provider ?? "—"} |`);
    lines.push(`| K | ${a3.k ?? "—"} |`);
    lines.push(`| Cases | ${a3.caseCount ?? "—"} |`);
    lines.push(`| Hit@K | ${num(a3.hitRate)} |`);
    lines.push(`| Precision@K | ${num(a3.meanPrecisionAtK)} |`);
    lines.push(`| MRR | ${num(a3.meanMrr)} |`);
    lines.push(`| nDCG@K | ${num(a3.meanNdcgAtK)} |`);
    lines.push(`| Category-hit@K (legacy) | ${num(a3.categoryHitRate)} |`);
    lines.push(
      `| Suspicion (>0.90 hit) | ${a3.suspicionProtocolTriggered ? "TRIGGERED" : "no"} |`,
    );
    lines.push("");
    lines.push("### Answer metrics (heuristic — not LLM judge)");
    lines.push("");
    if (!a3.answerCases.length) {
      lines.push("_No answerProbe cases in this artifact._");
    } else {
      lines.push("| Case | Faithfulness | Answer relevance | Methods |");
      lines.push("|---|---:|---:|---|");
      for (const a of a3.answerCases) {
        lines.push(
          `| \`${a.id}\` | ${num(a.faithfulnessScore)} | ${num(a.answerRelevanceScore)} | ${a.faithfulnessMethod ?? "—"} / ${a.answerRelevanceMethod ?? "—"} |`,
        );
      }
    }
  }
  lines.push("");

  lines.push("## 4. Assessment 2 vs Assessment 3 (comparable where evidence exists)");
  lines.push("");
  lines.push("| Dimension | Assessment 2 | Assessment 3 @ frozen a3_v1 |");
  lines.push("|---|---|---|");
  lines.push(
    `| Query bank | EVAL_QUERY_BANK (${a2?.totalCases ?? "56 if present"}) category-proxy | a3_v1 (${a3?.caseCount ?? "20"}) paraphrase/noisy/no-hit |`,
  );
  lines.push(`| K | ${a2?.k ?? "5"} | ${a3?.k ?? "5"} |`);
  lines.push(`| Hybrid FTS | ${a2?.hybrid == null ? "—" : String(a2.hybrid)} | hybrid retrieve (live) |`);
  lines.push(
    `| Category-hit@K | ${a2 ? num(a2.categoryHitRate) : "— (missing artifact)"} | ${a3 ? num(a3.categoryHitRate) : "—"} |`,
  );
  lines.push(
    `| Clean / noisy category-hit | ${a2 ? `${num(a2.cleanCategoryHitRate)} / ${num(a2.noisyCategoryHitRate)}` : "—"} | n/a (different bank) |`,
  );
  lines.push(
    `| Hit@K / Precision@K | not reported as IR Hit/P@k in A2 artifact | ${a3 ? `${num(a3.hitRate)} / ${num(a3.meanPrecisionAtK)}` : "—"} |`,
  );
  lines.push(`| Faithfulness harness | absent | heuristic present |`);
  lines.push("");
  lines.push("### Comparison notes");
  lines.push("");
  for (const note of report.comparisonNotes) {
    lines.push(`- ${note}`);
  }
  lines.push("");

  lines.push("## 4b. Scale checkpoints (5k / 10k / 20k) — measured only");
  lines.push("");
  lines.push("| Scale | Hit@5 | Precision@5 | Category-hit | Faithfulness | Answer relevance | Verified |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const row of report.scaleEvalRows) {
    const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(3));
    lines.push(
      `| ${row.scale} | ${fmt(row.hitRate)} | ${fmt(row.precisionAtK)} | ${fmt(row.categoryHitRate)} | ${fmt(row.faithfulness)} | ${fmt(row.answerRelevance)} | ${row.verified ? "yes" : "no"} |`,
    );
  }
  lines.push("");
  lines.push("Blank cells mean **not measured yet** (Task 4B). Values are never invented.");
  lines.push("");

  lines.push("## 5. Reproduce");
  lines.push("");
  lines.push("```bash");
  for (const cmd of report.reproduceCommands) {
    lines.push(cmd);
  }
  lines.push("```");
  lines.push("");

  lines.push("## 6. Limitations & remaining Task 4B");
  lines.push("");
  for (const lim of report.limitations) {
    lines.push(`- ${lim}`);
  }
  lines.push("- **Task 4B:** expand/evaluate at 20,000 synthetic postings (Stage E) with confirm flags — not part of Track 4A.");
  lines.push("");

  if (report.agents.failed > 0) {
    lines.push("## 7. Failed agent scenarios");
    lines.push("");
    for (const s of report.agents.scenarios.filter((x) => !x.ok)) {
      lines.push(`- **${s.id}** (${s.agent}): ${s.detail}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
