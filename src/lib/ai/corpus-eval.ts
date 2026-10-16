export type EvalQueryKind = "matching" | "noisy" | "edge";

export type EvalQueryCase = {
  id: string;
  kind: EvalQueryKind;
  query: string;
  expectCategory?: string;
  categoryFilter?: string;
  notes?: string;
};

/** Fixed evaluation bank for Track 1 corpus RAG (offline-definable; runs against DB when ready). */
export const EVAL_QUERY_BANK: EvalQueryCase[] = [
  {
    id: "match-frontend-dhaka",
    kind: "matching",
    query: "Frontend React TypeScript developer in Dhaka",
    expectCategory: "engineering",
  },
  {
    id: "match-data-sql",
    kind: "matching",
    query: "Data analyst with SQL and Python for dashboards",
    expectCategory: "data",
  },
  {
    id: "match-design-figma",
    kind: "matching",
    query: "Product designer experienced with Figma and design systems",
    expectCategory: "design",
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
