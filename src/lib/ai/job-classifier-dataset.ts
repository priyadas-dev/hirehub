/**
 * Classifier-only synthetic example builder (Assessment 2 / Track 5 offline).
 *
 * The Track-1 RAG generator keeps its original boilerplate + category skill pools.
 * This module builds classifier feature text from location + title-keyed duty prose only
 * (Option A / Task 5D): no category-tied tools laundry list, no gold-category lexicon dump.
 * Gold labels, titles, and template-group ids are unchanged.
 */
import { JOB_CORPUS_CATEGORIES, type JobCorpusCategory } from "@/lib/ai/corpus";
import {
  generateSyntheticJobCorpus,
  syntheticBaseTitle,
  syntheticTemplateGroupId,
  type GeneratedCorpusDoc,
} from "@/lib/ai/corpus-generate";
import {
  DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT,
  assertEnrichmentCoverage,
  buildEnrichedClassifierDescription,
  type ClassifierEnrichmentVariant,
} from "@/lib/ai/job-classifier-enrichment";
import type { LabeledJobExample } from "@/lib/ai/job-classifier";

export type { ClassifierEnrichmentVariant } from "@/lib/ai/job-classifier-enrichment";
export { DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT, CLASSIFIER_ENRICHMENT_VARIANTS } from "@/lib/ai/job-classifier-enrichment";

/**
 * Coverage / documentation lexicon only — NEVER inject into classifier feature text
 * (would recreate category-pure skill leakage).
 */
export const CLASSIFIER_CLASS_LEXICON: Record<JobCorpusCategory, readonly string[]> = {
  engineering: ["TypeScript", "React", "Node.js", "PostgreSQL", "CI/CD", "pull requests", "REST APIs"],
  data: ["SQL", "Python", "dbt", "Tableau", "ETL", "Pandas", "BigQuery"],
  design: ["Figma", "prototypes", "accessibility", "wireframes", "usability", "component libraries"],
  product: [
    "roadmap",
    "user interviews",
    "prioritization",
    "acceptance criteria",
    "A/B testing",
    "analytics funnels",
  ],
  marketing: ["SEO", "Google Ads", "campaigns", "copywriting", "email nurture", "acquisition"],
  sales: ["CRM", "outbound prospecting", "discovery calls", "pipeline", "quota", "negotiation"],
  operations: ["scheduling", "vendors", "inventory", "logistics", "process improvements", "Excel trackers"],
  finance: ["Excel models", "forecasting", "budgeting", "GAAP", "reconciliations", "payroll"],
  healthcare: ["patient pathways", "EMR", "HIPAA", "clinical documentation", "care handoffs", "compliance"],
  education: ["curriculum", "LMS modules", "facilitation", "assessments", "lesson plans", "learner feedback"],
  customer_support: ["Zendesk", "SLA", "troubleshooting", "knowledge base", "ticket queues", "active listening"],
  hr: ["recruiting", "onboarding", "HRIS", "interviewing", "employee relations", "learning programs"],
};

/** Forbidden substring for Track 5 classifier feature text (Option A). */
export const CLASSIFIER_FORBIDDEN_SKILLS_LINE = "Hands-on tools frequently used" as const;

