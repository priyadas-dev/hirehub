import { describe, expect, it } from "vitest";
import type { CorpusMatch } from "@/lib/ai/corpus";
import {
  lexicalOverlapScore,
  reciprocalRankFusion,
  rerankHybridCandidates,
  tokensFuzzyEqual,
} from "@/lib/ai/corpus-rerank";

function hit(
  partial: Partial<CorpusMatch> & Pick<CorpusMatch, "id" | "similarity">,
): CorpusMatch {
  return {
    corpus_key: partial.corpus_key ?? `synthetic:v1:${partial.id}`,
    title: partial.title ?? "Title",
    content: partial.content ?? "content",
    location: partial.location ?? "Dhaka",
    category: partial.category ?? "engineering",
    skills_text: partial.skills_text ?? "React",
    is_synthetic: true,
    source: "hirehub-synthetic-v1",
    ...partial,
  };
}

describe("tokensFuzzyEqual", () => {
  it("matches exact and near-typo tokens", () => {
    expect(tokensFuzzyEqual("react", "react")).toBe(true);
    expect(tokensFuzzyEqual("reakt", "react")).toBe(true);
    expect(tokensFuzzyEqual("typescrpt", "typescript")).toBe(true);
    expect(tokensFuzzyEqual("asdf", "react")).toBe(false);
  });
});

describe("lexicalOverlapScore", () => {
  it("scores typo queries against skills/title", () => {
    const score = lexicalOverlapScore("Frntend Reakt TypeScrpt", {
      title: "Frontend React TypeScript Developer",
      skills_text: "React, TypeScript, Frontend",
      category: "engineering",
      location: "Dhaka",
      content: "Build UI",
    });
    expect(score).toBeGreaterThan(0.5);
  });
});

describe("reciprocalRankFusion", () => {
  it("boosts ids that appear in multiple lists", () => {
    const scores = reciprocalRankFusion(
      [
        ["a", "b", "c"],
        ["b", "a", "d"],
      ],
      60,
    );
    expect(scores.get("a")!).toBeGreaterThan(scores.get("c")!);
    expect(scores.get("b")!).toBeGreaterThan(scores.get("d")!);
  });
});

describe("rerankHybridCandidates", () => {
  it("prefers FTS+vector agreement and lexical fit over weak vector-only hits", () => {
    const vector = [
      hit({
        id: "weak",
        similarity: 0.9,
        title: "Kitchen baker",
        category: "operations",
        skills_text: "bread",
        content: "sourdough",
      }),
      hit({
        id: "good",
        similarity: 0.55,
        title: "Frontend React Developer",
        category: "engineering",
        skills_text: "React TypeScript",
        content: "UI",
      }),
    ];
    const fts = [
      hit({
        id: "good",
        similarity: 0.8,
        title: "Frontend React Developer",
        category: "engineering",
        skills_text: "React TypeScript",
        content: "UI",
      }),
    ];

    const ranked = rerankHybridCandidates(vector, fts, {
      query: "Frontend React TypeScript",
      limit: 2,
    });

    expect(ranked[0]?.id).toBe("good");
    expect(ranked).toHaveLength(2);
  });

  it("still ranks typo queries toward engineering via lexical overlap", () => {
    const vector = [
      hit({
        id: "eng",
        similarity: 0.4,
        title: "Frontend React TypeScript developer",
        category: "engineering",
        skills_text: "React, TypeScript",
      }),
      hit({
        id: "fin",
        similarity: 0.45,
        title: "Financial analyst",
        category: "finance",
        skills_text: "Excel budgeting",
      }),
    ];

    const ranked = rerankHybridCandidates(vector, [], {
      query: "Frntend Reakt TypeScrpt develper",
      limit: 2,
    });

    expect(ranked[0]?.id).toBe("eng");
  });
});
