import { describe, expect, it, vi } from "vitest";
import {
  extractApplyJobId,
  looksLikeApplyIntent,
  looksLikeConfirmApplyIntent,
  looksLikeResumeDeliveryIntent,
  runApplicationAgent,
} from "@/lib/ai/agents/application";
import {
  draftRecruiterOutreach,
  planRecruiterShortlist,
  recruiterHandoffError,
} from "@/lib/ai/agents/recruiter";
import { runSupervisor } from "@/lib/ai/agents/supervisor";
import type { ApplyToJobClient, ApplyToJobRow } from "@/lib/apply-to-job";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const SEEKER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function createUniqueStore() {
  const rows = new Map<string, { id: string; row: ApplyToJobRow }>();
  let insertCalls = 0;

  const client: ApplyToJobClient = {
    async findApprovedJob(jobId) {
      return {
        data: {
          id: jobId,
          status: "approved",
          application_deadline: null,
          description: "Approved role",
        },
        error: null,
      };
    },
    async findExistingApplication(jobId, seekerId) {
      const hit = rows.get(`${jobId}:${seekerId}`);
      return { data: hit ? { id: hit.id } : null, error: null };
    },
    async insertApplication(row) {
      insertCalls += 1;
      const key = `${row.job_id}:${row.seeker_id}`;
      if (rows.has(key)) {
        return {
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        };
      }
      const id = `app-${rows.size + 1}`;
      rows.set(key, { id, row });
      return { data: { id }, error: null };
    },
  };

  return {
    client,
    get insertCalls() {
      return insertCalls;
    },
    get rowCount() {
      return rows.size;
    },
  };
}

