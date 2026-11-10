/**
 * Track 5 Task 5E — title-keyed duty enrichment variants (Option A).
 *
 * Selection is always by base title string (never gold category).
 * Prose intentionally shares occupational stems across related titles so
 * template-group holdout can transfer signal — without skills laundry lists.
 */
import { syntheticBaseTitle } from "@/lib/ai/corpus-generate";

export const CLASSIFIER_ENRICHMENT_VARIANTS = [
  "post5d",
  "enriched_v1",
  "enriched_v2",
  "enriched_v3",
  /** P5: v1 + diversified secondary + thin tertiary (less class-stem reuse). */
  "v2-div-a",
  /** P5: paraphrased primary pool + diversified secondary; no tertiary. */
  "v2-div-b",
] as const;

export type ClassifierEnrichmentVariant = (typeof CLASSIFIER_ENRICHMENT_VARIANTS)[number];

/**
 * Default after P5 diversification.
 * `v2-div-b` jointly hits Macro F1 ≥ 0.85 and preferred accuracy ∈ (70%, 90%).
 * Prior `enriched_v2` remains a valid F1≥0.85 checkpoint (acc ≥90% / synthetic still easy).
 * Highest raw F1 remains `enriched_v3` (acc clearly ≥90%).
 */
export const DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT: ClassifierEnrichmentVariant = "v2-div-b";

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickAlternate(options: readonly string[], seedKey: string): string {
  if (options.length === 0) return "";
  return options[hashString(seedKey) % options.length]!;
}

/** V1 — richer primary duties with cross-title occupational stem overlap. */
export const ENRICHED_V1_PRIMARY: Readonly<Record<string, string>> = {
  "Software Engineer":
    "Write and maintain application code, review pull requests, and keep automated tests covering critical services before each merge.",
  "Frontend Developer":
    "Ship interface features in application code, review pull requests with teammates, and keep automated tests around UI regressions before merge.",
  "Backend Engineer":
    "Build reliable services and APIs, review pull requests carefully, and keep automated tests green for authentication and data paths before merge.",
  "Full Stack Developer":
    "Deliver end-to-end application features across services and UI, review pull requests, and keep automated tests honest before every merge.",
  "Mobile Engineer":
    "Ship mobile client features against backend APIs, review pull requests, and keep automated device tests green before release merges.",
  "DevOps Engineer":
    "Automate build and deploy pipelines for services, improve observability, and keep rollback paths tested so releases stay reliable.",
  "Platform Engineer":
    "Provide internal tooling around services and Git workflows, reduce toil for feature teams, and keep platform tests covering deploy paths.",
  "QA Automation Engineer":
    "Expand automated regression suites for services and APIs, catch bugs before release merges, and share failure themes from pull request checks.",
  "Data Analyst":
    "Query warehouse tables, build dashboards of key metrics, and explain dataset movements so leaders trust analysis and reporting.",
  "Data Engineer":
    "Maintain ETL pipelines into the warehouse, enforce quality checks on datasets, and keep downstream metrics jobs reliable for analysis.",
  "Machine Learning Engineer":
    "Train practical models on curated datasets, monitor offline and online metrics, and document assumptions when analysis disagrees with live results.",
  "BI Developer":
    "Publish trusted metric sources for dashboards, document dataset definitions, and partner on extracts that keep reporting consistent.",
  "Analytics Engineer":
    "Model analytics tables in the warehouse, enforce dataset conventions, and unblock dashboard consumers who rely on clean metrics.",
  "Product Designer":
    "Shape interface flows, validate usability with prototypes, and protect accessibility so visual design stays coherent across screens.",
  "UI Designer":
    "Refine visual systems, polish interface components, and keep layout libraries coherent with accessibility and typography standards.",
  "UX Researcher":
    "Plan usability research studies, synthesize findings about interface pain points, and turn insights into design priorities.",
  "Brand Designer":
    "Extend brand visual systems across print and digital surfaces, keep typography and color consistent, and partner with design peers on layout craft.",
  "Design Systems Designer":
    "Maintain tokenized interface libraries, document visual patterns, and support design teams so components stay usable and accessible.",
  "Product Manager":
    "Prioritize roadmap bets from customer discovery interviews, clarify outcomes with stakeholders, and keep requirements crisp before build.",
  "Associate Product Manager":
    "Support discovery interviews, draft acceptance criteria for the backlog, and track outcome funnels after launch with stakeholders.",
  "Technical Product Manager":
    "Translate technical constraints into roadmap tradeoffs, clarify experiment plans with stakeholders, and sequence requirements with engineering.",
  "Product Owner":
    "Own backlog hygiene, align delivery with customer outcomes, and keep acceptance criteria testable for stakeholders in demos.",
  "Digital Marketing Specialist":
    "Operate paid and organic marketing campaigns across channels, refine audience messaging, and report acquisition and conversion quality.",
  "Content Marketer":
    "Write conversion-focused campaign copy and nurture sequences, align messaging to audience stages, and measure content marketing lift.",
  "SEO Specialist":
    "Improve organic coverage for marketing campaigns, fix crawl issues that block acquisition, and track ranking movements by audience query.",
  "Growth Marketer":
    "Run acquisition experiments across marketing channels and landing pages, document conversion results, and refine campaign messaging.",
  "Brand Manager":
    "Guide launch messaging for marketing campaigns, coordinate channel go-to-market, and measure audience lift with practical conversion metrics.",
  "Account Executive":
    "Advance revenue pipeline stages, run discovery calls with prospects, and negotiate next steps that protect quota attainment.",
  "Sales Development Representative":
    "Execute outbound prospecting into the sales pipeline, qualify interest on discovery calls, and book meetings that feed quota.",
  "Customer Success Manager":
    "Protect renewals in the account pipeline, expand revenue where healthy, and turn customer feedback into themes for the sales team.",
  "Sales Manager":
    "Coach quota attainment across the revenue pipeline, forecast deal health, and improve negotiation quality on discovery calls.",
  "Operations Coordinator":
    "Keep schedules accurate across vendors and partners, coordinate inventory handoffs, and document process improvements for logistics throughput.",
  "Supply Chain Analyst":
    "Analyze inventory and logistics movements, recommend escalations early, and improve scheduling processes with vendors.",
  "Office Manager":
    "Run facilities cadence, renew vendor contracts on schedule, and keep day-to-day logistics smooth for team operations.",
  "Logistics Specialist":
    "Own shipment exceptions and checkpoints, update inventory partners, and keep scheduling follow-ups tight when logistics slip.",
  "Financial Analyst":
    "Build budget and forecast models, explain variance drivers to leaders, and keep financial reporting tied to clear assumptions.",
  "Accountant":
    "Complete close checklists, reconcile ledger discrepancies, and document financial exceptions found during reconciliations.",
  "FP&A Analyst":
    "Partner on budget scenarios and monthly forecast cycles, stress-test variance drivers, and brief leadership on financial outlook.",
  "Payroll Specialist":
    "Process pay accurately, audit deductions before close, and keep payroll documentation current for financial controls.",
  "Clinical Coordinator":
    "Coordinate patient pathways with care teams, keep clinical documentation complete, and confirm handoffs across encounters.",
  "Health Informatics Analyst":
    "Improve clinical workflows, track care quality metrics, and support documentation reviews that protect patient pathway compliance.",
  "Medical Records Specialist":
    "Maintain patient chart accuracy, respond to health record requests, and protect documentation quality for clinical teams.",
  "Care Coordinator":
    "Guide patient handoffs, update encounter notes, and unblock pathway needs so clinical care stays continuous.",
  "Curriculum Designer":
    "Build instructional outlines, align learning goals, and package lessons so facilitators can run assessments consistently.",
  "Instructional Designer":
    "Create learner modules and guides, improve instructional materials, and iterate from assessment feedback each cohort.",
  "Education Program Coordinator":
    "Schedule learner cohorts, support tutors and facilitators, and track instructional milestones across the curriculum.",
  "Tutor Lead":
    "Coach tutors on instructional quality, keep assessment rubrics consistent, and support learners through lesson practice.",
  "Customer Support Specialist":
    "Resolve customer tickets with clear listening, protect service quality targets, and close loops when troubleshooting finishes.",
  "Technical Support Engineer":
    "Troubleshoot customer issues, write knowledge articles, and escalate tickets with reproducible steps for service quality.",
  "Support Team Lead":
    "Coach agents on ticket quality and tone, keep queue dashboards honest, and raise service quality across customer replies.",
  "Helpdesk Analyst":
    "Triage inbound customer queues, improve first-response quality, and refine macros for recurring troubleshooting themes.",
  "People Operations Specialist":
    "Improve employee journeys, maintain workplace records, and support onboarding so hiring handoffs stay smooth.",
  "Talent Acquisition Partner":
    "Source talent for open roles, run structured interviews, and keep hiring pipelines healthy with clear score notes.",
  "HR Generalist":
    "Advise managers on workplace policy, coordinate employee arrivals, and keep onboarding documentation consistent.",
  "L&D Coordinator":
    "Plan people learning programs, track completion, and partner on skills workshops that support hiring and onboarding goals.",
};

