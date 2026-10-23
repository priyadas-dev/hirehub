/**
 * Explicit skill detection against a curated vocabulary.
 * Only returns skills that literally appear in the text — never invents qualifications.
 */

/** Canonical skill labels (display form). Matching is case-insensitive. */
export const KNOWN_SKILLS = [
  "JavaScript",
  "TypeScript",
  "Python",
  "Java",
  "C#",
  "C++",
  "PHP",
  "Ruby",
  "Go",
  "Rust",
  "Kotlin",
  "Swift",
  "SQL",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Redis",
  "React",
  "Next.js",
  "Vue",
  "Angular",
  "Node.js",
  "Express",
  "Laravel",
  "Django",
  "Flask",
  "Spring",
  "ASP.NET",
  ".NET",
  "HTML",
  "CSS",
  "Tailwind",
  "GraphQL",
  "REST",
  "Docker",
  "Kubernetes",
  "AWS",
  "Azure",
  "GCP",
  "Git",
  "Linux",
  "Networking",
  "NOC",
  "Support",
  "Communication",
  "English",
] as const;

export type KnownSkill = (typeof KNOWN_SKILLS)[number];

const SKILL_ALIASES: Record<string, KnownSkill> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  python: "Python",
  java: "Java",
  csharp: "C#",
  "c#": "C#",
  cpp: "C++",
  "c++": "C++",
  php: "PHP",
  ruby: "Ruby",
  golang: "Go",
  go: "Go",
  rust: "Rust",
  kotlin: "Kotlin",
  swift: "Swift",
  sql: "SQL",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  mongo: "MongoDB",
  redis: "Redis",
  react: "React",
  reactjs: "React",
  "react.js": "React",
  nextjs: "Next.js",
  "next.js": "Next.js",
  vue: "Vue",
  vuejs: "Vue",
  angular: "Angular",
  node: "Node.js",
  nodejs: "Node.js",
  "node.js": "Node.js",
  express: "Express",
  laravel: "Laravel",
  django: "Django",
  flask: "Flask",
  spring: "Spring",
  "asp.net": "ASP.NET",
  aspnet: "ASP.NET",
  dotnet: ".NET",
  ".net": ".NET",
  html: "HTML",
  css: "CSS",
  tailwind: "Tailwind",
  graphql: "GraphQL",
  rest: "REST",
  docker: "Docker",
  kubernetes: "Kubernetes",
  k8s: "Kubernetes",
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",
  git: "Git",
  linux: "Linux",
  networking: "Networking",
  network: "Networking",
  noc: "NOC",
  support: "Support",
  communication: "Communication",
  english: "English",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find known skills that literally appear in text. */
export function extractSkillsFromText(text: string): string[] {
  const hay = text.toLowerCase();
  const found: string[] = [];
  const seen = new Set<string>();

  // Longer aliases first so "node.js" wins over "node" where relevant.
  const aliases = Object.keys(SKILL_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const canonical = SKILL_ALIASES[alias]!;
    if (seen.has(canonical.toLowerCase())) continue;
    // Treat punctuation (. , ; :) as skill boundaries so "Vue." / "SQL," still match.
    const pattern =
      alias.length <= 2
        ? new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}([^a-z0-9]|$)`, "i")
        : new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(alias)}([^a-z0-9+#]|$)`, "i");
    if (pattern.test(hay)) {
      seen.add(canonical.toLowerCase());
      found.push(canonical);
    }
  }
  return found;
}

/**
 * Skills explicitly listed in a chat question, e.g.
 * "I know React, JavaScript and SQL. Find suitable jobs"
 */
export function extractSkillsFromQuestion(question: string): string[] {
  const fromFull = extractSkillsFromText(question);
  const listMatch = question.match(
    /\b(?:i know|skills?(?: include| are|:)?|experienced in|proficient in)\s+([^.?!\n]+)/i,
  );
  if (!listMatch?.[1]) return fromFull;
  const listed = extractSkillsFromText(listMatch[1]);
  const merged = [...fromFull];
  for (const skill of listed) {
    if (!merged.some((s) => s.toLowerCase() === skill.toLowerCase())) merged.push(skill);
  }
  return merged;
}

export function mergeSkillLists(...lists: Array<string[] | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const skill of list ?? []) {
      const trimmed = skill.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      // Only keep skills that map to the known vocabulary (or are already canonical).
      const fromAlias = SKILL_ALIASES[key];
      const canonical = fromAlias ?? KNOWN_SKILLS.find((s) => s.toLowerCase() === key) ?? null;
      if (!canonical) continue;
      seen.add(canonical.toLowerCase());
      out.push(canonical);
    }
  }
  return out;
}

export { looksLikeResumeMatchRequest } from "@/lib/ai/assistant-intent";
