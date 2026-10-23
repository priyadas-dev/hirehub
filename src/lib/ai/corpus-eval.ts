export type EvalQueryKind = "matching" | "noisy" | "edge";

export type EvalQueryCase = {
  id: string;
  kind: EvalQueryKind;
  query: string;
  expectCategory?: string;
  categoryFilter?: string;
  notes?: string;
  /** Links a clean matching query to its noisy typo twin for with/without-noise report. */
  pairId?: string;
  pairRole?: "clean" | "noisy";
};

/**
 * Paired clean vs typo/junk variants of the same intent.
 * Used to report quality **with vs without noise** (Assessment 2 Track 1).
 */
export type CleanNoisyPair = {
  pairId: string;
  expectCategory: string;
  cleanQueryId: string;
  noisyQueryId: string;
};

export type EvalCaseResultLike = {
  id: string;
  kind?: string;
  ok?: boolean;
  categoryHit?: boolean | null;
  topSimilarity?: number | null;
  resultCount?: number;
  pairId?: string;
  pairRole?: "clean" | "noisy";
};

export type CleanVsNoisyPairMetric = {
  pairId: string;
  expectCategory: string;
  clean: {
    id: string;
    categoryHit: boolean | null;
    topSimilarity: number | null;
    resultCount: number;
  };
  noisy: {
    id: string;
    categoryHit: boolean | null;
    topSimilarity: number | null;
    resultCount: number;
  };
  similarityDelta: number | null;
  cleanHitNoisyMiss: boolean;
};

export type CleanVsNoisyReport = {
  pairCount: number;
  cleanCategoryHitRate: number | null;
  noisyCategoryHitRate: number | null;
  avgCleanTopSimilarity: number | null;
  avgNoisyTopSimilarity: number | null;
  avgSimilarityDeltaCleanMinusNoisy: number | null;
  pairs: CleanVsNoisyPairMetric[];
  notes: string[];
};

/** Fixed evaluation bank for Track 1 corpus RAG (offline-definable; runs against DB when ready). */
export const EVAL_QUERY_BANK: EvalQueryCase[] = [
  {
    id: "match-frontend-dhaka",
    kind: "matching",
    query: "Frontend React TypeScript developer in Dhaka",
    expectCategory: "engineering",
    pairId: "frontend-react",
    pairRole: "clean",
  },
  {
    id: "noisy-frontend-typos",
    kind: "noisy",
    query: "Frntend Reakt TypeScrpt develper in Dhkaa",
    expectCategory: "engineering",
    pairId: "frontend-react",
    pairRole: "noisy",
    notes: "Typo twin of match-frontend-dhaka for clean-vs-noisy comparison.",
  },
  {
    id: "match-data-sql",
    kind: "matching",
    query: "Data analyst with SQL and Python for dashboards",
    expectCategory: "data",
    pairId: "data-sql",
    pairRole: "clean",
  },
  {
    id: "noisy-data-typos",
    kind: "noisy",
    query: "Datta analist wit SQL an Pythn for dashbords",
    expectCategory: "data",
    pairId: "data-sql",
    pairRole: "noisy",
    notes: "Typo twin of match-data-sql for clean-vs-noisy comparison.",
  },
  {
    id: "match-design-figma",
    kind: "matching",
    query: "Product designer experienced with Figma and design systems",
    expectCategory: "design",
    pairId: "design-figma",
    pairRole: "clean",
  },
  {
    id: "noisy-design-typos",
    kind: "noisy",
    query: "Produkt desiner experiensed with Figm and desing sistems",
    expectCategory: "design",
    pairId: "design-figma",
    pairRole: "noisy",
    notes: "Typo twin of match-design-figma for clean-vs-noisy comparison.",
  },
  {
    id: "match-support",
    kind: "matching",
    query: "Customer support specialist Zendesk troubleshooting",
    expectCategory: "customer_support",
  },
  {
    id: "match-finance",
    kind: "matching",
    query: "Financial analyst budgeting forecasting Excel",
    expectCategory: "finance",
  },
  {
    id: "noisy-keyboard-mash",
    kind: "noisy",
    query: "asdf qwerty zxcv lorem ipsum unrelated tokens",
    notes: "Should still return some nearest neighbors; similarity may be low.",
  },
  {
    id: "noisy-wrong-domain",
    kind: "noisy",
    query: "how to bake sourdough bread at home temperature humidity",
    notes: "Off-domain query — check that results stay labeled synthetic.",
  },
  {
    id: "edge-short",
    kind: "edge",
    query: "SQL",
  },
  {
    id: "edge-unicode",
    kind: "edge",
    query: "সফটওয়্যার ইঞ্জিনিয়ার React TypeScript ঢাকা",
  },
  {
    id: "edge-filtered-marketing",
    kind: "edge",
    query: "growth marketer SEO campaigns",
    expectCategory: "marketing",
    categoryFilter: "marketing",
  },
];