export const ENRICHED_V1_SECONDARY: Readonly<Record<string, string>> = {
  "Software Engineer":
    "Pair on debugging production services, clarify edge cases in code review, and keep release notes tied to tested changes.",
  "Frontend Developer":
    "Partner on responsive interface states, catch accessibility regressions in review, and keep client performance budgets visible.",
  "Backend Engineer":
    "Document service contracts, watch error budgets on APIs, and harden authentication paths before they reach production.",
  "Full Stack Developer":
    "Balance client and server tradeoffs mid-sprint, keep integration tests meaningful, and communicate merge risks early.",
  "Mobile Engineer":
    "Coordinate store releases, watch crash-free sessions, and keep API contract changes synchronized with client code.",
  "DevOps Engineer":
    "Tighten alerts for on-call, verify deploy rollbacks, and keep pipeline reliability visible to engineering teams.",
  "Platform Engineer":
    "Publish internal guides for self-serve services, standardize workflows, and reduce repeated toil around deploys.",
  "QA Automation Engineer":
    "Prioritize flaky tests, expand coverage on critical APIs, and share failure themes before release merges.",
  "Data Analyst":
    "Write short narratives around dashboard metrics so stakeholders trust warehouse analysis and reporting decisions.",
  "Data Engineer":
    "Coordinate schema changes before pipelines break, keep dataset freshness monitored, and partner with analysts on metrics.",
  "Machine Learning Engineer":
    "Monitor live model metrics, refresh training datasets carefully, and explain tradeoffs when offline analysis diverges.",
  "BI Developer":
    "Keep metric definitions aligned across teams and validate dashboard extracts against warehouse sources.",
  "Analytics Engineer":
    "Review model pull requests, enforce naming conventions, and keep analytics datasets ready for dashboard consumers.",
  "Product Designer":
    "Capture design rationale for interface decisions so later usability and accessibility work keeps visual context.",
  "UI Designer":
    "Check contrast, spacing, and typography against shared visual rules before interface components ship.",
  "UX Researcher":
    "Share usability findings in plain language and connect interface insights to concrete design next steps.",
  "Brand Designer":
    "Keep visual identity coherent across assets and review layout crafts with design partners before publishing.",
  "Design Systems Designer":
    "Review component contributions, protect accessibility tokens, and keep the interface library coherent for designers.",
  "Product Manager":
    "Write crisp problem statements, align stakeholders on outcomes, and protect roadmap focus when requests pile up.",
  "Associate Product Manager":
    "Log discovery feedback themes, refine backlog acceptance notes, and bring outcome signals into prioritization.",
  "Technical Product Manager":
    "Surface sequencing risks with engineering, clarify technical requirements, and keep experiment plans measurable.",
  "Product Owner":
    "Facilitate demos around customer outcomes and keep backlog items tied to testable acceptance criteria.",
  "Digital Marketing Specialist":
    "Compare channel quality beyond vanity clicks and refine campaign messaging when acquisition conversion dips.",
  "Content Marketer":
    "Align drafts with the offer and audience stage, then measure whether campaign copy improves conversion.",
  "SEO Specialist":
    "Prioritize organic fixes that unblock indexing and report how ranking changes affect marketing acquisition.",
  "Growth Marketer":
    "Document experiment setup for campaign channels so conversion results stay reproducible across launches.",
  "Brand Manager":
    "Align launch messaging with the product promise and coordinate marketing channel partners before go-live.",
  "Account Executive":
    "Confirm next steps after discovery calls and keep pipeline notes accurate for quota forecasting.",
  "Sales Development Representative":
    "Hand off qualified prospects with context so account executives can continue the revenue conversation.",
  "Customer Success Manager":
    "Spot churn risk early from usage themes and feed renewal insights back into the sales pipeline.",
  "Sales Manager":
    "Review forecast assumptions weekly and coach negotiation quality across discovery and closing motions.",
  "Operations Coordinator":
    "Escalate scheduling blockers before they cascade across vendors, inventory, and logistics partners.",
  "Supply Chain Analyst":
    "Flag lead-time and inventory risk with a recommended action that operations can schedule quickly.",
  "Office Manager":
    "Keep vendor renewals visible and coordinate facilities logistics so daily operations stay predictable.",
  "Logistics Specialist":
    "Update checkpoints when shipment exceptions change the plan and keep inventory partners informed.",
  "Financial Analyst":
    "Call out budget variance drivers, not only totals, and keep forecast assumptions transparent to leaders.",
  "Accountant":
    "Document ledger exceptions during close and partner with finance on reconciliations that need follow-up.",
  "FP&A Analyst":
    "Stress-test forecast scenarios when inputs shift and brief leadership on financial risk ranges.",
  "Payroll Specialist":
    "Escalate payroll edge cases before payday locks and keep financial controls documented.",
  "Clinical Coordinator":
    "Confirm patient handoffs so care teams share one clinical plan and documentation stays complete.",
  "Health Informatics Analyst":
    "Validate workflow changes against clinical documentation quality and patient pathway compliance needs.",
  "Medical Records Specialist":
    "Protect request turnaround without sacrificing patient chart accuracy for clinical reviewers.",
  "Care Coordinator":
    "Follow up on open pathway items until patient care handoffs close cleanly.",
  "Curriculum Designer":
    "Check that lessons and assessments match stated learning goals for facilitators and learners.",
  "Instructional Designer":
    "Revise modules when learner feedback repeats and keep instructional guides easy to facilitate.",
  "Education Program Coordinator":
    "Keep facilitators briefed before each cohort and track instructional milestones across tutors.",
  "Tutor Lead":
    "Calibrate tutor feedback so learners hear consistent instructional standards during lessons.",
  "Customer Support Specialist":
    "Close the loop when a fix lands for recurring tickets and protect customer service quality targets.",
  "Technical Support Engineer":
    "Capture reproducible troubleshooting steps before escalating customer tickets to engineering.",
  "Support Team Lead":
    "Coach agents with real ticket examples so customer replies stay clear and service queues stay healthy.",
  "Helpdesk Analyst":
    "Improve macros when the same customer question repeats and raise first-response quality in the queue.",
  "People Operations Specialist":
    "Keep arrival checklists current for each new hire and smooth employee onboarding handoffs.",
  "Talent Acquisition Partner":
    "Give interviewers structured prompts and keep hiring score notes consistent across talent loops.",
  "HR Generalist":
    "Clarify workplace policy questions in writing and keep employee onboarding docs consistent.",
  "L&D Coordinator":
    "Follow completion gaps in people programs and adjust workshop schedules that support hiring goals.",
};

