/**
 * P4 — Build datasets/track5_ood_v1 from a licensed public JD source.
 *
 * Source: its-zion-18/Jobs-tabular-dataset (Apache-2.0), original split only
 * (real scraped postings — NOT the CTGAN augmented split).
 *
 * Labels: HireHub 12-class mapping from source Job Type where unambiguous,
 * plus title/description-assisted review for Consulting / Biotechnology /
 * Nonprofit / similar ambiguous source types. Rows that cannot be mapped
 * cleanly are dropped (never forced).
 *
 * Does NOT invent job text. Does NOT use HireHub synthetic generator strings.
 * Does NOT tune the classifier.
 *
 * Usage:
 *   node --import tsx scripts/rag/build-track5-ood-v1.mjs
 *   node --import tsx scripts/rag/build-track5-ood-v1.mjs --from=scripts/rag/out/p4-hf-original-raw.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { syntheticBaseTitle } from "../../src/lib/ai/corpus-generate.ts";
import { CLASSIFIER_DUTY_BY_BASE_TITLE } from "../../src/lib/ai/job-classifier-dataset.ts";

const CATEGORIES = [
  "engineering",
  "data",
  "design",
  "product",
  "marketing",
  "sales",
  "operations",
  "finance",
  "healthcare",
  "education",
  "customer_support",
  "hr",
];

/** Clear source Job Type → HireHub category. */
const TYPE_MAP = {
  Engineering: "engineering",
  "Software Development": "engineering",
  Cybersecurity: "engineering",
  "Data Science/Analytics": "data",
  "User Experience (UX) Design": "design",
  "Product Management": "product",
  Marketing: "marketing",
  "Public Relations (PR)": "marketing",
  Sales: "sales",
  "Supply Chain Management": "operations",
  Education: "education",
};

/**
 * Ordered keyword rules for ambiguous source types.
 * First match wins. Intentionally conservative.
 */
const KEYWORD_RULES = [
  {
    category: "healthcare",
    re: /\b(physician|nurse|nursing|psychiatrist|psychologist|telehealth|clinical research|patient safety|biomanufacturing|therapeutics|medical director|clinician|mental health care|sleep specialist)\b/i,
  },
  {
    category: "customer_support",
    re: /\b(customer success|customer service|premium support|member support|participant support|client experience|client success|support specialist|patient engagement|patient enrollment|cx\b)/i,
  },
  {
    category: "finance",
    re: /\b(finance operations|finance and accounting|controller|billing specialist|invoicing|accounts payable|accounts receivable|reinsurance|payroll|aml\b|financial advisory|investment organization|portfolio implementation)\b/i,
  },
  {
    category: "hr",
    re: /\b(successfactors|talent acquisition|human resources|\bhris\b|people operations|workplace experience|recruiter|recruiting|onboarding)\b/i,
  },
  {
    category: "operations",
    re: /\b(procurement|supply chain|facilities planner|construction safety|trade compliance|sports operations|operations manager|program specialist)\b/i,
  },
  {
    category: "engineering",
    re: /\b(software|electrical engineer|mechanical|cloud strategy|security architecture|technical lead|controls\/electrical|devops|platform engineer)\b/i,
  },
  {
    category: "data",
    re: /\b(data scientist|data engineer|analytics|machine learning|bi developer)\b/i,
  },
  {
    category: "design",
    re: /\b(ux |ui |product design|design director|design systems|visual design)\b/i,
  },
  {
    category: "product",
    re: /\b(product manager|product management|roadmap)\b/i,
  },
  {
    category: "marketing",
    re: /\b(marketing|growth|public relations|\bpr\b|brand manager)\b/i,
  },
  {
    category: "sales",
    re: /\b(sales|account executive|territory representative|business development)\b/i,
  },
  {
    category: "education",
    re: /\b(teacher|instructor|curriculum|professor|educator|learning and development)\b/i,
  },
  {
    category: "healthcare",
    re: /\b(scientist|research associate|clinical|biotech|medical|patient|physician assistant)\b/i,
  },
];

const DROP_TITLE_RE =
  /\b(reporter|photojournalist|staff reporter|breaking news|architect\b|architectural designer|landscape architect|project architect|intermediate architect|employment lawyer|founding ceo|territory representative)\b/i;

const MAX_PER_CLASS = 28;
const MIN_DESC = 80;

/** Exact base-title overlap with synthetic duty bank → drop (disjointness). */
const SYNTHETIC_BASE_TITLES = new Set(
  Object.keys(CLASSIFIER_DUTY_BY_BASE_TITLE).map((t) => syntheticBaseTitle(t).toLowerCase()),
);

function parseArgs(argv) {
  let from = path.join(process.cwd(), "scripts/rag/out/p4-hf-original-raw.json");
  for (const arg of argv) {
    const m = arg.match(/^--from=(.+)$/);
    if (m) from = path.resolve(m[1]);
  }
  return { from };
}