/** Title-specific primary duty — keyed by base title, never by gold category enum. */
export const CLASSIFIER_DUTY_BY_BASE_TITLE: Readonly<Record<string, string>> = {
  "Software Engineer": "Implement features, review pull requests, and keep automated tests green.",
  "Frontend Developer": "Ship accessible UI, collaborate on handoff, and tune client-side performance.",
  "Backend Engineer": "Design services, expose APIs, and harden authentication paths.",
  "Full Stack Developer": "Deliver end-to-end features with checks on every merge.",
  "Mobile Engineer": "Build mobile clients, integrate APIs, and raise release quality with device testing.",
  "DevOps Engineer": "Automate pipelines, improve observability, and keep deployment rollbacks safe.",
  "Platform Engineer": "Provide internal tooling, standardize Git workflows, and reduce toil for feature teams.",
  "QA Automation Engineer": "Expand automated regression suites and catch regressions before release.",
  "Data Analyst": "Explore warehouse tables, build dashboards, and explain metric movements.",
  "Data Engineer": "Maintain pipelines and keep quality checks in the flow.",
  "Machine Learning Engineer": "Train practical models, then monitor offline and online metrics.",
  "BI Developer": "Publish trusted sources, document metric definitions, and partner on extracts.",
  "Analytics Engineer": "Model analytics tables, enforce conventions, and unblock dashboard consumers.",
  "Product Designer": "Shape flows, validate with prototypes, and protect accessibility in the interface.",
  "UI Designer": "Refine visual systems, polish components, and keep libraries coherent.",
  "UX Researcher": "Plan research studies, synthesize findings, and turn insights into priorities.",
  // Avoid campaign/growth wording that overlaps marketing (Task 5D design↔marketing cleanup).
  "Brand Designer": "Extend brand visual systems across print and digital surfaces with design partners.",
  "Design Systems Designer": "Maintain tokenized libraries, document interface patterns, and support design teams.",
  "Product Manager": "Prioritize bets from interviews and keep stakeholder loops tight.",
  "Associate Product Manager": "Support discovery, draft acceptance criteria, and track funnels after launch.",
  "Technical Product Manager": "Translate technical constraints into tradeoffs and clarify experiment plans.",
  "Product Owner": "Own backlog hygiene, align delivery with outcomes, and facilitate demos.",
  "Digital Marketing Specialist": "Operate paid and organic programs, then report acquisition quality.",
  "Content Marketer": "Write conversion copy and nurture sequences with clear CTAs.",
  "SEO Specialist": "Improve organic coverage, fix technical issues, and track ranking movements.",
  "Growth Marketer": "Run acquisition experiments across channels and landing pages.",
  "Brand Manager": "Guide messaging, coordinate launches, and measure lift with practical metrics.",
  "Account Executive": "Advance stages, run discovery conversations, and negotiate next steps.",
  "Sales Development Representative": "Execute prospecting, qualify interest, and book meetings.",
  "Customer Success Manager": "Protect renewals, expand accounts, and turn feedback into themes.",
  "Sales Manager": "Coach attainment, forecast health, and improve negotiation quality.",
  "Operations Coordinator": "Keep schedules accurate, coordinate partners, and document improvements.",
  "Supply Chain Analyst": "Analyze movements and recommend escalations early.",
  "Office Manager": "Run facilities cadence, renewals, and day-to-day team logistics.",
  "Logistics Specialist": "Own shipment exceptions, checkpoints, and follow-ups.",
  "Financial Analyst": "Build models and explain variances to leaders.",
  "Accountant": "Complete close checklists and reconcile ledger discrepancies.",
  "FP&A Analyst": "Partner on scenarios and monthly forecast cycles with leadership.",
  "Payroll Specialist": "Process pay accurately, audit deductions, and keep documentation current.",
  "Clinical Coordinator": "Coordinate pathways and keep documentation complete for care teams.",
  "Health Informatics Analyst": "Improve workflows, track quality metrics, and support reviews.",
  "Medical Records Specialist": "Maintain chart accuracy and respond to record requests.",
  "Care Coordinator": "Guide handoffs, update encounter notes, and unblock pathway needs.",
  "Curriculum Designer": "Build outlines, align goals, and package lessons for facilitators.",
  "Instructional Designer": "Create modules, improve guides, and iterate from feedback.",
  "Education Program Coordinator": "Schedule cohorts, support tutors, and track milestones.",
  "Tutor Lead": "Coach tutors on quality and keep rubrics consistent.",
  "Customer Support Specialist": "Resolve tickets, practice listening, and protect targets.",
  "Technical Support Engineer": "Troubleshoot issues, write articles, and escalate with clear notes.",
  "Support Team Lead": "Coach agents on quality and keep dashboards honest.",
  "Helpdesk Analyst": "Triage inbound queues and improve first-response quality.",
  "People Operations Specialist": "Improve journeys, maintain records, and support workplace cases.",
  "Talent Acquisition Partner": "Source candidates, run loops, and keep pipelines healthy.",
  "HR Generalist": "Advise managers, coordinate arrivals, and maintain policy docs.",
  "L&D Coordinator": "Plan programs, track completion, and partner on skills workshops.",
};