/** V2 tertiary lines — sharper design vs marketing separation; still title-keyed. */
export const ENRICHED_V2_TERTIARY: Readonly<Record<string, string>> = {
  "Software Engineer":
    "Treat reliability as part of delivery: watch failing tests, reproduce bugs, and ship fixes through reviewed pull requests.",
  "Frontend Developer":
    "Defend interface quality with accessibility checks, visual regression tests, and careful review of UI pull requests.",
  "Backend Engineer":
    "Protect service reliability with contract tests on APIs, careful schema migrations, and reviewed pull requests.",
  "Full Stack Developer":
    "Keep full-stack delivery disciplined with integration tests, API contract checks, and clear merge communication.",
  "Mobile Engineer":
    "Guard mobile release quality with device tests, API contract vigilance, and careful store rollout review.",
  "DevOps Engineer":
    "Make deploy reliability boring: practice rollbacks, tune alerts, and keep pipeline failures actionable.",
  "Platform Engineer":
    "Raise the baseline for every team with self-serve tooling, documented workflows, and tested platform paths.",
  "QA Automation Engineer":
    "Make quality signal loud: stable automated suites, clear failure reports, and coverage on critical services.",
  "Data Analyst":
    "Ground every dashboard claim in warehouse queries and reproducible analysis notes for reporting stakeholders.",
  "Data Engineer":
    "Treat pipeline reliability as product work: monitor freshness, validate datasets, and communicate breaking changes.",
  "Machine Learning Engineer":
    "Keep models operable: track metrics, manage datasets carefully, and explain analysis gaps to partners.",
  "BI Developer":
    "Defend reporting trust with documented metric definitions and validated dashboard extracts.",
  "Analytics Engineer":
    "Keep analytics datasets trustworthy through conventions, reviews, and clear warehouse documentation.",
  "Product Designer":
    "Stay in visual and usability craft: prototypes, accessibility reviews, and coherent interface flows across screens.",
  "UI Designer":
    "Own visual polish: layout rhythm, typography, component states, and accessibility checks before shipping.",
  "UX Researcher":
    "Center evidence on interface usability studies, participant findings, and prioritized design questions.",
  "Brand Designer":
    "Protect visual identity systems, typography, and layout craft across print and digital surfaces.",
  "Design Systems Designer":
    "Scale interface consistency through tokens, components, and accessibility for product design teams.",
  "Product Manager":
    "Hold the line on customer outcomes, roadmap tradeoffs, and stakeholder clarity when scope expands.",
  "Associate Product Manager":
    "Strengthen discovery notes, backlog clarity, and outcome tracking without drifting into pure delivery choreography.",
  "Technical Product Manager":
    "Bridge engineering constraints and product outcomes with measurable experiments and sequenced requirements.",
  "Product Owner":
    "Keep demos honest to customer outcomes and acceptance criteria rather than vanity activity metrics.",
  "Digital Marketing Specialist":
    "Optimize campaign channels for audience acquisition quality and conversion reporting across paid and organic programs.",
  "Content Marketer":
    "Focus on campaign messaging, audience stage, and conversion copy that moves readers through nurture sequences.",
  "SEO Specialist":
    "Improve organic acquisition and crawl health so marketing visibility compounds across priority audience queries.",
  "Growth Marketer":
    "Run channel and landing experiments aimed at acquisition conversion with clear, reproducible campaign setups.",
  "Brand Manager":
    "Own launch messaging and audience perception across marketing channels with measurable lift after each go-live.",
  "Account Executive":
    "Drive revenue conversations from discovery through negotiation while keeping pipeline hygiene impeccable.",
  "Sales Development Representative":
    "Fill the top of the revenue pipeline with qualified prospects and crisp handoff notes.",
  "Customer Success Manager":
    "Protect recurring revenue through renewal health, expansion judgment, and clear customer themes.",
  "Sales Manager":
    "Build a coaching rhythm around quota, forecast accuracy, and negotiation skill across the team.",
  "Operations Coordinator":
    "Orchestrate schedules, vendors, and inventory so operational throughput stays predictable.",
  "Supply Chain Analyst":
    "Turn logistics and inventory signals into timely operational recommendations.",
  "Office Manager":
    "Stabilize facilities and vendor operations so teams can focus on their core work.",
  "Logistics Specialist":
    "Resolve shipment exceptions quickly and keep inventory partners synchronized.",
  "Financial Analyst":
    "Make budget and forecast stories decision-ready with clear variance drivers.",
  "Accountant":
    "Protect close integrity through reconciliations, documentation, and timely exception handling.",
  "FP&A Analyst":
    "Equip leaders with scenario-ready financial forecasts when conditions change.",
  "Payroll Specialist":
    "Keep payroll accurate, controlled, and documented before each pay cycle locks.",
  "Clinical Coordinator":
    "Keep patient pathways coordinated so clinical teams act from one shared plan.",
  "Health Informatics Analyst":
    "Improve clinical information flow without compromising documentation or compliance.",
  "Medical Records Specialist":
    "Guard patient record accuracy and request turnaround for clinical operations.",
  "Care Coordinator":
    "Close patient care loops with timely handoffs and complete encounter notes.",
  "Curriculum Designer":
    "Design coherent learning paths with lessons and assessments facilitators can run.",
  "Instructional Designer":
    "Iterate instructional modules from learner evidence so teaching quality rises each cohort.",
  "Education Program Coordinator":
    "Keep cohorts, tutors, and facilitators synchronized around instructional milestones.",
  "Tutor Lead":
    "Raise tutoring quality through calibrated feedback and consistent assessment standards.",
  "Customer Support Specialist":
    "Deliver empathetic, accurate ticket resolutions that protect customer trust.",
  "Technical Support Engineer":
    "Turn complex troubleshooting into clear customer guidance and clean escalations.",
  "Support Team Lead":
    "Build a coaching culture that lifts ticket quality and queue health together.",
  "Helpdesk Analyst":
    "Make first response sharper by improving triage, macros, and recurring issue patterns.",
  "People Operations Specialist":
    "Design employee experiences that make hiring and onboarding feel organized and humane.",
  "Talent Acquisition Partner":
    "Run fair, structured hiring loops that keep talent pipelines moving with clear evidence.",
  "HR Generalist":
    "Give managers consistent workplace guidance and keep employee processes dependable.",
  "L&D Coordinator":
    "Connect learning programs to hiring and onboarding needs with measurable completion follow-through.",
};

