import { describe, expect, it } from "vitest";
import {
  classifyAssistantIntent,
  looksLikeGeneralQuestion,
  looksLikeJobSearch,
  looksLikeLearningGuidance,
  looksLikeResumeCompareRequest,
  looksLikeResumeMatchRequest,
  looksLikeResumeSkillsInventory,
  noLiveJobsMatchAnswer,
  shouldApplySessionSkills,
} from "@/lib/ai/assistant-intent";

describe("classifyAssistantIntent routing table", () => {
  const cases: Array<{ q: string; intent: string; searchJobs: boolean; skillRank?: boolean }> = [
    { q: "What is OOP?", intent: "general_knowledge", searchJobs: false },
    { q: "What is React?", intent: "general_knowledge", searchJobs: false },
    { q: "Explain React in simple words.", intent: "general_knowledge", searchJobs: false },
    { q: "Explain APIs with an example.", intent: "general_knowledge", searchJobs: false },
    {
      q: "What is the difference between Java and JavaScript?",
      intent: "general_knowledge",
      searchJobs: false,
    },
    {
      q: "I know C++. What language should I learn to improve?",
      intent: "learning_guidance",
      searchJobs: false,
    },
    {
      q: "What should I learn after C++?",
      intent: "learning_guidance",
      searchJobs: false,
    },
    {
      q: "How do I improve my programming skills?",
      intent: "learning_guidance",
      searchJobs: false,
    },
    {
      q: "How can I prepare for a software developer interview?",
      intent: "interview_prep",
      searchJobs: false,
    },
    {
      q: "How should I prepare for an interview?",
      intent: "interview_prep",
      searchJobs: false,
    },
    { q: "Can you improve my resume?", intent: "resume_improve", searchJobs: false },
    {
      q: "tell me about a ai job",
      intent: "job_search",
      searchJobs: true,
    },
    {
      q: "Tell me about remote software jobs",
      intent: "job_search",
      searchJobs: true,
    },
    {
      q: "Describe AI engineer openings",
      intent: "job_search",
      searchJobs: true,
    },
    {
      q: "Find me a software developer job.",
      intent: "job_search",
      searchJobs: true,
    },
    {
      q: "Show me full-time jobs in Dhaka.",
      intent: "job_search",
      searchJobs: true,
      skillRank: false,
    },
    {
      q: "in sylhet gimme jobs",
      intent: "job_search",
      searchJobs: true,
      skillRank: false,
    },
    {
      q: "jobs in Sylhet",
      intent: "job_search",
      searchJobs: true,
      skillRank: false,
    },
    {
      q: "Find jobs matching my resume",
      intent: "resume_match",
      searchJobs: true,
      skillRank: true,
    },
    {
      q: "Which of these jobs best matches my resume?",
      intent: "resume_compare",
      searchJobs: true,
      skillRank: true,
    },
    {
      q: "I know React, JavaScript and SQL. Find suitable jobs",
      intent: "job_search",
      searchJobs: true,
      skillRank: true,
    },
    {
      q: "I know React, JavaScript and SQL. Find suitable job",
      intent: "job_search",
      searchJobs: true,
      skillRank: true,
    },
    {
      q: "I know React. Find suitble jubs",
      intent: "job_search",
      searchJobs: true,
      skillRank: true,
    },
    {
      q: "What skills should I learn for this role?",
      intent: "learning_guidance",
      searchJobs: false,
    },
    {
      q: "Compare these two jobs.",
      intent: "followup_jobs",
      searchJobs: false,
    },
  ];

  for (const c of cases) {
    it(`classifies: ${c.q}`, () => {
      const result = classifyAssistantIntent(c.q);
      expect(result.intent).toBe(c.intent);
      expect(result.searchJobs).toBe(c.searchJobs);
      if (c.skillRank != null) expect(result.useSkillRanking).toBe(c.skillRank);
      if (!c.searchJobs) {
        expect(result.useLlmAnswer).toBe(true);
        expect(result.applySessionSkills).toBe(false);
        // Conversational intents skip corpus RAG so chat stays fast (no gte cold-start).
        expect(result.useCorpusRag).toBe(false);
      }
    });
  }

  it("does not treat skill mentions alone as job search", () => {
    expect(looksLikeJobSearch("I know C++. What language should I learn to improve?")).toBe(false);
    expect(looksLikeLearningGuidance("I know C++. What language should I learn to improve?")).toBe(
      true,
    );
    expect(looksLikeGeneralQuestion("What is OOP?")).toBe(true);
    expect(shouldApplySessionSkills("Show me full-time jobs in Dhaka.")).toBe(false);
    expect(shouldApplySessionSkills("Find jobs matching my resume")).toBe(true);
    expect(looksLikeResumeMatchRequest("Find jobs matching my resume")).toBe(true);
    expect(looksLikeResumeSkillsInventory("What skills did you find in my resume?")).toBe(true);
    expect(looksLikeResumeCompareRequest("Which of these jobs best matches my resume?")).toBe(true);
  });

  it("returns a single concise no-match message", () => {
    const msg = noLiveJobsMatchAnswer({ location: "Dhaka" });
    expect(msg).toMatch(/couldn't find any approved jobs matching those filters/i);
    expect(msg.split("I couldn't").length).toBe(2);
  });
});
