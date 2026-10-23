import { describe, expect, it } from "vitest";
import {
  extractSkillsFromQuestion,
  extractSkillsFromText,
  looksLikeResumeMatchRequest,
  mergeSkillLists,
} from "@/lib/ai/skill-extract";

describe("skill extraction", () => {
  it("extracts only skills that literally appear in resume text", () => {
    const text =
      "Experienced Software Developer with React, TypeScript, Laravel and Vue. Strong SQL skills.";
    const skills = extractSkillsFromText(text);
    expect(skills).toEqual(
      expect.arrayContaining(["React", "TypeScript", "Laravel", "Vue", "SQL"]),
    );
    expect(skills).not.toContain("Python");
    expect(skills).not.toContain("Kubernetes");
  });

  it("extracts skills from natural-language questions", () => {
    const skills = extractSkillsFromQuestion(
      "I know React, JavaScript and SQL. Find suitable jobs",
    );
    expect(skills).toEqual(expect.arrayContaining(["React", "JavaScript", "SQL"]));
  });

  it("merges skill lists without inventing unknown tokens", () => {
    expect(mergeSkillLists(["React"], ["made-up-skill"], ["python"])).toEqual(["React", "Python"]);
  });

  it("detects resume-based match requests", () => {
    expect(looksLikeResumeMatchRequest("Show me jobs that match based on my resume")).toBe(true);
    expect(looksLikeResumeMatchRequest("What skills should I learn?")).toBe(false);
  });
});