/** Mild secondary alternates for V3 diversity (still title-keyed; no category picker). */
export const ENRICHED_V3_SECONDARY_ALTERNATES: Readonly<Record<string, readonly string[]>> = {
  "Software Engineer": [
    "Pair on debugging production services and keep release notes tied to tested pull requests.",
    "Reproduce tricky bugs, add regression tests, and communicate merge risk to the team.",
  ],
  "Frontend Developer": [
    "Catch accessibility regressions early and keep interface performance budgets visible.",
    "Review UI states carefully and partner on responsive behavior before merge.",
  ],
  "Backend Engineer": [
    "Watch API error budgets and harden authentication paths before production.",
    "Document service contracts and validate schema migrations with tests.",
  ],
  "Full Stack Developer": [
    "Keep integration tests meaningful when client and server scope shifts mid-sprint.",
    "Communicate merge risks early across UI and service changes.",
  ],
  "Mobile Engineer": [
    "Synchronize API contract changes with client code before store release.",
    "Watch crash-free sessions and keep device tests covering critical flows.",
  ],
  "DevOps Engineer": [
    "Verify deploy rollbacks and keep pipeline failures actionable for on-call.",
    "Tune alerts so reliability signal stays loud without noise.",
  ],
  "Platform Engineer": [
    "Reduce repeated deploy toil with self-serve guides and tested platform paths.",
    "Standardize workflows so feature teams ship services with less friction.",
  ],
  "QA Automation Engineer": [
    "Stabilize flaky suites and expand coverage on critical service APIs.",
    "Share failure themes from automated runs before release merges.",
  ],
  "Data Analyst": [
    "Annotate dashboard metrics with short warehouse-backed analysis notes.",
    "Reproduce reporting claims from queries before sharing with stakeholders.",
  ],
  "Data Engineer": [
    "Monitor dataset freshness and communicate breaking pipeline changes early.",
    "Validate warehouse loads so analysts can trust downstream metrics.",
  ],
  "Machine Learning Engineer": [
    "Explain metric gaps when offline analysis and live model results diverge.",
    "Refresh training datasets carefully and track online model health.",
  ],
  "BI Developer": [
    "Validate dashboard extracts against warehouse sources before publishing.",
    "Reconcile conflicting metric definitions across reporting teams.",
  ],
  "Analytics Engineer": [
    "Keep analytics models reviewed and warehouse naming conventions enforced.",
    "Unblock dashboard consumers with clear dataset documentation.",
  ],
  "Product Designer": [
    "Record interface rationale so accessibility and usability work keep context.",
    "Validate flows with prototypes before visual polish locks in.",
  ],
  "UI Designer": [
    "Audit typography and contrast against the shared visual system.",
    "Polish component states so the interface library stays coherent.",
  ],
  "UX Researcher": [
    "Turn participant findings into prioritized interface design questions.",
    "Present usability evidence clearly so design partners can act on the findings.",
  ],
  "Brand Designer": [
    "Review layout craft with design partners before publishing visual assets.",
    "Keep color and typography tokens consistent across brand surfaces.",
  ],
  "Design Systems Designer": [
    "Protect accessibility tokens when new components enter the interface library.",
    "Document visual patterns so product designers reuse components safely.",
  ],
  "Product Manager": [
    "Protect roadmap focus when stakeholders add requests mid-cycle.",
    "Clarify customer outcomes before committing engineering build time.",
  ],
  "Associate Product Manager": [
    "Bring discovery themes into backlog prioritization with clear notes.",
    "Track post-launch outcome signals and share them with stakeholders.",
  ],
  "Technical Product Manager": [
    "Sequence technical requirements with engineering and keep experiments measurable.",
    "Surface constraint tradeoffs early so roadmap bets stay realistic.",
  ],
  "Product Owner": [
    "Keep acceptance criteria testable and visible before each demo.",
    "Align backlog items to customer outcomes rather than activity noise.",
  ],
  "Digital Marketing Specialist": [
    "Refine campaign messaging when channel acquisition conversion softens.",
    "Report audience quality, not only click vanity, across marketing channels.",
  ],
  "Content Marketer": [
    "Match campaign copy to audience stage and measure conversion lift.",
    "Iterate nurture messaging when content marketing underperforms.",
  ],
  "SEO Specialist": [
    "Prioritize crawl fixes that unlock organic marketing acquisition.",
    "Connect ranking movements to audience query intent in reporting.",
  ],
  "Growth Marketer": [
    "Reproduce campaign experiment setups so conversion learning compounds.",
    "Test landing messaging changes aimed at acquisition lift with clear measurement.",
  ],
  "Brand Manager": [
    "Coordinate marketing channel partners before launch messaging goes live.",
    "Measure audience perception lift without owning design-system tokens.",
  ],
  "Account Executive": [
    "Keep pipeline notes accurate after every discovery and negotiation step.",
    "Protect quota by confirming next actions in writing with prospects.",
  ],
  "Sales Development Representative": [
    "Qualify prospects tightly so the revenue pipeline stays clean.",
    "Pass context-rich handoffs that help account executives continue discovery.",
  ],
  "Customer Success Manager": [
    "Feed renewal risk themes into the sales pipeline before churn lands.",
    "Balance expansion opportunities with honest account health signals.",
  ],
  "Sales Manager": [
    "Coach negotiation quality and keep forecast assumptions inspected weekly.",
    "Raise quota discipline across discovery-to-close motions.",
  ],
  "Operations Coordinator": [
    "Escalate vendor and inventory blockers before schedules cascade.",
    "Document process improvements that raise logistics throughput.",
  ],
  "Supply Chain Analyst": [
    "Translate inventory lead-time risk into actionable operations recommendations.",
    "Spot logistics anomalies early and propose scheduling fixes.",
  ],
  "Office Manager": [
    "Keep facilities and vendor renewals from surprising daily operations.",
    "Coordinate logistics so workplace operations stay predictable.",
  ],
  "Logistics Specialist": [
    "Keep inventory partners informed when shipment exceptions change plans.",
    "Close checkpoint gaps quickly to protect operational throughput.",
  ],
  "Financial Analyst": [
    "Explain budget variance drivers with transparent forecast assumptions.",
    "Make financial reporting decision-ready for leadership reviews.",
  ],
  "Accountant": [
    "Partner on reconciliations that need follow-up during close.",
    "Document ledger exceptions so financial controls stay auditable.",
  ],
  "FP&A Analyst": [
    "Brief leadership on financial risk ranges when scenarios shift.",
    "Rebuild forecast views quickly when budget inputs change.",
  ],
  "Payroll Specialist": [
    "Keep payroll controls documented before each pay cycle locks.",
    "Escalate deduction edge cases early to protect financial accuracy.",
  ],
  "Clinical Coordinator": [
    "Keep clinical documentation complete when patient pathways change.",
    "Align care teams on one shared plan before encounters proceed.",
  ],
  "Health Informatics Analyst": [
    "Protect patient pathway compliance while improving clinical workflows.",
    "Review documentation quality impacts before rolling workflow changes.",
  ],
  "Medical Records Specialist": [
    "Balance request turnaround with patient chart accuracy for clinicians.",
    "Flag documentation gaps that put clinical reviews at risk.",
  ],
  "Care Coordinator": [
    "Close patient handoff loops with complete encounter notes.",
    "Unblock pathway items before clinical care continuity breaks.",
  ],
  "Curriculum Designer": [
    "Keep lessons and assessments aligned for facilitators and learners.",
    "Package instructional materials so cohorts run consistently.",
  ],
  "Instructional Designer": [
    "Iterate modules from learner evidence each cohort.",
    "Simplify instructional guides so facilitation quality rises.",
  ],
  "Education Program Coordinator": [
    "Track instructional milestones across tutors and facilitators.",
    "Brief cohorts early so learning logistics stay smooth.",
  ],
  "Tutor Lead": [
    "Keep assessment standards consistent across tutoring sessions.",
    "Coach tutors toward clearer instructional feedback for learners.",
  ],
  "Customer Support Specialist": [
    "Protect service quality targets while resolving customer tickets empathetically.",
    "Close recurring ticket loops once troubleshooting fixes land.",
  ],
  "Technical Support Engineer": [
    "Escalate with reproducible steps so engineering can finish troubleshooting.",
    "Turn complex customer issues into clear knowledge articles.",
  ],
  "Support Team Lead": [
    "Raise queue health and ticket clarity together through coaching.",
    "Use real customer replies as coaching examples for service quality.",
  ],
  "Helpdesk Analyst": [
    "Improve first-response macros for recurring customer questions.",
    "Tighten triage so troubleshooting queues stay manageable.",
  ],
  "People Operations Specialist": [
    "Make employee onboarding checklists current and humane.",
    "Smooth workplace handoffs when hiring volume spikes.",
  ],
  "Talent Acquisition Partner": [
    "Keep hiring score notes consistent across interview loops.",
    "Maintain talent pipeline hygiene with structured interview prompts.",
  ],
  "HR Generalist": [
    "Keep employee onboarding docs consistent for managers.",
    "Answer workplace policy questions with clear written guidance.",
  ],
  "L&D Coordinator": [
    "Adjust workshop schedules when people-program completion gaps appear.",
    "Connect learning programs to hiring and onboarding needs.",
  ],
};