/**
 * Optional second title-keyed duty sentence (still not category→tools).
 * Gives slightly richer occupational prose after skills-line removal.
 */
export const CLASSIFIER_SECONDARY_DUTY_BY_BASE_TITLE: Readonly<Record<string, string>> = {
  "Software Engineer": "Clarify edge cases in code review and keep release notes honest.",
  "Frontend Developer": "Partner with design on spacing, states, and responsive behavior.",
  "Backend Engineer": "Document service contracts and watch error budgets.",
  "Full Stack Developer": "Balance client and server tradeoffs when scope changes mid-sprint.",
  "Mobile Engineer": "Coordinate store releases and watch crash-free sessions.",
  "DevOps Engineer": "Tighten alerts so on-call pages stay actionable.",
  "Platform Engineer": "Publish internal guides so feature teams self-serve safely.",
  "QA Automation Engineer": "Prioritize flaky tests and share failure themes with authors.",
  "Data Analyst": "Write short narratives so leaders trust the dashboard movements.",
  "Data Engineer": "Coordinate schema changes before downstream jobs break.",
  "Machine Learning Engineer": "Document assumptions when offline metrics disagree with live ones.",
  "BI Developer": "Keep definitions aligned when two teams ask for the same metric.",
  "Analytics Engineer": "Review pull requests on models before they reach dashboards.",
  "Product Designer": "Capture rationale so later redesigns do not lose context.",
  "UI Designer": "Check contrast and spacing against the shared visual rules.",
  "UX Researcher": "Share findings in plain language with clear next questions.",
  "Brand Designer": "Keep typography and color tokens consistent across assets.",
  "Design Systems Designer": "Review contributions so components stay coherent.",
  "Product Manager": "Write crisp problem statements before committing build time.",
  "Associate Product Manager": "Log feedback themes and bring them to prioritization.",
  "Technical Product Manager": "Surface sequencing risks early with engineering leads.",
  "Product Owner": "Keep acceptance notes testable and visible to the delivery team.",
  "Digital Marketing Specialist": "Compare channel quality beyond vanity click totals.",
  "Content Marketer": "Align drafts with the offer and the audience stage.",
  "SEO Specialist": "Prioritize fixes that unblock crawl and indexing health.",
  "Growth Marketer": "Document experiment setup so results can be reproduced.",
  "Brand Manager": "Align launch messaging with the product promise.",
  "Account Executive": "Confirm next steps in writing after every discovery call.",
  "Sales Development Representative": "Hand off qualified interest with clear context notes.",
  "Customer Success Manager": "Spot churn risk early from usage and conversation themes.",
  "Sales Manager": "Review forecast assumptions with the team each week.",
  "Operations Coordinator": "Escalate blockers before they cascade across partners.",
  "Supply Chain Analyst": "Flag lead-time risk with a short recommended action.",
  "Office Manager": "Keep vendor renewals visible before they surprise the team.",
  "Logistics Specialist": "Update checkpoints when exceptions change the plan.",
  "Financial Analyst": "Call out drivers behind variance, not only the totals.",
  "Accountant": "Document exceptions found during reconciliations.",
  "FP&A Analyst": "Stress-test scenarios when inputs shift mid-cycle.",
  "Payroll Specialist": "Escalate edge cases before pay day locks.",
  "Clinical Coordinator": "Confirm handoffs so care teams share the same plan.",
  "Health Informatics Analyst": "Validate workflow changes against documentation quality.",
  "Medical Records Specialist": "Protect request turnaround without sacrificing accuracy.",
  "Care Coordinator": "Follow up on open pathway items until they close.",
  "Curriculum Designer": "Check that exercises match the stated learning goals.",
  "Instructional Designer": "Revise modules when learner feedback repeats.",
  "Education Program Coordinator": "Keep facilitators briefed before each cohort starts.",
  "Tutor Lead": "Calibrate feedback so learners hear consistent standards.",
  "Customer Support Specialist": "Close the loop when a fix lands for a recurring issue.",
  "Technical Support Engineer": "Capture reproducible steps before escalating.",
  "Support Team Lead": "Coach on tone and clarity using real ticket examples.",
  "Helpdesk Analyst": "Improve macros when the same question appears often.",
  "People Operations Specialist": "Keep arrival checklists current for each new hire.",
  "Talent Acquisition Partner": "Give interviewers structured prompts and score notes.",
  "HR Generalist": "Clarify policy questions with consistent written guidance.",
  "L&D Coordinator": "Follow completion gaps and adjust workshop schedules.",
};

