import { describe, expect, it } from "vitest";
import {
  applicantDisplayName,
  applyApplicantStatusFilter,
  detectRecruiterChatIntent,
  extractApplicantNameHint,
  extractApplicantNameHints,
  extractApplicantOrdinalRef,
  extractApplicantStatusFilter,
  extractJobTitleHint,
  extractMinYearsExperience,
  extractSearchTokens,
  extractTopNApplicants,
  isApplicantStatusFilterQuestion,
  isListApplicantsQuestion,
  formatOwnedJobsReply,
  formatRankedApplicantsReply,
  htmlToEditablePlain,
  isConfirmShortlistQuestion,
  isListJobsWithApplicantsQuestion,
  isListOwnedJobsQuestion,
  isOfferDraftishQuestion,
  isOutreachDraftishQuestion,
  isProcessHelpQuestion,
  isShortlistishQuestion,
  isShortlistableApplicationStatus,
  matchApplicantsByNameHint,
  matchOwnedJobByTitle,
  preferShortlistableApplicants,
  normalizeRecruiterChatTurn,
  parseOutreachAgentResult,
  parseShortlistAgentResult,
  parseSupervisedAgentMessage,
  rankApplicantsByProfileAndResume,
  rankOwnedJobsByQuery,
  resolveApplicantChoiceFromRef,
  suggestJobsWithApplicants,
} from "@/lib/ai/recruiter-agent-ui";