/**
 * P5 thin tertiary — short title-idiosyncratic clauses with less repeated class stems
 * than `ENRICHED_V2_TERTIARY` (still title-keyed; never gold-category selected).
 */
export const ENRICHED_V2_DIV_THIN_TERTIARY: Readonly<Record<string, string>> = {
  "Software Engineer": "Note which failing suite blocked the release and why.",
  "Frontend Developer": "Flag interface jank budgets before growing the screen set.",
  "Backend Engineer": "Call out risky schema moves before they hit production traffic.",
  "Full Stack Developer": "Write a short handoff when client and server land together.",
  "Mobile Engineer": "Confirm store checklist items after the last device dry-run.",
  "DevOps Engineer": "Capture the rollback command that actually worked last outage.",
  "Platform Engineer": "Publish a one-page path for the toil teams ask about most.",
  "QA Automation Engineer": "Mark flaky cases so release owners can trust the suite.",
  "Data Analyst": "Attach the query that produced each surprising metric swing.",
  "Data Engineer": "Announce freshness slips before dashboards go quiet.",
  "Machine Learning Engineer": "Log when offline scores diverge from live behavior.",
  "BI Developer": "Reconcile a conflicting metric definition before republishing.",
  "Analytics Engineer": "Leave naming notes on tables other analysts will inherit.",
  "Product Designer": "Record why a flow changed after the last usability pass.",
  "UI Designer": "Check contrast on new component states before handoff.",
  "UX Researcher": "Rank interface questions by how often participants stumbled.",
  "Brand Designer": "Align typography choices with the shared visual system sheet.",
  "Design Systems Designer": "Note token changes that product designers must adopt.",
  "Product Manager": "Cut scope when outcomes stay fuzzy after discovery.",
  "Associate Product Manager": "Summarize discovery themes before backlog grooming.",
  "Technical Product Manager": "List constraint tradeoffs beside each experiment plan.",
  "Product Owner": "Reject vague acceptance notes before the demo starts.",
  "Digital Marketing Specialist": "Compare channel quality, not only click totals.",
  "Content Marketer": "Retire nurture copy that no longer matches audience stage.",
  "SEO Specialist": "Fix the crawl issue blocking the priority landing pages.",
  "Growth Marketer": "Archive experiment setups so the next test can reuse them.",
  "Brand Manager": "Confirm channel partners before launch messaging goes out.",
  "Account Executive": "Write the agreed next step immediately after discovery.",
  "Sales Development Representative": "Pass only prospects with a clear pain note.",
  "Customer Success Manager": "Raise renewal risk while there is still time to act.",
  "Sales Manager": "Inspect forecast assumptions with each quota owner weekly.",
  "Operations Coordinator": "Escalate vendor delays before schedules cascade.",
  "Supply Chain Analyst": "Propose a scheduling fix when lead times stretch.",
  "Office Manager": "Renew facility contracts before they surprise the team.",
  "Logistics Specialist": "Update partners the moment a shipment exception appears.",
  "Financial Analyst": "Show the variance driver behind each budget surprise.",
  "Accountant": "Document ledger exceptions before close locks.",
  "FP&A Analyst": "Refresh scenario views when inputs change mid-cycle.",
  "Payroll Specialist": "Audit deductions once more before the pay file locks.",
  "Clinical Coordinator": "Keep one shared plan when patient pathways shift.",
  "Health Informatics Analyst": "Review compliance impact before workflow edits ship.",
  "Medical Records Specialist": "Balance chart accuracy with request turnaround.",
  "Care Coordinator": "Close the handoff loop with complete encounter notes.",
  "Curriculum Designer": "Keep lessons and assessments in the same package.",
  "Instructional Designer": "Simplify the guide facilitators struggled with last cohort.",
  "Education Program Coordinator": "Brief tutors before the next milestone week.",
  "Tutor Lead": "Calibrate feedback examples across tutoring sessions.",
  "Customer Support Specialist": "Close the ticket loop once the fix is live.",
  "Technical Support Engineer": "Escalate with steps another engineer can reproduce.",
  "Support Team Lead": "Coach from a real reply that set the quality bar.",
  "Helpdesk Analyst": "Improve the macro for the question that repeats most.",
  "People Operations Specialist": "Refresh arrival checklists before the next hire wave.",
  "Talent Acquisition Partner": "Keep score notes consistent across interview loops.",
  "HR Generalist": "Answer policy questions with the same written guidance each time.",
  "L&D Coordinator": "Adjust workshops when completion gaps show up.",
};