/**
 * Build Option A classifier feature description: location + title-keyed duties only.
 * Does not use gold category, skills_text, or CLASSIFIER_CLASS_LEXICON.
 */
export function buildClassifierOrientedDescription(
  doc: Pick<GeneratedCorpusDoc, "title" | "location"> & { corpus_key?: string },
  options?: { variant?: ClassifierEnrichmentVariant },
): string {
  const variant = options?.variant ?? DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT;
  return buildEnrichedClassifierDescription(
    {
      title: doc.title,
      location: doc.location,
      diversityKey: doc.corpus_key ?? doc.title,
    },
    variant,
    {
      primary: CLASSIFIER_DUTY_BY_BASE_TITLE,
      secondary: CLASSIFIER_SECONDARY_DUTY_BY_BASE_TITLE,
    },
  );
}

/** Duty sentences only (no location opener) — for dutyOnly ablations. */
export function extractClassifierDutyProse(description: string): string {
  return description.replace(/^Opening based in [^.]+\.\s*/i, "").trim();
}

/** True when legacy skills laundry list is present (must be false for Track 5 features). */
export function classifierDescriptionHasForbiddenSkillsLine(description: string): boolean {
  return description.toLowerCase().includes(CLASSIFIER_FORBIDDEN_SKILLS_LINE.toLowerCase());
}

/** Map generator docs → labeled examples with remediated/enriched classifier descriptions. */
export function corpusDocsToClassifierExamples(
  docs: GeneratedCorpusDoc[],
  options?: { variant?: ClassifierEnrichmentVariant },
): LabeledJobExample[] {
  const variant = options?.variant ?? DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT;
  return docs.map((doc) => ({
    id: doc.corpus_key,
    title: doc.title,
    description: buildClassifierOrientedDescription(doc, { variant }),
    category: doc.category,
    templateGroupId: syntheticTemplateGroupId(doc.category, doc.title),
  }));
}

/** Official Track 5 / compare-path synthetic examples (Option A + enrichment variant). */
export function generateClassifierLabeledExamples(
  count = 5000,
  options?: { variant?: ClassifierEnrichmentVariant },
): LabeledJobExample[] {
  return corpusDocsToClassifierExamples(generateSyntheticJobCorpus(count), options);
}

/** Sanity: lexicon + duty coverage for generator titles (lexicon not used as features). */
export function assertClassifierDatasetCoverage(): void {
  for (const category of JOB_CORPUS_CATEGORIES) {
    if (!CLASSIFIER_CLASS_LEXICON[category]?.length) {
      throw new Error(`Missing classifier lexicon for ${category}`);
    }
  }
  const titles = new Set(
    generateSyntheticJobCorpus(240).map((doc) => syntheticBaseTitle(doc.title)),
  );
  for (const title of titles) {
    if (!CLASSIFIER_DUTY_BY_BASE_TITLE[title]) {
      throw new Error(`Missing post5d primary duty for ${title}`);
    }
    if (!CLASSIFIER_SECONDARY_DUTY_BY_BASE_TITLE[title]) {
      throw new Error(`Missing post5d secondary duty for ${title}`);
    }
  }
  assertEnrichmentCoverage(titles);
}