function normalizeWs(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDescription(row) {
  const parts = [row.Description, row.Duties, row.qualifications]
    .map(normalizeWs)
    .filter((p) => p.length > 0);
  // Prefer description + duties; qualifications add skills signal that is fair for OOD
  // natural JDs (not the synthetic category laundry list).
  return parts.join("\n\n").slice(0, 6000);
}

function mapCategory(row) {
  const sourceType = normalizeWs(row["Job Type"]);
  const title = normalizeWs(row["Job title"]);
  const hay = `${title}\n${row.Description ?? ""}\n${row.Duties ?? ""}`;

  if (!title || title.length < 3) {
    return { category: null, reason: "empty_title" };
  }
  if (SYNTHETIC_BASE_TITLES.has(syntheticBaseTitle(title).toLowerCase())) {
    return { category: null, reason: "synthetic_title_bank_collision" };
  }
  if (/\[ERROR\]/i.test(hay) || /insufficient extractable content/i.test(hay)) {
    return { category: null, reason: "bad_extract" };
  }
  // Building architecture / pure journalism are outside HireHub's 12 classes.
  if (sourceType === "Architecture" || sourceType === "Journalism") {
    if (DROP_TITLE_RE.test(title) || sourceType === "Architecture" || sourceType === "Journalism") {
      // Allow technical writer under journalism → skip; keep drop.
      return { category: null, reason: `out_of_taxonomy:${sourceType}` };
    }
  }
  if (DROP_TITLE_RE.test(title) && (sourceType === "Architecture" || sourceType === "Journalism")) {
    return { category: null, reason: "out_of_taxonomy_title" };
  }
  if (sourceType === "Architecture") {
    return { category: null, reason: "out_of_taxonomy:Architecture" };
  }
  if (sourceType === "Journalism") {
    return { category: null, reason: "out_of_taxonomy:Journalism" };
  }

  if (TYPE_MAP[sourceType]) {
    return {
      category: TYPE_MAP[sourceType],
      reason: `type_map:${sourceType}`,
    };
  }

  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(hay)) {
      return {
        category: rule.category,
        reason: `keyword:${rule.category}`,
      };
    }
  }

  return { category: null, reason: `unmapped:${sourceType || "empty"}` };
}

function main() {
  const { from } = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(from, "utf8"));
  if (!Array.isArray(raw)) {
    console.error("Expected array in", from);
    process.exit(1);
  }

  const candidates = [];
  const dropReasons = {};
  for (const row of raw) {
    const title = normalizeWs(row["Job title"]);
    const description = buildDescription(row);
    if (description.length < MIN_DESC) {
      dropReasons.short_desc = (dropReasons.short_desc || 0) + 1;
      continue;
    }
    const mapped = mapCategory(row);
    if (!mapped.category) {
      dropReasons[mapped.reason] = (dropReasons[mapped.reason] || 0) + 1;
      continue;
    }
    candidates.push({
      source_idx: row.idx,
      title,
      description,
      location: "unspecified",
      category: mapped.category,
      source_job_type: normalizeWs(row["Job Type"]) || null,
      company: normalizeWs(row.Company) || null,
      label_reason: mapped.reason,
    });
  }

  // Deterministic order then per-class cap (prefer earlier source indices).
  candidates.sort((a, b) => a.source_idx - b.source_idx);
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const kept = [];
  for (const row of candidates) {
    if (counts[row.category] >= MAX_PER_CLASS) continue;
    const id = `ood-v1-${String(row.source_idx).padStart(4, "0")}`;
    kept.push({
      id,
      title: row.title,
      description: row.description,
      location: row.location,
      category: row.category,
      provenance: {
        dataset: "its-zion-18/Jobs-tabular-dataset",
        split: "original",
        license: "Apache-2.0",
        source_idx: row.source_idx,
        source_job_type: row.source_job_type,
        company: row.company,
        label_reason: row.label_reason,
        label_protocol:
          "single-annotator map: clear Job Type → HireHub class, else conservative title/description keywords; unmapped dropped",
      },
    });
    counts[row.category] += 1;
  }

  const outDir = path.join(process.cwd(), "datasets/track5_ood_v1");
  mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "track5_ood_v1.jsonl");
  const metaPath = path.join(outDir, "manifest.json");
  writeFileSync(jsonlPath, kept.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  const manifest = {
    datasetId: "track5_ood_v1",
    generatedAt: new Date().toISOString(),
    n: kept.length,
    categories: CATEGORIES,
    perClass: counts,
    maxPerClass: MAX_PER_CLASS,
    minDescriptionChars: MIN_DESC,
    source: {
      huggingFaceId: "its-zion-18/Jobs-tabular-dataset",
      split: "original",
      license: "Apache-2.0",
      notes: [
        "Original split only (scraped public postings).",
        "Augmented/CTGAN split intentionally excluded.",
        "Not HireHub live vacancies; not synthetic generator output.",
      ],
    },
    hireHubExportAttempt: {
      attempted: true,
      totalJobs: 15,
      usableLabeledPreferred: false,
      reason:
        "HireHub public.jobs has only ~15 rows (many test/garbage descriptions, no category column). Insufficient for OOD; documented in PROVENANCE.md.",
    },
    dropReasons,
    candidateCount: candidates.length,
    protocol: {
      trainOn: "synthetic train only (enriched_v2)",
      tuneOnOod: false,
      reportAs: "independentBenchmark",
    },
  };
  writeFileSync(metaPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        wrote: jsonlPath,
        manifest: metaPath,
        n: kept.length,
        perClass: counts,
        dropReasons,
      },
      null,
      2,
    ),
  );
}

main();
