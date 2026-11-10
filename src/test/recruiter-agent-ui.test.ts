import { describe, expect, it } from "vitest";
import {
  detectRecruiterChatIntent,
  extractJobTitleHint,
  extractSearchTokens,
  formatOwnedJobsReply,
  formatRankedApplicantsReply,
  htmlToEditablePlain,
  isListJobsWithApplicantsQuestion,
  isListOwnedJobsQuestion,
  isProcessHelpQuestion,
  isShortlistishQuestion,
  matchOwnedJobByTitle,
  normalizeRecruiterChatTurn,
  parseOutreachAgentResult,
  parseShortlistAgentResult,
  parseSupervisedAgentMessage,
  rankApplicantsByProfileAndResume,
  rankOwnedJobsByQuery,
  suggestJobsWithApplicants,
} from "@/lib/ai/recruiter-agent-ui";

describe("parseShortlistAgentResult", () => {
  it("parses needs_confirm proposal", () => {
    const parsed = parseShortlistAgentResult({
      ok: true,
      status: "needs_confirm",
      applicationId: "app-1",
      plannedStatus: "shortlisted",
      message: "Confirm to mark this applicant as shortlisted.",
    });
    expect(parsed).toEqual({
      kind: "shortlist",
      applicationId: "app-1",
      plannedStatus: "shortlisted",
      message: "Confirm to mark this applicant as shortlisted.",
      needsConfirm: true,
    });
  });

  it("parses updated success", () => {
    const parsed = parseShortlistAgentResult({
      ok: true,
      status: "updated",
      applicationId: "app-1",
      plannedStatus: "shortlisted",
      message: "Application shortlisted.",
    });
    expect(parsed.kind).toBe("shortlist");
    if (parsed.kind === "shortlist") {
      expect(parsed.needsConfirm).toBe(false);
      expect(parsed.plannedStatus).toBe("shortlisted");
    }
  });

  it("parses forbidden ownership errors", () => {
    const parsed = parseShortlistAgentResult({
      ok: false,
      code: "forbidden",
      message: "You can only shortlist applicants for jobs you own.",
    });
    expect(parsed).toEqual({
      kind: "error",
      code: "forbidden",
      message: "You can only shortlist applicants for jobs you own.",
    });
  });
});

describe("parseOutreachAgentResult", () => {
  it("extracts subject and html from campaign preview", () => {
    const parsed = parseOutreachAgentResult({
      ok: true,
      message: "Outreach draft created. Review in CRM before sending.",
      campaign: {
        name: "Outreach: Backend Engineer",
        subject: "Opportunity: Backend Engineer",
        htmlBody: "<p>Hi candidate,</p>",
      },
      preview: {
        subject: "Opportunity: Backend Engineer",
        html: "<p>Hi candidate,</p>",
        ready: false,
        blockers: ["Audience segment is required"],
      },
    });
    expect(parsed.kind).toBe("outreach");
    if (parsed.kind === "outreach") {
      expect(parsed.subject).toBe("Opportunity: Backend Engineer");
      expect(parsed.htmlBody).toContain("Hi candidate");
      expect(parsed.campaignName).toBe("Outreach: Backend Engineer");
    }
  });

  it("parses forbidden draft failures", () => {
    const parsed = parseOutreachAgentResult({
      ok: false,
      code: "forbidden",
      message: "You can only draft outreach for jobs you own.",
    });
    expect(parsed).toEqual({
      kind: "error",
      code: "forbidden",
      message: "You can only draft outreach for jobs you own.",
    });
  });
});

describe("htmlToEditablePlain", () => {
  it("strips simple tags for local edit", () => {
    expect(htmlToEditablePlain("<p>Hi <strong>Alex</strong>,</p><p>Join us.</p>")).toBe(
      "Hi Alex,\n\nJoin us.",
    );
  });
});

describe("detectRecruiterChatIntent", () => {
  it("detects shortlist, draft, list, and noisy browse intents", () => {
    expect(detectRecruiterChatIntent("Propose shortlist for the selected applicant")).toBe(
      "shortlist",
    );
    expect(detectRecruiterChatIntent("shortlist from ai enginners")).toBe("shortlist");
    expect(detectRecruiterChatIntent("short list candiate from software")).toBe("shortlist");
    expect(detectRecruiterChatIntent("best candidate for software")).toBe("shortlist");
    expect(detectRecruiterChatIntent("how do you shortlist?")).toBe("help");
    expect(detectRecruiterChatIntent("which process do you follow to shortlist?")).toBe("help");
    expect(detectRecruiterChatIntent("Draft outreach for this job")).toBe("draft_outreach");
    expect(detectRecruiterChatIntent("show my own jobs?")).toBe("list_jobs");
    expect(detectRecruiterChatIntent("is this is my own jobs?")).toBe("list_jobs");
    expect(detectRecruiterChatIntent("List my jobs with applicants")).toBe("list_jobs");
    expect(detectRecruiterChatIntent("Show applicants for this job")).toBe("list_applicants");
    expect(detectRecruiterChatIntent("ai enginners somehow")).toBe("browse");
    expect(isProcessHelpQuestion("how do you shortlist?")).toBe(true);
    expect(isShortlistishQuestion("how do you shortlist?")).toBe(false);
  });
});

