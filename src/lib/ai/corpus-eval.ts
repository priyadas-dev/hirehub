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

/**
 * Fixed evaluation bank for Track 1 corpus RAG (offline-definable; runs against DB when ready).
 * Target: ≥50 cases spanning matching / noisy / edge, with clean↔noisy pairs for hit-rate reporting.
 */
export const EVAL_QUERY_BANK: EvalQueryCase[] = [
  // --- engineering ---
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
    id: "match-backend-node",
    kind: "matching",
    query: "Backend Node.js API engineer PostgreSQL",
    expectCategory: "engineering",
    pairId: "backend-node",
    pairRole: "clean",
  },
  {
    id: "noisy-backend-typos",
    kind: "noisy",
    query: "Bakend Nodejs API enginer Postgress",
    expectCategory: "engineering",
    pairId: "backend-node",
    pairRole: "noisy",
  },
  {
    id: "match-devops-k8s",
    kind: "matching",
    query: "DevOps engineer Kubernetes Docker CI CD",
    expectCategory: "engineering",
    pairId: "devops-k8s",
    pairRole: "clean",
  },
  {
    id: "noisy-devops-typos",
    kind: "noisy",
    query: "DevOps enginer Kubernets Dockr CI CD",
    expectCategory: "engineering",
    pairId: "devops-k8s",
    pairRole: "noisy",
  },
  {
    id: "match-mobile-flutter",
    kind: "matching",
    query: "Mobile Flutter developer Android iOS apps",
    expectCategory: "engineering",
  },
  {
    id: "match-qa-automation",
    kind: "matching",
    query: "QA automation engineer Playwright Selenium",
    expectCategory: "engineering",
  },

  // --- data ---
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
    id: "match-ml-engineer",
    kind: "matching",
    query: "Machine learning engineer PyTorch NLP models",
    expectCategory: "data",
    pairId: "ml-pytorch",
    pairRole: "clean",
  },
  {
    id: "noisy-ml-typos",
    kind: "noisy",
    query: "Machne learnng enginer PyTorc NLP modls",
    expectCategory: "data",
    pairId: "ml-pytorch",
    pairRole: "noisy",
  },
  {
    id: "match-data-engineer",
    kind: "matching",
    query: "Data engineer Spark Airflow warehouse ETL",
    expectCategory: "data",
  },
  {
    id: "match-bi-tableau",
    kind: "matching",
    query: "Business intelligence analyst Tableau Power BI",
    expectCategory: "data",
  },

  // --- design ---
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
    id: "match-ux-research",
    kind: "matching",
    query: "UX researcher user interviews usability testing",
    expectCategory: "design",
    pairId: "ux-research",
    pairRole: "clean",
  },
  {
    id: "noisy-ux-typos",
    kind: "noisy",
    query: "UX reseacher user interveiws usabilty testng",
    expectCategory: "design",
    pairId: "ux-research",
    pairRole: "noisy",
  },
  {
    id: "match-ui-visual",
    kind: "matching",
    query: "UI visual designer branding illustration",
    expectCategory: "design",
  },

  // --- product ---
  {
    id: "match-product-manager",
    kind: "matching",
    query: "Product manager roadmap prioritization agile",
    expectCategory: "product",
    pairId: "product-pm",
    pairRole: "clean",
  },
  {
    id: "noisy-product-typos",
    kind: "noisy",
    query: "Produkt managr roadmp prioritzation agil",
    expectCategory: "product",
    pairId: "product-pm",
    pairRole: "noisy",
  },
  {
    id: "match-product-owner",
    kind: "matching",
    query: "Product owner backlog grooming stakeholder management",
    expectCategory: "product",
  },

  // --- marketing ---
  {
    id: "match-growth-seo",
    kind: "matching",
    query: "Growth marketer SEO content campaigns",
    expectCategory: "marketing",
    pairId: "growth-seo",
    pairRole: "clean",
  },
  {
    id: "noisy-growth-typos",
    kind: "noisy",
    query: "Growt marketter SEO contnt campains",
    expectCategory: "marketing",
    pairId: "growth-seo",
    pairRole: "noisy",
  },
  {
    id: "match-social-media",
    kind: "matching",
    query: "Social media manager Instagram LinkedIn analytics",
    expectCategory: "marketing",
  },
  {
    id: "match-performance-ads",
    kind: "matching",
    query: "Performance marketing Google Ads Meta Ads ROAS",
    expectCategory: "marketing",
  },

  // --- sales ---
  {
    id: "match-account-executive",
    kind: "matching",
    query: "Account executive B2B SaaS enterprise sales",
    expectCategory: "sales",
    pairId: "ae-saas",
    pairRole: "clean",
  },
  {
    id: "noisy-sales-typos",
    kind: "noisy",
    query: "Acount executve B2B Saas enterprize saless",
    expectCategory: "sales",
    pairId: "ae-saas",
    pairRole: "noisy",
  },
  {
    id: "match-sdr",
    kind: "matching",
    query: "Sales development representative outbound prospecting",
    expectCategory: "sales",
  },

  // --- operations ---
  {
    id: "match-ops-coordinator",
    kind: "matching",
    query: "Operations coordinator logistics process improvement",
    expectCategory: "operations",
    pairId: "ops-coord",
    pairRole: "clean",
  },
  {
    id: "noisy-ops-typos",
    kind: "noisy",
    query: "Operatons coordinatr logistcs proces improvment",
    expectCategory: "operations",
    pairId: "ops-coord",
    pairRole: "noisy",
  },
  {
    id: "match-supply-chain",
    kind: "matching",
    query: "Supply chain analyst inventory forecasting",
    expectCategory: "operations",
  },

  // --- finance ---
  {
    id: "match-finance",
    kind: "matching",
    query: "Financial analyst budgeting forecasting Excel",
    expectCategory: "finance",
    pairId: "finance-excel",
    pairRole: "clean",
  },
  {
    id: "noisy-finance-typos",
    kind: "noisy",
    query: "Financal analist budgetng forcastng Excell",
    expectCategory: "finance",
    pairId: "finance-excel",
    pairRole: "noisy",
  },
  {
    id: "match-accountant",
    kind: "matching",
    query: "Accountant IFRS audit reconciliation",
    expectCategory: "finance",
  },

  // --- healthcare ---
  {
    id: "match-nurse",
    kind: "matching",
    query: "Registered nurse patient care clinical documentation",
    expectCategory: "healthcare",
    pairId: "nurse-care",
    pairRole: "clean",
  },
  {
    id: "noisy-nurse-typos",
    kind: "noisy",
    query: "Registred nirse patiant care clinicl documentaton",
    expectCategory: "healthcare",
    pairId: "nurse-care",
    pairRole: "noisy",
  },
  {
    id: "match-health-admin",
    kind: "matching",
    query: "Healthcare administrator hospital operations compliance",
    expectCategory: "healthcare",
  },

  // --- education ---
  {
    id: "match-teacher",
    kind: "matching",
    query: "Mathematics teacher curriculum lesson planning",
    expectCategory: "education",
    pairId: "teacher-math",
    pairRole: "clean",
  },
  {
    id: "noisy-teacher-typos",
    kind: "noisy",
    query: "Mathematcs teachr curriculm lesson planing",
    expectCategory: "education",
    pairId: "teacher-math",
    pairRole: "noisy",
  },
  {
    id: "match-instructional-design",
    kind: "matching",
    query: "Instructional designer e-learning LMS content",
    expectCategory: "education",
  },

  // --- customer_support ---
  {
    id: "match-support",
    kind: "matching",
    query: "Customer support specialist Zendesk troubleshooting",
    expectCategory: "customer_support",
    pairId: "support-zendesk",
    pairRole: "clean",
  },
  {
    id: "noisy-support-typos",
    kind: "noisy",
    query: "Customr suport specialst Zendsk troubleshoting",
    expectCategory: "customer_support",
    pairId: "support-zendesk",
    pairRole: "noisy",
  },
  {
    id: "match-success-manager",
    kind: "matching",
    query: "Customer success manager onboarding retention",
    expectCategory: "customer_support",
  },

  // --- hr ---
  {
    id: "match-recruiter",
    kind: "matching",
    query: "Technical recruiter sourcing interviewing ATS",
    expectCategory: "hr",
    pairId: "hr-recruiter",
    pairRole: "clean",
  },
  {
    id: "noisy-hr-typos",
    kind: "noisy",
    query: "Technicl recruter sourcng interviewng ATS",
    expectCategory: "hr",
    pairId: "hr-recruiter",
    pairRole: "noisy",
  },
  {
    id: "match-hrbp",
    kind: "matching",
    query: "HR business partner employee relations policy",
    expectCategory: "hr",
  },

  // --- unpaired noisy / edge ---
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
    id: "noisy-mixed-case-punct",
    kind: "noisy",
    query: "!!! ReAcT??? typescript,,, DHAKA --- frontend",
    expectCategory: "engineering",
    notes: "Punctuation / casing noise with recoverable keywords.",
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
  {
    id: "edge-filtered-engineering",
    kind: "edge",
    query: "React TypeScript developer",
    expectCategory: "engineering",
    categoryFilter: "engineering",
  },
  {
    id: "edge-location-only",
    kind: "edge",
    query: "jobs in Chittagong",
  },
  {
    id: "edge-skill-only-excel",
    kind: "edge",
    query: "Excel",
    expectCategory: "finance",
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