describe("Phase 7 application agent — confirm gate", () => {
  it("detects apply intent", () => {
    expect(looksLikeApplyIntent("Please apply to this job")).toBe(true);
    expect(looksLikeApplyIntent("apply Software Engineer")).toBe(true);
    expect(looksLikeApplyIntent("apply to the first job")).toBe(true);
    expect(looksLikeApplyIntent("apply")).toBe(true);
    expect(looksLikeApplyIntent("apply now")).toBe(true);
    expect(looksLikeResumeDeliveryIntent("here is the resume.")).toBe(true);
    expect(looksLikeApplyIntent("here is the resume.")).toBe(true);
    expect(looksLikeApplyIntent("I attached my resume")).toBe(true);
    expect(looksLikeApplyIntent("What is React?")).toBe(false);
    expect(looksLikeApplyIntent("How do I apply in general?")).toBe(false);
  });

  it("detects chat confirm so Gemini cannot invent a fake submit", () => {
    expect(looksLikeConfirmApplyIntent("confirm")).toBe(true);
    expect(looksLikeConfirmApplyIntent("conifrm")).toBe(true);
    expect(looksLikeConfirmApplyIntent("yes")).toBe(true);
    expect(looksLikeConfirmApplyIntent("Please confirm apply")).toBe(true);
    expect(looksLikeConfirmApplyIntent(`Please confirm apply to job ${JOB_ID}`)).toBe(true);
    expect(looksLikeApplyIntent("confirm")).toBe(true);
    expect(looksLikeConfirmApplyIntent("show me software jobs")).toBe(false);
  });

  it("extracts applyJobId from payload, UUID in question, or ordinal", () => {
    expect(
      extractApplyJobId({
        question: "apply please",
        applyJobId: JOB_ID,
      }),
    ).toBe(JOB_ID);

    expect(
      extractApplyJobId({
        question: `Please apply to job ${JOB_ID}`,
      }),
    ).toBe(JOB_ID);

    expect(
      extractApplyJobId({
        question: "apply to the second job",
        recentJobs: [
          { id: JOB_ID, title: "A" },
          { id: JOB_ID_2, title: "B" },
        ],
      }),
    ).toBe(JOB_ID_2);
  });

  it("resolves noisy / partial titles from recent job cards", () => {
    const seId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
    const recent = [
      { id: JOB_ID, title: "Junior Software Developer", company_name: "TechnoNext" },
      { id: JOB_ID_2, title: "marketing Head", company_name: "Manor IT" },
      { id: seId, title: "Software Engineer", company_name: "TechnoNext" },
    ];
    expect(
      extractApplyJobId({
        question: "Please save this job Junior Software Develope",
        recentJobs: recent,
      }),
    ).toBe(JOB_ID);
    expect(
      extractApplyJobId({
        question: "Software Enginee save the job",
        recentJobs: recent,
      }),
    ).toBe(seId);
    // Ambiguous when two software titles both match strongly — ask, don't guess.
    expect(
      extractApplyJobId({
        question: "apply to the software job",
        recentJobs: recent,
      }),
    ).toBeNull();
  });

  it("unconfirmed apply attempts zero inserts", async () => {
    const store = createUniqueStore();
    const result = await runApplicationAgent(
      {
        jobId: JOB_ID,
        jobTitle: "React Engineer",
        confirm: false,
      },
      {
        seekerId: SEEKER_ID,
        applyClient: store.client,
        isDeadlinePassed: () => false,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("needs_confirm");
      expect(result.insertsAttempted).toBe(0);
      if (result.status === "needs_confirm") {
        expect(result.pendingApply.requiresConfirm).toBe(true);
        expect(result.pendingApply.jobId).toBe(JOB_ID);
      }
    }
    expect(store.insertCalls).toBe(0);
    expect(store.rowCount).toBe(0);
  });

  it("confirmed apply inserts once; duplicate is safe", async () => {
    const store = createUniqueStore();
    const deps = {
      seekerId: SEEKER_ID,
      applyClient: store.client,
      isDeadlinePassed: () => false,
    };

    const withResume = {
      ...deps,
      loadSeekerResume: async () => ({
        fullName: "Priya Das",
        email: "priya@example.com",
        resumeUrl: "https://example.com/resume.pdf",
      }),
    };

    const first = await runApplicationAgent(
      {
        jobId: JOB_ID,
        jobTitle: "React Engineer",
        confirm: true,
        coverNote: "I build web apps with React and TypeScript.",
      },
      withResume,
    );
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.status).toBe("created");
      expect(first.insertsAttempted).toBe(1);
    }
    expect(store.rowCount).toBe(1);

    const second = await runApplicationAgent(
      {
        jobId: JOB_ID,
        jobTitle: "React Engineer",
        confirm: true,
        coverNote: "I build web apps with React and TypeScript.",
      },
      withResume,
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.status).toBe("already_applied");
      expect(second.insertsAttempted).toBe(1);
    }
    expect(store.rowCount).toBe(1);
  });

  it("rejects resume storage path outside seeker folder", async () => {
    const store = createUniqueStore();
    const result = await runApplicationAgent(
      {
        jobId: JOB_ID,
        confirm: true,
        coverNote: "I build web apps with React and TypeScript.",
      },
      {
        seekerId: SEEKER_ID,
        applyClient: store.client,
        isDeadlinePassed: () => false,
        loadSeekerResume: async () => ({
          fullName: "Priya Das",
          email: "priya@example.com",
          resumeStoragePath: `${OTHER_ID}/resume.pdf`,
        }),
        assertResumeStoragePath: (path, seekerId) => {
          if (!path.startsWith(`${seekerId}/`)) {
            throw new Error("Resume storage path must belong to the signed-in seeker.");
          }
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.insertsAttempted).toBe(0);
    }
    expect(store.insertCalls).toBe(0);
  });
});

describe("Phase 7 application agent — supervisor routing", () => {
  it("returns pendingApply without calling apply when unconfirmed", async () => {
    const runApplication = vi.fn(async () => ({
      ok: true as const,
      status: "needs_confirm" as const,
      pendingApply: {
        jobId: JOB_ID,
        title: "React Engineer",
        requiresConfirm: true as const,
      },
      message: "Confirm to apply.",
      insertsAttempted: 0 as const,
    }));

    const result = await runSupervisor(
      {
        question: "Please apply to this job",
        applyJobId: JOB_ID,
        confirmApply: false,
        recentJobs: [{ id: JOB_ID, title: "React Engineer", location: "Dhaka" }],
      },
      {
        role: "seeker",
        userId: SEEKER_ID,
        runApplicationAgent: runApplication,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: async () => ({
          ok: true,
          answer: "legacy",
          insufficientContext: false,
          ragAvailable: false,
          liveJobsAvailable: false,
          soughtLiveJobs: false,
          corpusCitations: [],
          liveCitations: [],
          model: "legacy",
        }),
      },
    );

    expect(runApplication).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: JOB_ID, confirm: false }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model).toBe("application-agent");
      expect(result.pendingApply?.jobId).toBe(JOB_ID);
      expect(result.applyOutcome).toBeUndefined();
    }
  });
});