/**
 * P5 primary paraphrase pools — second option uses different local stems than V1
 * so sibling titles share less identical boilerplate (still title-keyed).
 */
export const ENRICHED_V2_DIV_B_PRIMARY_ALTERNATES: Readonly<Record<string, readonly string[]>> = {
  "Software Engineer": [
    ENRICHED_V1_PRIMARY["Software Engineer"]!,
    "Own application changes end to end, write clear change notes, and stabilize regressions before they reach users.",
  ],
  "Frontend Developer": [
    ENRICHED_V1_PRIMARY["Frontend Developer"]!,
    "Deliver screen-level features, partner on handoff clarity, and protect responsive behavior under real device constraints.",
  ],
  "Backend Engineer": [
    ENRICHED_V1_PRIMARY["Backend Engineer"]!,
    "Shape service boundaries, harden auth edges, and keep latency budgets honest for downstream consumers.",
  ],
  "Full Stack Developer": [
    ENRICHED_V1_PRIMARY["Full Stack Developer"]!,
    "Coordinate client and server changes in one delivery slice and keep integration checks meaningful.",
  ],
  "Mobile Engineer": [
    ENRICHED_V1_PRIMARY["Mobile Engineer"]!,
    "Ship client flows against stable contracts and watch crash-free sessions after each store candidate.",
  ],
  "DevOps Engineer": [
    ENRICHED_V1_PRIMARY["DevOps Engineer"]!,
    "Keep delivery pipelines quiet with actionable alerts and practiced recovery paths.",
  ],
  "Platform Engineer": [
    ENRICHED_V1_PRIMARY["Platform Engineer"]!,
    "Remove repeated toil with internal tooling and documented defaults feature teams can trust.",
  ],
  "QA Automation Engineer": [
    ENRICHED_V1_PRIMARY["QA Automation Engineer"]!,
    "Grow stable regression coverage and make failure reports easy for owners to act on.",
  ],
  "Data Analyst": [
    ENRICHED_V1_PRIMARY["Data Analyst"]!,
    "Investigate surprising swings with reproducible queries and brief leaders in plain language.",
  ],
  "Data Engineer": [
    ENRICHED_V1_PRIMARY["Data Engineer"]!,
    "Keep loads trustworthy, communicate breaking schema changes, and protect downstream consumers.",
  ],
  "Machine Learning Engineer": [
    ENRICHED_V1_PRIMARY["Machine Learning Engineer"]!,
    "Ship practical models with monitored health and clear notes when offline scores disagree with live use.",
  ],
  "BI Developer": [
    ENRICHED_V1_PRIMARY["BI Developer"]!,
    "Publish extracts leaders can trust and reconcile conflicting definitions before they spread.",
  ],
  "Analytics Engineer": [
    ENRICHED_V1_PRIMARY["Analytics Engineer"]!,
    "Model clean tables, enforce conventions, and unblock consumers who depend on shared definitions.",
  ],
  "Product Designer": [
    ENRICHED_V1_PRIMARY["Product Designer"]!,
    "Shape usable flows, validate with prototypes, and keep accessibility part of every screen decision.",
  ],
  "UI Designer": [
    ENRICHED_V1_PRIMARY["UI Designer"]!,
    "Polish layout rhythm, typography, and component states so visual systems stay coherent.",
  ],
  "UX Researcher": [
    ENRICHED_V1_PRIMARY["UX Researcher"]!,
    "Run focused studies, synthesize participant pain, and turn evidence into design priorities.",
  ],
  "Brand Designer": [
    ENRICHED_V1_PRIMARY["Brand Designer"]!,
    "Extend visual identity across surfaces while keeping typography and color disciplined.",
  ],
  "Design Systems Designer": [
    ENRICHED_V1_PRIMARY["Design Systems Designer"]!,
    "Maintain tokens and components so product designers reuse patterns safely.",
  ],
  "Product Manager": [
    ENRICHED_V1_PRIMARY["Product Manager"]!,
    "Choose roadmap bets from discovery evidence and keep stakeholder outcomes explicit.",
  ],
  "Associate Product Manager": [
    ENRICHED_V1_PRIMARY["Associate Product Manager"]!,
    "Support discovery notes, tighten backlog wording, and track outcomes after launch.",
  ],
  "Technical Product Manager": [
    ENRICHED_V1_PRIMARY["Technical Product Manager"]!,
    "Translate constraints into sequenced requirements and measurable experiment plans.",
  ],
  "Product Owner": [
    ENRICHED_V1_PRIMARY["Product Owner"]!,
    "Keep backlog hygiene high and acceptance criteria honest for every demo.",
  ],
  "Digital Marketing Specialist": [
    ENRICHED_V1_PRIMARY["Digital Marketing Specialist"]!,
    "Operate channel programs carefully and report audience quality alongside volume.",
  ],
  "Content Marketer": [
    ENRICHED_V1_PRIMARY["Content Marketer"]!,
    "Write stage-aware copy and measure whether nurture sequences actually move readers.",
  ],
  "SEO Specialist": [
    ENRICHED_V1_PRIMARY["SEO Specialist"]!,
    "Improve organic coverage, clear crawl blockers, and tie ranking moves to intent.",
  ],
  "Growth Marketer": [
    ENRICHED_V1_PRIMARY["Growth Marketer"]!,
    "Run landing and channel tests with setups others can reproduce next cycle.",
  ],
  "Brand Manager": [
    ENRICHED_V1_PRIMARY["Brand Manager"]!,
    "Guide launch messaging across partners and measure perception lift after go-live.",
  ],
  "Account Executive": [
    ENRICHED_V1_PRIMARY["Account Executive"]!,
    "Advance deals through discovery and negotiation while keeping notes impeccable.",
  ],
  "Sales Development Representative": [
    ENRICHED_V1_PRIMARY["Sales Development Representative"]!,
    "Qualify outbound interest tightly and book meetings that deserve an executive's time.",
  ],
  "Customer Success Manager": [
    ENRICHED_V1_PRIMARY["Customer Success Manager"]!,
    "Protect renewals with honest health signals and timely expansion judgment.",
  ],
  "Sales Manager": [
    ENRICHED_V1_PRIMARY["Sales Manager"]!,
    "Coach quota owners on forecast honesty and negotiation quality.",
  ],
  "Operations Coordinator": [
    ENRICHED_V1_PRIMARY["Operations Coordinator"]!,
    "Keep schedules, vendors, and inventory handoffs predictable under pressure.",
  ],
  "Supply Chain Analyst": [
    ENRICHED_V1_PRIMARY["Supply Chain Analyst"]!,
    "Turn inventory and logistics signals into early, practical recommendations.",
  ],
  "Office Manager": [
    ENRICHED_V1_PRIMARY["Office Manager"]!,
    "Run facilities cadence and vendor renewals so daily work stays uninterrupted.",
  ],
  "Logistics Specialist": [
    ENRICHED_V1_PRIMARY["Logistics Specialist"]!,
    "Resolve shipment exceptions quickly and keep partners synchronized.",
  ],
  "Financial Analyst": [
    ENRICHED_V1_PRIMARY["Financial Analyst"]!,
    "Build decision-ready budget stories with transparent variance drivers.",
  ],
  "Accountant": [
    ENRICHED_V1_PRIMARY["Accountant"]!,
    "Protect close integrity with reconciliations and documented exceptions.",
  ],
  "FP&A Analyst": [
    ENRICHED_V1_PRIMARY["FP&A Analyst"]!,
    "Stress-test scenarios and brief leaders when outlook inputs shift.",
  ],
  "Payroll Specialist": [
    ENRICHED_V1_PRIMARY["Payroll Specialist"]!,
    "Process pay accurately and keep controls documented before each lock.",
  ],
  "Clinical Coordinator": [
    ENRICHED_V1_PRIMARY["Clinical Coordinator"]!,
    "Coordinate patient pathways so clinical teams act from one plan.",
  ],
  "Health Informatics Analyst": [
    ENRICHED_V1_PRIMARY["Health Informatics Analyst"]!,
    "Improve clinical information flow without weakening documentation quality.",
  ],
  "Medical Records Specialist": [
    ENRICHED_V1_PRIMARY["Medical Records Specialist"]!,
    "Guard chart accuracy while meeting request turnaround expectations.",
  ],
  "Care Coordinator": [
    ENRICHED_V1_PRIMARY["Care Coordinator"]!,
    "Close care loops with timely handoffs and complete encounter notes.",
  ],
  "Curriculum Designer": [
    ENRICHED_V1_PRIMARY["Curriculum Designer"]!,
    "Design learning paths facilitators can run with aligned assessments.",
  ],
  "Instructional Designer": [
    ENRICHED_V1_PRIMARY["Instructional Designer"]!,
    "Iterate modules from learner evidence so teaching quality rises each cohort.",
  ],
  "Education Program Coordinator": [
    ENRICHED_V1_PRIMARY["Education Program Coordinator"]!,
    "Synchronize cohorts, tutors, and facilitators around instructional milestones.",
  ],
  "Tutor Lead": [
    ENRICHED_V1_PRIMARY["Tutor Lead"]!,
    "Raise tutoring quality with calibrated feedback and consistent standards.",
  ],
  "Customer Support Specialist": [
    ENRICHED_V1_PRIMARY["Customer Support Specialist"]!,
    "Resolve tickets empathetically while protecting service quality targets.",
  ],
  "Technical Support Engineer": [
    ENRICHED_V1_PRIMARY["Technical Support Engineer"]!,
    "Turn complex issues into clear guidance and clean engineering escalations.",
  ],
  "Support Team Lead": [
    ENRICHED_V1_PRIMARY["Support Team Lead"]!,
    "Coach agents so replies stay clear and queues stay healthy.",
  ],
  "Helpdesk Analyst": [
    ENRICHED_V1_PRIMARY["Helpdesk Analyst"]!,
    "Improve triage and macros when the same question keeps returning.",
  ],
  "People Operations Specialist": [
    ENRICHED_V1_PRIMARY["People Operations Specialist"]!,
    "Make hiring and onboarding feel organized through current checklists.",
  ],
  "Talent Acquisition Partner": [
    ENRICHED_V1_PRIMARY["Talent Acquisition Partner"]!,
    "Run structured hiring loops with consistent evidence across interviewers.",
  ],
  "HR Generalist": [
    ENRICHED_V1_PRIMARY["HR Generalist"]!,
    "Give managers dependable workplace guidance and consistent employee processes.",
  ],
  "L&D Coordinator": [
    ENRICHED_V1_PRIMARY["L&D Coordinator"]!,
    "Connect learning programs to hiring needs with measurable follow-through.",
  ],
};

