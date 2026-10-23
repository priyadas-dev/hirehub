import {
  buildCorpusContent,
  CORPUS_SOURCE_SYNTHETIC_V1,
  corpusKeyForIndex,
  JOB_CORPUS_CATEGORIES,
  type CorpusRecordInput,
  type JobCorpusCategory,
} from "@/lib/ai/corpus";

const LOCATIONS = [
  "Dhaka",
  "Chattogram",
  "Sylhet",
  "Rajshahi",
  "Khulna",
  "Remote — Bangladesh",
  "Hybrid — Dhaka",
  "Remote — South Asia",
  "Gazipur",
  "Narayanganj",
] as const;

const TITLE_BY_CATEGORY: Record<JobCorpusCategory, readonly string[]> = {
  engineering: [
    "Software Engineer",
    "Frontend Developer",
    "Backend Engineer",
    "Full Stack Developer",
    "Mobile Engineer",
    "DevOps Engineer",
    "Platform Engineer",
    "QA Automation Engineer",
  ],
  data: [
    "Data Analyst",
    "Data Engineer",
    "Machine Learning Engineer",
    "BI Developer",
    "Analytics Engineer",
  ],
  design: ["Product Designer", "UI Designer", "UX Researcher", "Brand Designer", "Design Systems Designer"],
  product: ["Product Manager", "Associate Product Manager", "Technical Product Manager", "Product Owner"],
  marketing: [
    "Digital Marketing Specialist",
    "Content Marketer",
    "SEO Specialist",
    "Growth Marketer",
    "Brand Manager",
  ],
  sales: ["Account Executive", "Sales Development Representative", "Customer Success Manager", "Sales Manager"],
  operations: ["Operations Coordinator", "Supply Chain Analyst", "Office Manager", "Logistics Specialist"],
  finance: ["Financial Analyst", "Accountant", "FP&A Analyst", "Payroll Specialist"],
  healthcare: ["Clinical Coordinator", "Health Informatics Analyst", "Medical Records Specialist", "Care Coordinator"],
  education: ["Curriculum Designer", "Instructional Designer", "Education Program Coordinator", "Tutor Lead"],
  customer_support: [
    "Customer Support Specialist",
    "Technical Support Engineer",
    "Support Team Lead",
    "Helpdesk Analyst",
  ],
  hr: ["People Operations Specialist", "Talent Acquisition Partner", "HR Generalist", "L&D Coordinator"],
};

const SKILLS_BY_CATEGORY: Record<JobCorpusCategory, readonly string[]> = {
  engineering: ["TypeScript", "React", "Node.js", "PostgreSQL", "Git", "REST APIs", "Testing", "CI/CD"],
  data: ["SQL", "Python", "dbt", "Tableau", "Pandas", "ETL", "Statistics", "BigQuery"],
  design: ["Figma", "User research", "Prototyping", "Accessibility", "Design systems", "Wireframing"],
  product: ["Roadmapping", "User interviews", "A/B testing", "Analytics", "Prioritization", "Stakeholder management"],
  marketing: ["SEO", "Google Ads", "Copywriting", "Email campaigns", "Analytics", "Social media"],
  sales: ["CRM", "Outbound prospecting", "Negotiation", "Pipeline management", "Discovery calls"],
  operations: ["Process design", "Excel", "Vendor management", "Inventory", "Scheduling"],
  finance: ["Excel", "Financial modeling", "GAAP basics", "Budgeting", "Forecasting"],
  healthcare: ["HIPAA awareness", "EMR systems", "Patient coordination", "Documentation", "Compliance"],
  education: ["Curriculum design", "Assessment", "Facilitation", "Learning LMS", "Lesson planning"],
  customer_support: ["Zendesk", "Active listening", "Troubleshooting", "SLA management", "Knowledge bases"],
  hr: ["Recruiting", "Onboarding", "Employee relations", "HRIS", "Interviewing"],
};

const SENIORITY = ["Junior", "Mid-level", "Senior", "Lead", "Staff"] as const;

function pick<T>(items: readonly T[], index: number): T {
  return items[index % items.length]!;
}

function skillsFor(category: JobCorpusCategory, index: number): string {
  const pool = SKILLS_BY_CATEGORY[category];
  const count = 3 + (index % 4);
  const chosen: string[] = [];
  for (let i = 0; i < count; i++) {
    chosen.push(pick(pool, index + i * 3));
  }
  return Array.from(new Set(chosen)).join(", ");
}

function descriptionFor(input: {
  title: string;
  category: JobCorpusCategory;
  location: string;
  skills: string;
  index: number;
}): string {
  const focus = [
    "collaborate with cross-functional partners",
    "ship iterative improvements every sprint",
    "document decisions clearly for teammates",
    "mentor peers and raise quality bars",
    "measure outcomes with practical metrics",
  ];
  return [
    `This is a synthetic ${input.category.replaceAll("_", " ")} role titled "${input.title}" based in ${input.location}.`,
    `You will ${pick(focus, input.index)} while working with modern tools.`,
    `Core skills for this document: ${input.skills}.`,
    `Day-to-day work mixes independent ownership with team reviews, written updates, and stakeholder demos.`,
    `Variant seed ${input.index} exists only to diversify the HireHub RAG corpus for evaluation — it is not a real opening.`,
  ].join(" ");
}

export type GeneratedCorpusDoc = CorpusRecordInput & { content: string };

/**
 * Deterministic synthetic corpus generator (≥5,000 docs by default).
 * Records are clearly labeled synthetic and must never be inserted into public.jobs.
 */
export function generateSyntheticJobCorpus(count = 5000): GeneratedCorpusDoc[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Corpus count must be a positive integer.");
  }

  const docs: GeneratedCorpusDoc[] = [];
  for (let i = 0; i < count; i++) {
    const category = pick(JOB_CORPUS_CATEGORIES, i);
    const baseTitle = pick(TITLE_BY_CATEGORY[category], i);
    const seniority = pick(SENIORITY, Math.floor(i / JOB_CORPUS_CATEGORIES.length));
    const title = `${seniority} ${baseTitle}`;
    const location = pick(LOCATIONS, i * 7);
    const skills_text = skillsFor(category, i);
    const record: CorpusRecordInput = {
      corpus_key: corpusKeyForIndex(i),
      title,
      location,
      category,
      skills_text,
      description: descriptionFor({ title, category, location, skills: skills_text, index: i }),
      source: CORPUS_SOURCE_SYNTHETIC_V1,
      is_synthetic: true,
    };
    docs.push({ ...record, content: buildCorpusContent(record) });
  }
  return docs;
}