describe("Phase 7 recruiter agent — ownership", () => {
  it("denies shortlist for non-owned job", () => {
    const result = planRecruiterShortlist(
      {
        application: {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          jobId: JOB_ID,
          seekerId: SEEKER_ID,
          status: "applied",
          jobRecruiterId: OWNER_ID,
        },
        confirm: true,
      },
      { callerId: OTHER_ID, callerRole: "recruiter" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(recruiterHandoffError(result)?.code).toBe("forbidden");
    }
  });

  it("requires confirm before authorizing shortlist for owner", () => {
    const pending = planRecruiterShortlist(
      {
        application: {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          jobId: JOB_ID,
          seekerId: SEEKER_ID,
          status: "applied",
          jobRecruiterId: OWNER_ID,
        },
        confirm: false,
      },
      { callerId: OWNER_ID, callerRole: "recruiter" },
    );
    expect(pending.ok).toBe(true);
    if (pending.ok) expect(pending.status).toBe("needs_confirm");

    const authorized = planRecruiterShortlist(
      {
        application: {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          jobId: JOB_ID,
          seekerId: SEEKER_ID,
          status: "applied",
          jobRecruiterId: OWNER_ID,
        },
        confirm: true,
      },
      { callerId: OWNER_ID, callerRole: "recruiter" },
    );
    expect(authorized.ok).toBe(true);
    if (authorized.ok) {
      expect(authorized.status).toBe("authorized");
      expect(authorized.plannedStatus).toBe("shortlisted");
    }
  });

  it("rejects shortlist when applicant is already shortlisted", () => {
    const result = planRecruiterShortlist(
      {
        application: {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          jobId: JOB_ID,
          seekerId: SEEKER_ID,
          status: "shortlisted",
          jobRecruiterId: OWNER_ID,
        },
        confirm: true,
      },
      { callerId: OWNER_ID, callerRole: "recruiter" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.message).toMatch(/already shortlisted/i);
    }
  });

  it("denies outreach draft for non-owned job", () => {
    const result = draftRecruiterOutreach(
      {
        job: { id: JOB_ID, title: "React Engineer", recruiterId: OWNER_ID },
      },
      { callerId: OTHER_ID, callerRole: "recruiter" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("drafts outreach for owned job without silent send", () => {
    const result = draftRecruiterOutreach(
      {
        job: { id: JOB_ID, title: "React Engineer", recruiterId: OWNER_ID },
        contact: {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          recruiterId: OWNER_ID,
          email: "candidate@example.com",
          fullName: "Ada",
        },
        confirmSend: false,
      },
      { callerId: OWNER_ID, callerRole: "recruiter" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.campaign.recruiterId).toBe(OWNER_ID);
      expect(result.send).toBeUndefined();
      expect(result.preview.subject).toMatch(/React Engineer/);
    }
  });

  it("drafts offer letter with known terms and flags missing salary/joining", () => {
    const result = draftRecruiterOutreach(
      {
        job: {
          id: JOB_ID,
          title: "React Engineer",
          recruiterId: OWNER_ID,
          companyName: "TechnoNext",
          salaryRange: "80k-100k",
        },
        draftKind: "offer",
        applicantName: "Ada Lovelace",
        applicantEmail: "ada@example.com",
        confirmSend: false,
      },
      { callerId: OWNER_ID, callerRole: "recruiter" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.send).toBeUndefined();
      expect(result.preview.subject).toMatch(/Offer/i);
      expect(result.campaign.htmlBody).toMatch(/Ada Lovelace/);
      expect(result.campaign.htmlBody).toMatch(/80k-100k/);
      expect(result.campaign.htmlBody).toMatch(/joining date/i);
      expect(result.message).toMatch(/joining date/i);
      expect(result.message).toMatch(/Nothing was emailed/i);
    }
  });
});