describe("applicantDisplayName", () => {
  it("prefers trimmed full name, then email, then Applicant", () => {
    expect(applicantDisplayName({ full_name: "  Priya Das  ", email: "p@example.com" })).toBe(
      "Priya Das",
    );
    expect(applicantDisplayName({ full_name: "   ", email: "p@example.com" })).toBe("p@example.com");
    expect(applicantDisplayName({ full_name: null, email: null })).toBe("Applicant");
  });
});

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
    expect(detectRecruiterChatIntent("shortlis koushik Roy")).toBe("shortlist");
    expect(detectRecruiterChatIntent("best candidate for software")).toBe("shortlist");
    expect(detectRecruiterChatIntent("how do you shortlist?")).toBe("help");
    expect(detectRecruiterChatIntent("which process do you follow to shortlist?")).toBe("help");
    expect(detectRecruiterChatIntent("Draft outreach for this job")).toBe("draft_outreach");
    expect(detectRecruiterChatIntent("give a draft ouitreach")).toBe("draft_outreach");
    expect(detectRecruiterChatIntent("Make an offer for this candidate")).toBe("draft_outreach");
    expect(detectRecruiterChatIntent("Prepare an offer letter")).toBe("draft_outreach");
    expect(detectRecruiterChatIntent("Create an offer draft for him")).toBe("draft_outreach");
    expect(detectRecruiterChatIntent("Find me the best candidates")).toBe("shortlist");
    expect(detectRecruiterChatIntent("Select the best three applicants")).toBe("shortlist");
    expect(detectRecruiterChatIntent("Move him to shortlisted")).toBe("shortlist");
    expect(detectRecruiterChatIntent("What about the second candidate?")).toBe("shortlist");
    expect(detectRecruiterChatIntent("Find candidates with React experience")).toBe("shortlist");
    expect(detectRecruiterChatIntent("Show software engineers")).toBe("list_applicants");
    expect(
      detectRecruiterChatIntent("show the applicant who are not shortlisted"),
    ).toBe("list_applicants");
    expect(isApplicantStatusFilterQuestion("show applicants who are not shortlisted")).toBe(
      true,
    );
    expect(isListApplicantsQuestion("show the applicant who are not shortlisted")).toBe(true);
    expect(isShortlistishQuestion("show the applicant who are not shortlisted")).toBe(false);
    expect(extractApplicantStatusFilter("show who are not shortlisted")).toEqual({
      kind: "exclude",
      statuses: ["shortlisted"],
    });
    expect(
      applyApplicantStatusFilter(
        [
          { id: "1", status: "applied" },
          { id: "2", status: "shortlisted" },
          { id: "3", status: "rejected" },
        ],
        { kind: "exclude", statuses: ["shortlisted"] },
      ).map((a) => a.id),
    ).toEqual(["1", "3"]);
    expect(detectRecruiterChatIntent("show my own jobs?")).toBe("list_jobs");
    expect(detectRecruiterChatIntent("is this is my own jobs?")).toBe("list_jobs");
    expect(detectRecruiterChatIntent("List my jobs with applicants")).toBe("list_jobs");
    expect(detectRecruiterChatIntent("Show applicants for this job")).toBe("list_applicants");
    expect(detectRecruiterChatIntent("ai enginners somehow")).toBe("browse");
    expect(isProcessHelpQuestion("how do you shortlist?")).toBe(true);
    expect(isShortlistishQuestion("how do you shortlist?")).toBe(false);
    expect(isOfferDraftishQuestion("make an offer")).toBe(true);
    expect(isOutreachDraftishQuestion("Prepare an offer letter")).toBe(true);
  });

  it("resolves ordinals, top-N, and experience filters from NL", () => {
    expect(extractApplicantOrdinalRef("What about the second candidate?")).toEqual({
      kind: "index",
      index: 1,
    });
    expect(extractApplicantOrdinalRef("Shortlist this candidate")).toEqual({ kind: "pronoun" });
    expect(extractApplicantOrdinalRef("Move him to shortlisted")).toEqual({ kind: "pronoun" });
    expect(extractTopNApplicants("Select the best three applicants")).toBe(3);
    expect(extractMinYearsExperience("Show applicants with 2 years of experience")).toBe(2);
    const choices = [
      { applicationId: "a1", label: "A" },
      { applicationId: "a2", label: "B" },
      { applicationId: "a3", label: "C" },
    ];
    expect(resolveApplicantChoiceFromRef(choices, { kind: "index", index: 1 })?.applicationId).toBe(
      "a2",
    );
    expect(
      resolveApplicantChoiceFromRef(choices, { kind: "pronoun" }, "a3")?.applicationId,
    ).toBe("a3");
  });

  it("routes confirm typos to confirm_shortlist instead of owned-job browse dump", () => {
    expect(isConfirmShortlistQuestion("conifrm rajon")).toBe(true);
    expect(detectRecruiterChatIntent("conifrm rajon")).toBe("confirm_shortlist");
    expect(detectRecruiterChatIntent("confirm")).toBe("confirm_shortlist");
    expect(detectRecruiterChatIntent("yes")).toBe("confirm_shortlist");
    expect(extractApplicantNameHint("conifrm rajon")).toMatch(/rajon/i);
    expect(extractApplicantNameHint("confirm Rajon Dey")).toMatch(/Rajon/i);
    const hits = matchApplicantsByNameHint(
      [
        { id: "1", profiles: { full_name: "Dibyo Das", email: "d@x.com" } },
        { id: "3", profiles: { full_name: "Rajon Dey", email: "r@x.com" } },
      ],
      "rajon",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("3");
  });

  it("extracts applicant names from typo shortlist asks", () => {
    expect(extractApplicantNameHint("shortlis koushik Roy")).toMatch(/koushik/i);
    expect(extractApplicantNameHint("shortlist Dibyo Das")).toMatch(/Dibyo/i);
    expect(detectRecruiterChatIntent("shortliste koushik and priya")).toBe("shortlist");
    expect(extractApplicantNameHints("shortliste koushik and priya")).toEqual([
      "koushik",
      "priya",
    ]);
    expect(extractApplicantNameHint("shortlist koushik and priya")).toBe("koushik");
    expect(detectRecruiterChatIntent("show software developer applicant")).toBe("list_applicants");
    const hits = matchApplicantsByNameHint(
      [
        { id: "1", profiles: { full_name: "Koushik Roy", email: "k@x.com" } },
        { id: "2", profiles: { full_name: "Dibyo Das", email: "d@x.com" } },
        { id: "3", profiles: { full_name: "Priya Das", email: "p@x.com" } },
      ],
      "koushik Roy",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("1");
    expect(matchApplicantsByNameHint(
      [
        { id: "1", profiles: { full_name: "Koushik Roy", email: "k@x.com" } },
        { id: "3", profiles: { full_name: "Priya Das", email: "p@x.com" } },
      ],
      "priya",
    )[0]?.id).toBe("3");
  });

  it("does not match Dibyo via priya substring in email when Priya exists by name", () => {
    const hits = matchApplicantsByNameHint(
      [
        {
          id: "dibyo",
          profiles: {
            full_name: "Dibyo Das",
            email: "priya.das+testsee@sjinnovation.com",
          },
        },
        {
          id: "priya",
          profiles: {
            full_name: "Priya Das",
            email: "priyadas142307@gmail.com",
          },
        },
      ],
      "priya",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("priya");
  });

  it("prefers applied applications over already-shortlisted name duplicates", () => {
    expect(isShortlistableApplicationStatus("shortlisted")).toBe(false);
    expect(isShortlistableApplicationStatus("applied")).toBe(true);
    const preferred = preferShortlistableApplicants([
      { id: "s1", status: "shortlisted" },
      { id: "a1", status: "applied" },
      { id: "r1", status: "rejected" },
    ]);
    expect(preferred).toHaveLength(1);
    expect(preferred[0]?.id).toBe("a1");
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

  it("boosts applicants whose cover note meets requested years of experience", () => {
    const ranked = rankApplicantsByProfileAndResume(
      [
        {
          id: "junior",
          status: "applied",
          cover_note: "1 year of experience with HTML",
          profiles: { full_name: "Junior", email: "j@x.com" },
          jobs: { id: "j1", title: "Software Developer" },
        },
        {
          id: "mid",
          status: "applied",
          cover_note: "3 years of experience with React",
          profiles: { full_name: "Mid", email: "m@x.com" },
          jobs: { id: "j1", title: "Software Developer" },
        },
      ],
      "Show applicants with 2 years of experience",
      { title: "Software Developer" },
    );
    expect(ranked[0]?.applicant.id).toBe("mid");
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