describe("owned job chat helpers", () => {
  it("recognizes owned-job list questions", () => {
    expect(isListOwnedJobsQuestion("show my own jobs?")).toBe(true);
    expect(isListOwnedJobsQuestion("are these my jobs")).toBe(true);
    expect(isListOwnedJobsQuestion("show applicants")).toBe(false);
    expect(isListJobsWithApplicantsQuestion("List my jobs with applicants")).toBe(true);
    expect(isListOwnedJobsQuestion("List my jobs with applicants")).toBe(true);
    expect(isListJobsWithApplicantsQuestion("Show applicants for this job")).toBe(false);
  });

  it("formats owned jobs with optional applicant counts", () => {
    const jobs = [
      { title: "senior labor", status: "approved", applicantCount: 0 },
      { title: "Software Developer", status: "approved", applicantCount: 2 },
    ];
    expect(formatOwnedJobsReply(jobs)).toMatch(/senior labor \(approved\)/);
    expect(formatOwnedJobsReply(jobs, { includeApplicantCounts: true })).toMatch(
      /Software Developer \(approved\) — 2 applicants/,
    );
    expect(suggestJobsWithApplicants(jobs)).toMatch(/Software Developer/);
    expect(suggestJobsWithApplicants([{ title: "Empty", applicantCount: 0 }])).toMatch(
      /None of your owned jobs/,
    );
  });

  it("normalizes legacy viaSupervisor history turns", () => {
    const legacy = normalizeRecruiterChatTurn({
      id: "1",
      role: "assistant",
      text: "hi",
      viaSupervisor: true,
    } as never);
    expect(legacy.role === "assistant" && legacy.source).toBe("supervisor");
    const local = normalizeRecruiterChatTurn({
      id: "2",
      role: "assistant",
      text: "hi",
      source: "local",
    });
    expect(local.role === "assistant" && local.source).toBe("local");
  });

  it("extracts job title hints and fuzzy-matches owned jobs", () => {
    expect(extractJobTitleHint("shortlist from ai enginners")).toBe("ai enginners");
    expect(extractJobTitleHint("short list candiate from software")).toMatch(/software/i);
    expect(isShortlistishQuestion("short list candiate from software")).toBe(true);
    const jobs = [
      { id: "1", title: "Software Developer" },
      { id: "2", title: "AI enginners" },
      { id: "3", title: "marketing Head" },
    ];
    expect(matchOwnedJobByTitle(jobs, "ai enginners")?.id).toBe("2");
    expect(matchOwnedJobByTitle(jobs, "software")?.id).toBe("1");
    expect(rankOwnedJobsByQuery(jobs, "messy software pls")[0]?.job.id).toBe("1");
    expect(extractSearchTokens("pls find ai eng").length).toBeGreaterThan(0);
    expect(isShortlistishQuestion("who should I shortlist")).toBe(true);
  });

  it("ranks applicants from profile cover note and resume signals", () => {
    const ranked = rankApplicantsByProfileAndResume(
      [
        {
          id: "a1",
          status: "applied",
          cover_note: "I love React and TypeScript",
          resume_file_name: "priya-react.pdf",
          resume_storage_path: "resumes/x.pdf",
          profiles: { full_name: "Priya Das", email: "p@example.com" },
          jobs: { id: "j1", title: "Software Developer" },
        },
        {
          id: "a2",
          status: "applied",
          cover_note: null,
          profiles: { full_name: "Other Person", email: "o@example.com" },
          jobs: { id: "j1", title: "Software Developer" },
        },
      ],
      "shortlist react developer",
      { title: "Software Developer", description: "React TypeScript" },
    );
    expect(ranked[0]?.applicant.id).toBe("a1");
    expect(formatRankedApplicantsReply(ranked, "Software Developer")).toMatch(/Priya Das/);
  });
});

describe("parseSupervisedAgentMessage", () => {
  it("prefers message then answer", () => {
    expect(parseSupervisedAgentMessage({ ok: true, message: "Hello" })).toBe("Hello");
    expect(parseSupervisedAgentMessage({ ok: true, answer: "From supervisor" })).toBe(
      "From supervisor",
    );
  });
});