/** Derived pair definitions from the bank (clean + noisy twins). */
export function listCleanNoisyPairs(bank: EvalQueryCase[] = EVAL_QUERY_BANK): CleanNoisyPair[] {
  const byPair = new Map<string, { clean?: EvalQueryCase; noisy?: EvalQueryCase }>();
  for (const item of bank) {
    if (!item.pairId || !item.pairRole) continue;
    const slot = byPair.get(item.pairId) ?? {};
    if (item.pairRole === "clean") slot.clean = item;
    if (item.pairRole === "noisy") slot.noisy = item;
    byPair.set(item.pairId, slot);
  }
  const pairs: CleanNoisyPair[] = [];
  for (const [pairId, slot] of byPair) {
    if (!slot.clean || !slot.noisy || !slot.clean.expectCategory) continue;
    pairs.push({
      pairId,
      expectCategory: slot.clean.expectCategory,
      cleanQueryId: slot.clean.id,
      noisyQueryId: slot.noisy.id,
    });
  }
  return pairs;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function hitRate(hits: Array<boolean | null | undefined>): number | null {
  const scored = hits.filter((h): h is boolean => typeof h === "boolean");
  if (!scored.length) return null;
  return scored.filter(Boolean).length / scored.length;
}

/**
 * Build the with-vs-without-noise comparison table from eval case results.
 * Pure / offline-testable — does not call the database.
 */
export function summarizeCleanVsNoisy(
  cases: EvalCaseResultLike[],
  bank: EvalQueryCase[] = EVAL_QUERY_BANK,
): CleanVsNoisyReport {
  const pairs = listCleanNoisyPairs(bank);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const pairMetrics: CleanVsNoisyPairMetric[] = [];

  for (const pair of pairs) {
    const clean = byId.get(pair.cleanQueryId);
    const noisy = byId.get(pair.noisyQueryId);
    const cleanSim = clean?.topSimilarity ?? null;
    const noisySim = noisy?.topSimilarity ?? null;
    const similarityDelta =
      typeof cleanSim === "number" && typeof noisySim === "number" ? cleanSim - noisySim : null;
    const cleanHit = clean?.categoryHit ?? null;
    const noisyHit = noisy?.categoryHit ?? null;
    pairMetrics.push({
      pairId: pair.pairId,
      expectCategory: pair.expectCategory,
      clean: {
        id: pair.cleanQueryId,
        categoryHit: cleanHit,
        topSimilarity: cleanSim,
        resultCount: clean?.resultCount ?? 0,
      },
      noisy: {
        id: pair.noisyQueryId,
        categoryHit: noisyHit,
        topSimilarity: noisySim,
        resultCount: noisy?.resultCount ?? 0,
      },
      similarityDelta,
      cleanHitNoisyMiss: cleanHit === true && noisyHit === false,
    });
  }

  return {
    pairCount: pairMetrics.length,
    cleanCategoryHitRate: hitRate(pairMetrics.map((p) => p.clean.categoryHit)),
    noisyCategoryHitRate: hitRate(pairMetrics.map((p) => p.noisy.categoryHit)),
    avgCleanTopSimilarity: avg(
      pairMetrics
        .map((p) => p.clean.topSimilarity)
        .filter((n): n is number => typeof n === "number"),
    ),
    avgNoisyTopSimilarity: avg(
      pairMetrics
        .map((p) => p.noisy.topSimilarity)
        .filter((n): n is number => typeof n === "number"),
    ),
    avgSimilarityDeltaCleanMinusNoisy: avg(
      pairMetrics.map((p) => p.similarityDelta).filter((n): n is number => typeof n === "number"),
    ),
    pairs: pairMetrics,
    notes: [
      "Clean = well-formed matching queries; noisy twins = typo/junk variants of the same intent.",
      "Category hit = expectCategory appears anywhere in top-k matches.",
      "Corpus rows are synthetic — not live HireHub vacancies.",
      "Do not reseed or overwrite embedding_gte when regenerating this report.",
    ],
  };
}

/** Markdown table for README / verification docs. */
export function formatCleanVsNoisyMarkdown(report: CleanVsNoisyReport): string {
  const pct = (n: number | null) => (n == null ? "n/a" : `${(n * 100).toFixed(1)}%`);
  const num = (n: number | null) => (n == null ? "n/a" : n.toFixed(3));
  const lines = [
    "| Metric | Clean (without noise) | Noisy (with typos) |",
    "|--------|----------------------:|-------------------:|",
    `| Category hit rate | ${pct(report.cleanCategoryHitRate)} | ${pct(report.noisyCategoryHitRate)} |`,
    `| Avg top similarity | ${num(report.avgCleanTopSimilarity)} | ${num(report.avgNoisyTopSimilarity)} |`,
    `| Avg Δ similarity (clean − noisy) | ${num(report.avgSimilarityDeltaCleanMinusNoisy)} | — |`,
    `| Paired intents | ${report.pairCount} | ${report.pairCount} |`,
    "",
    "| Pair | Clean hit | Noisy hit | Δ similarity |",
    "|------|----------:|----------:|-------------:|",
  ];
  for (const p of report.pairs) {
    lines.push(
      `| ${p.pairId} | ${p.clean.categoryHit == null ? "n/a" : p.clean.categoryHit} | ${p.noisy.categoryHit == null ? "n/a" : p.noisy.categoryHit} | ${num(p.similarityDelta)} |`,
    );
  }
  return lines.join("\n");
}