export type EnrichmentBuildInput = {
  title: string;
  location: string;
  /** Used only for mild wording diversity — never as a label feature. */
  diversityKey?: string;
};

/**
 * Build classifier description for a Track 5 enrichment variant.
 * Never reads gold category or skills_text.
 */
export function buildEnrichedClassifierDescription(
  doc: EnrichmentBuildInput,
  variant: ClassifierEnrichmentVariant,
  post5d: {
    primary: Readonly<Record<string, string>>;
    secondary: Readonly<Record<string, string>>;
  },
): string {
  const base = syntheticBaseTitle(doc.title);
  const fallbackPrimary = "Collaborate with partners and document decisions clearly.";
  const fallbackSecondary = "Share progress in writing and confirm outcomes with stakeholders.";
  const diversitySeed = `${doc.diversityKey ?? doc.title}::${base}`;

  if (variant === "post5d") {
    const primary = post5d.primary[base] ?? fallbackPrimary;
    const secondary = post5d.secondary[base] ?? fallbackSecondary;
    return [`Opening based in ${doc.location}.`, primary, secondary].join(" ");
  }

  let primary = ENRICHED_V1_PRIMARY[base] ?? fallbackPrimary;
  let secondary = ENRICHED_V1_SECONDARY[base] ?? fallbackSecondary;

  if (variant === "v2-div-b") {
    const primaryAlts = ENRICHED_V2_DIV_B_PRIMARY_ALTERNATES[base];
    if (primaryAlts?.length) {
      primary = pickAlternate(primaryAlts, `${diversitySeed}::primary`);
    }
  }

  if (variant === "enriched_v3" || variant === "v2-div-a" || variant === "v2-div-b") {
    const alts = ENRICHED_V3_SECONDARY_ALTERNATES[base];
    if (alts?.length) {
      secondary = pickAlternate(alts, `${diversitySeed}::secondary`);
    }
  }

  const parts = [`Opening based in ${doc.location}.`, primary, secondary];
  if (variant === "enriched_v2" || variant === "enriched_v3") {
    const tertiary = ENRICHED_V2_TERTIARY[base];
    if (tertiary) parts.push(tertiary);
  } else if (variant === "v2-div-a") {
    const thin = ENRICHED_V2_DIV_THIN_TERTIARY[base];
    if (thin) parts.push(thin);
  }
  return parts.join(" ");
}

export function assertEnrichmentCoverage(titles: Iterable<string>): void {
  for (const title of titles) {
    if (!ENRICHED_V1_PRIMARY[title]) throw new Error(`Missing enriched_v1 primary for ${title}`);
    if (!ENRICHED_V1_SECONDARY[title]) throw new Error(`Missing enriched_v1 secondary for ${title}`);
    if (!ENRICHED_V2_TERTIARY[title]) throw new Error(`Missing enriched_v2 tertiary for ${title}`);
    if (!ENRICHED_V3_SECONDARY_ALTERNATES[title]?.length) {
      throw new Error(`Missing enriched_v3 secondary alternates for ${title}`);
    }
    if (!ENRICHED_V2_DIV_THIN_TERTIARY[title]) {
      throw new Error(`Missing v2-div thin tertiary for ${title}`);
    }
    if (!ENRICHED_V2_DIV_B_PRIMARY_ALTERNATES[title]?.length) {
      throw new Error(`Missing v2-div-b primary alternates for ${title}`);
    }
  }
}
