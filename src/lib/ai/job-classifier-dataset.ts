/**
 * Classifier-only synthetic example builder for Assessment 2 offline experiments.
 *
 * The Track-1 RAG generator keeps its original boilerplate descriptions. This module
 * replaces classifier feature text with occupational duties + toolkit language so
 * models have legitimate signal after category-slug masking and shortcut stripping.
 * Gold labels, titles, and template-group ids are unchanged.
 */
import { JOB_CORPUS_CATEGORIES, type JobCorpusCategory } from "@/lib/ai/corpus";
import {
  generateSyntheticJobCorpus,
  syntheticBaseTitle,
  syntheticTemplateGroupId,
  type GeneratedCorpusDoc,
} from "@/lib/ai/corpus-generate";
import type { LabeledJobExample } from "@/lib/ai/job-classifier";

/** Shared within-class occupational lexicon (never category slugs). */
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

/** Title-specific duty sentence — transfers via shared class lexicon, not identical fingerprints. */
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
  "Brand Designer": "Extend brand systems across campaigns with content and growth partners.",
  "Design Systems Designer": "Maintain tokenized libraries, document patterns, and support prototyping teams.",
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
 * Build leakage-resistant occupational description for classifier features only.
 * Avoids category-slug openers and the stripped "Core skills for this document:" shortcut.
 * Does not inject label-selected lexicon (gold category is never used to pick feature text).
 */
export function buildClassifierOrientedDescription(
  doc: Pick<GeneratedCorpusDoc, "title" | "category" | "location" | "skills_text" | "corpus_key">,
): string {
  const base = syntheticBaseTitle(doc.title);
  const duty =
    CLASSIFIER_DUTY_BY_BASE_TITLE[base] ??
    "Collaborate with partners and document decisions clearly.";
  return [
    `Opening based in ${doc.location}.`,
    duty,
    // Instance-varying toolkit from the generator skill pool (not the stripped Core-skills phrase).
    `Hands-on tools frequently used: ${doc.skills_text}.`,
    "Expect written updates, stakeholder demos, and measurable outcomes each sprint.",
  ].join(" ");
}

/** Map generator docs → labeled examples with classifier-oriented descriptions. */
export function corpusDocsToClassifierExamples(docs: GeneratedCorpusDoc[]): LabeledJobExample[] {
  return docs.map((doc) => ({
    id: doc.corpus_key,
    title: doc.title,
    description: buildClassifierOrientedDescription(doc),
    category: doc.category,
    templateGroupId: syntheticTemplateGroupId(doc.category, doc.title),
  }));
}

/** Generate offline classifier examples (titles/labels/groups from corpus; descriptions enriched). */
export function generateClassifierLabeledExamples(count = 5000): LabeledJobExample[] {
  return corpusDocsToClassifierExamples(generateSyntheticJobCorpus(count));
}

/** Sanity: every configured category has lexicon entries and duty coverage for generator titles. */
export function assertClassifierDatasetCoverage(): void {
  for (const category of JOB_CORPUS_CATEGORIES) {
    if (!CLASSIFIER_CLASS_LEXICON[category]?.length) {
      throw new Error(`Missing classifier lexicon for ${category}`);
    }
  }
}
