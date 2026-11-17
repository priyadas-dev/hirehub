/**
 * Realistic multi-agent workflow tests (Supervisor → Discovery / Application tools).
 * Uses held-out style NL phrases — not a closed keyword whitelist for production routing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractApplyJobId,
  extractIdentityHintsFromQuestion,
  extractSaveJobId,
  looksLikeApplyIntent,
  looksLikeSaveJobIntent,
  runApplicationAgent,
  runSaveJobTool,
} from "@/lib/ai/agents/application";
import { runSupervisor } from "@/lib/ai/agents/supervisor";
import { createServerAgentMemory } from "@/lib/ai/memory/server-memory";
import { classifyAssistantIntent } from "@/lib/ai/assistant-intent";
import { looksLikeIndustryOrRoleJobAsk } from "@/lib/ai/live-query-understand";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";

const USER = "11111111-1111-4111-8111-111111111111";
const JOB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const livePool: LiveApprovedJob[] = [
  {
    id: JOB_A,
    title: "Assistant NOC Engineer",
    description: "Network operations",
    location: "Sylhet",
    status: "approved",
    company_id: "co-1",
    created_at: "2026-11-01T00:00:00.000Z",
    company_name: "Manor IT",
    job_type: "full_time",
  },
  {
    id: JOB_B,
    title: "Software Engineer",
    description: "Laravel PHP MySQL",
    location: "Sylhet",
    status: "approved",
    company_id: "co-2",
    created_at: "2026-11-01T00:00:00.000Z",
    company_name: "TechnoNext",
    job_type: "full_time",
  },
  {
    id: JOB_C,
    title: "Finance Analyst",
    description: "Banking and accounting",
    location: "Dhaka",
    status: "approved",
    company_id: "co-3",
    created_at: "2026-11-01T00:00:00.000Z",
    company_name: "FinCorp",
    job_type: "full_time",
  },
];

const recent = livePool.map((j) => ({
  id: j.id,
  title: j.title,
  company_name: j.company_name,
  location: j.location,
  description: j.description,
  job_type: j.job_type,
}));

describe("Multi-agent — noisy discovery intent (held-out style)", () => {
  it("routes diverse NL job asks to Discovery searchJobs", () => {
    const phrases = [
      "find me it job",
      "i need a software work",
      "finace job",
      "any engineering vacancy?",
      "show me jobs for fresher",
      "what about banking?",
      "find something related to programming",
    ];
    for (const q of phrases) {
      expect(looksLikeIndustryOrRoleJobAsk(q) || classifyAssistantIntent(q).searchJobs).toBe(true);
    }
  });
});

describe("Multi-agent — conversational Save / Apply resolution", () => {
  it("detects noisy save/apply intents", () => {
    expect(looksLikeSaveJobIntent("saved first one")).toBe(true);
    expect(looksLikeSaveJobIntent("keep this job for later")).toBe(true);
    expect(looksLikeSaveJobIntent("I like the second job")).toBe(true);
    expect(looksLikeSaveJobIntent("bookmark this one")).toBe(true);
    expect(looksLikeApplyIntent("apply Software Engineer")).toBe(true);
    expect(looksLikeApplyIntent("apply for that job")).toBe(true);
    expect(looksLikeApplyIntent("apply to the first job")).toBe(true);
    expect(looksLikeApplyIntent("now apply in software developtre")).toBe(true);
    expect(looksLikeApplyIntent("sudu resume ase now applied in the job")).toBe(true);
    expect(looksLikeApplyIntent("apply")).toBe(true);
    expect(looksLikeApplyIntent("here is the resume")).toBe(true);
    expect(looksLikeApplyIntent("How do I apply in general?")).toBe(false);
  });

  it("resolves ordinal / title / this-one against recent cards", () => {
    expect(extractSaveJobId({ question: "saved first one", recentJobs: recent })).toBe(JOB_A);
    expect(extractApplyJobId({ question: "apply Software Engineer", recentJobs: recent })).toBe(
      JOB_B,
    );
    expect(extractApplyJobId({ question: "apply to that job", recentJobs: recent })).toBe(JOB_A);
    expect(extractSaveJobId({ question: "I like the second job", recentJobs: recent })).toBe(JOB_B);
    expect(
      extractApplyJobId({ question: "now apply in software developtre", recentJobs: recent }),
    ).toBe(JOB_B);
    expect(
      extractApplyJobId({ question: "sudu resume ase now applied in the job", recentJobs: recent }),
    ).toBe(JOB_A);
  });
});

describe("Multi-agent — Supervisor tool execution (not text-only)", () => {
  const memory = createServerAgentMemory({ isolated: true });

  beforeEach(() => {
    memory._resetForTests();
  });

  it("Save Job calls the real save tool for conversational reference", async () => {
    const runSaveJobTool = vi.fn(async ({ jobId }: { jobId: string }) => ({
      ok: true as const,
      status: "saved" as const,
      savedJobId: "saved-1",
      jobId,
      title: recent.find((j) => j.id === jobId)?.title ?? "Job",
      message: "Saved.",
    }));

    memory.rememberRecentJobs(USER, "conv-1", recent);

    const result = await runSupervisor(
      { question: "saved first one", recentJobs: recent },
      {
        role: "seeker",
        userId: USER,
        conversationId: "conv-1",
        memory,
        listLiveJobs: async () => ({ ok: true, jobs: livePool }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runSaveJobTool,
        runLegacyPipeline: async () => {
          throw new Error("legacy must not run for save");
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(runSaveJobTool).toHaveBeenCalledTimes(1);
    expect(runSaveJobTool.mock.calls[0]?.[0]?.jobId).toBe(JOB_A);
    if (result.ok) {
      expect(result.model).toBe("application-agent");
      expect(result.saveOutcome?.status).toBe("saved");
    }
  });

  it("Apply proposes Confirm without inserting; Confirm inserts only with resume", async () => {
    const insert = vi.fn(async () => ({
      data: { id: "app-1" },
      error: null as { code?: string; message: string } | null,
    }));

    const applyClient = {
      findApprovedJob: async (id: string) => ({
        data: { id, status: "approved", application_deadline: null },
        error: null,
      }),
      findExistingApplication: async () => ({ data: null, error: null }),
      insertApplication: insert,
    };

    const noResume = await runApplicationAgent(
      { jobId: JOB_B, jobTitle: "Software Engineer", confirm: true },
      {
        seekerId: USER,
        applyClient,
        isDeadlinePassed: () => false,
        loadSeekerResume: async () => ({
          fullName: "Priya Das",
          email: "priya@example.com",
        }),
      },
    );
    expect(noResume.ok).toBe(false);
    if (!noResume.ok) expect(noResume.message).toMatch(/resume/i);
    expect(insert).not.toHaveBeenCalled();

    const pending = await runApplicationAgent(
      { jobId: JOB_B, jobTitle: "Software Engineer", confirm: false },
      {
        seekerId: USER,
        applyClient,
        isDeadlinePassed: () => false,
        loadSeekerResume: async () => ({
          fullName: "Priya Das",
          email: "priya@example.com",
          resumeStoragePath: `${USER}/cv.pdf`,
        }),
      },
    );
    expect(pending.ok && pending.status === "needs_confirm").toBe(true);
    expect(insert).not.toHaveBeenCalled();

    const confirmed = await runApplicationAgent(
      { jobId: JOB_B, jobTitle: "Software Engineer", confirm: true },
      {
        seekerId: USER,
        applyClient,
        isDeadlinePassed: () => false,
        assertResumeStoragePath: (path, id) => {
          if (!path.startsWith(`${id}/`)) throw new Error("bad path");
        },
        loadSeekerResume: async () => ({
          fullName: "Priya Das",
          email: "priya@example.com",
          resumeStoragePath: `${USER}/cv.pdf`,
          resumeFileName: "cv.pdf",
        }),
      },
    );
    expect(confirmed.ok && confirmed.status === "created").toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("Supervisor routes apply Software Engineer to Application (not legacy advice)", async () => {
    const runApplicationAgentFn = vi.fn(async () => ({
      ok: true as const,
      status: "needs_confirm" as const,
      pendingApply: {
        jobId: JOB_B,
        title: "Software Engineer",
        requiresConfirm: true as const,
      },
      message: "Confirm to apply.",
      insertsAttempted: 0 as const,
    }));

    const result = await runSupervisor(
      { question: "apply Software Engineer", recentJobs: recent },
      {
        role: "seeker",
        userId: USER,
        conversationId: "conv-apply",
        memory,
        listLiveJobs: async () => ({ ok: true, jobs: livePool }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runApplicationAgent: runApplicationAgentFn,
        runLegacyPipeline: async () => {
          throw new Error("legacy must not answer apply");
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(runApplicationAgentFn).toHaveBeenCalled();
    expect(runApplicationAgentFn.mock.calls[0]?.[0]?.jobId).toBe(JOB_B);
    expect(runApplicationAgentFn.mock.calls[0]?.[0]?.confirm).toBe(false);
    if (result.ok) {
      expect(result.pendingApply?.jobId).toBe(JOB_B);
      expect(result.supervisor?.routedTo).toBe("application");
    }
  });

  it("Supervisor routes noisy 'apply in software developtre' to Application", async () => {
    const runApplicationAgentFn = vi.fn(async () => ({
      ok: true as const,
      status: "needs_confirm" as const,
      pendingApply: {
        jobId: JOB_B,
        title: "Software Engineer",
        requiresConfirm: true as const,
      },
      message: "I can apply. Resume alone is enough.",
      insertsAttempted: 0 as const,
    }));

    const result = await runSupervisor(
      { question: "now apply in software developtre", recentJobs: recent },
      {
        role: "seeker",
        userId: USER,
        conversationId: "conv-apply-typo",
        memory,
        listLiveJobs: async () => ({ ok: true, jobs: livePool }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runApplicationAgent: runApplicationAgentFn,
        runLegacyPipeline: async () => {
          throw new Error("legacy must not answer apply in developtre");
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(runApplicationAgentFn).toHaveBeenCalled();
    expect(runApplicationAgentFn.mock.calls[0]?.[0]?.jobId).toBe(JOB_B);
    if (result.ok) expect(result.supervisor?.routedTo).toBe("application");
  });

  it("Save tool failure is reported honestly (no fake success)", async () => {
    const result = await runSaveJobTool(
      { jobId: JOB_A, jobTitle: "NOC" },
      {
        seekerId: USER,
        saveClient: {
          findApprovedJob: async () => ({ data: { id: JOB_A, title: "NOC" }, error: null }),
          findExistingSavedJob: async () => ({ data: null, error: null }),
          insertSavedJob: async () => ({
            data: null,
            error: { message: "db down", code: "XX000" },
          }),
        },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });
});

/**
 * Final verification — exact workflows requested for ship check.
 * Fake DB clients record inserts so we verify real tool execution, not chat text.
 */
describe("Multi-agent — final workflow verification", () => {
  const memory = createServerAgentMemory({ isolated: true });

  beforeEach(() => {
    memory._resetForTests();
  });

  function createSaveDb() {
    const rows = new Map<string, { id: string; seekerId: string; jobId: string }>();
    return {
      rows,
      client: {
        async findApprovedJob(jobId: string) {
          const job = livePool.find((j) => j.id === jobId);
          return { data: job ? { id: job.id, title: job.title } : null, error: null };
        },
        async findExistingSavedJob(jobId: string, seekerId: string) {
          const hit = rows.get(`${seekerId}:${jobId}`);
          return { data: hit ? { id: hit.id } : null, error: null };
        },
        async insertSavedJob(row: { seeker_id: string; job_id: string }) {
          const key = `${row.seeker_id}:${row.job_id}`;
          const id = `saved-${rows.size + 1}`;
          rows.set(key, { id, seekerId: row.seeker_id, jobId: row.job_id });
          return { data: { id }, error: null };
        },
      },
    };
  }

  function createApplyDb() {
    const rows = new Map<string, { id: string; jobId: string; seekerId: string }>();
    return {
      rows,
      client: {
        async findApprovedJob(id: string) {
          return {
            data: { id, status: "approved", application_deadline: null },
            error: null,
          };
        },
        async findExistingApplication(jobId: string, seekerId: string) {
          const hit = rows.get(`${jobId}:${seekerId}`);
          return { data: hit ? { id: hit.id } : null, error: null };
        },
        async insertApplication(row: { job_id: string; seeker_id: string }) {
          const key = `${row.job_id}:${row.seeker_id}`;
          const id = `app-${rows.size + 1}`;
          rows.set(key, { id, jobId: row.job_id, seekerId: row.seeker_id });
          return { data: { id }, error: null };
        },
      },
    };
  }

  it("1) noisy / unseen queries route to Discovery (held-out phrases)", async () => {
    const listLiveJobs = vi.fn(async (q: string) => {
      // Simulate ILIKE relevance after typo normalize (finace → finance in real path)
      const n = q.toLowerCase().replace(/\bfinace\b/g, "finance");
      if (/financ|bank/.test(n)) {
        return {
          ok: true as const,
          jobs: livePool.filter((j) => /finance|bank/i.test(`${j.title} ${j.description}`)),
        };
      }
      if (/software|program|\bit\b|engineer|fresher/.test(n)) {
        return {
          ok: true as const,
          jobs: livePool.filter((j) =>
            /software|engineer|noc|program|laravel/i.test(`${j.title} ${j.description}`),
          ),
        };
      }
      return { ok: true as const, jobs: livePool };
    });

    for (const q of ["finace job", "find me it job", "what about banking?"]) {
      const result = await runSupervisor(
        { question: q },
        {
          role: "seeker",
          userId: USER,
          conversationId: `disc-${q}`,
          memory,
          listLiveJobs,
          retrieveCorpus: async () => ({ ok: true, matches: [] }),
          runLegacyPipeline: async () => {
            throw new Error(`legacy must not run for discovery: ${q}`);
          },
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.supervisor?.routedTo).toBe("discovery");
        expect(result.liveCitations?.length ?? 0).toBeGreaterThan(0);
        if (/financ|bank|finace/i.test(q)) {
          expect(
            result.liveCitations?.every((c) =>
              /finance|bank|analyst/i.test(`${c.title} ${c.description ?? ""}`),
            ),
          ).toBe(true);
        }
      }
    }
  });

  it('2) "save this one" executes Save tool and inserts into DB store', async () => {
    const db = createSaveDb();
    memory.rememberRecentJobs(USER, "save-this", recent);

    const result = await runSupervisor(
      { question: "save this one", recentJobs: recent },
      {
        role: "seeker",
        userId: USER,
        conversationId: "save-this",
        memory,
        listLiveJobs: async () => ({ ok: true, jobs: livePool }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runSaveJobTool: (input) =>
          runSaveJobTool(input, { seekerId: USER, saveClient: db.client }),
        runLegacyPipeline: async () => {
          throw new Error("legacy must not run for save this one");
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(db.rows.size).toBe(1);
    expect(db.rows.has(`${USER}:${JOB_A}`)).toBe(true);
    if (result.ok) {
      expect(result.saveOutcome?.jobId).toBe(JOB_A);
      expect(result.saveOutcome?.status).toBe("saved");
      expect(result.answer).toMatch(/saved/i);
    }
  });

  it('3+5) "apply for this job" proposes Confirm and does not insert', async () => {
    const db = createApplyDb();
    memory.rememberRecentJobs(USER, "apply-this", recent);

    const result = await runSupervisor(
      { question: "apply for this job", recentJobs: recent },
      {
        role: "seeker",
        userId: USER,
        conversationId: "apply-this",
        memory,
        listLiveJobs: async () => ({ ok: true, jobs: livePool }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runApplicationAgent: (input) =>
          runApplicationAgent(input, {
            seekerId: USER,
            applyClient: db.client,
            isDeadlinePassed: () => false,
            loadSeekerResume: async () => ({
              fullName: "Priya Das",
              email: "priya@example.com",
              resumeStoragePath: `${USER}/cv.pdf`,
            }),
            assertResumeStoragePath: (path, id) => {
              if (!path.startsWith(`${id}/`)) throw new Error("bad path");
            },
          }),
        runLegacyPipeline: async () => {
          throw new Error("legacy must not run for apply for this job");
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(db.rows.size).toBe(0);
    if (result.ok) {
      expect(result.pendingApply?.jobId).toBe(JOB_A);
      expect(result.pendingApply?.requiresConfirm).toBe(true);
      expect(result.answer).toMatch(/confirm/i);
    }
  });

  it("4) Apply Confirm without resume asks for upload and does not insert", async () => {
    const db = createApplyDb();
    const result = await runApplicationAgent(
      { jobId: JOB_B, jobTitle: "Software Engineer", confirm: true },
      {
        seekerId: USER,
        applyClient: db.client,
        isDeadlinePassed: () => false,
        loadSeekerResume: async () => ({
          fullName: "Priya Das",
          email: "priya@example.com",
        }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/resume/i);
      expect(result.message).toMatch(/portfolio is not required/i);
    }
    expect(db.rows.size).toBe(0);
  });

  it("parses name/email hints from an edited apply message", () => {
    const hints = extractIdentityHintsFromQuestion(
      "apply this job. my name is Priya Das email priya@example.com",
    );
    expect(hints.fullName).toMatch(/Priya Das/i);
    expect(hints.email).toBe("priya@example.com");
    expect(extractIdentityHintsFromQuestion("Dibyo Das.").fullName).toBe("Dibyo Das");
    expect(
      extractIdentityHintsFromQuestion("mail is my profile mail").preferAccountEmail,
    ).toBe(true);
  });

  it("Confirm apply uses auth/profile email when chat only provided a name", async () => {
    const db = createApplyDb();
    const result = await runApplicationAgent(
      {
        jobId: JOB_B,
        jobTitle: "Software Engineer",
        confirm: true,
        question: "Dibyo Das\nmail is my profile mail\nPlease confirm apply",
        conversationContext: "User: Dibyo Das\nAssistant: need email",
      },
      {
        seekerId: USER,
        applyClient: db.client,
        isDeadlinePassed: () => false,
        assertResumeStoragePath: (path, id) => {
          if (!path.startsWith(`${id}/`)) throw new Error("bad path");
        },
        loadSeekerResume: async () => ({
          // Blank profile name, but account email available (auth fallback).
          email: "seeker@example.com",
          resumeStoragePath: `${USER}/cv.pdf`,
          resumeFileName: "cv.pdf",
        }),
        persistSeekerIdentity: async () => undefined,
      },
    );
    expect(result.ok && result.status === "created").toBe(true);
    expect(db.rows.size).toBe(1);
  });

  it("Confirm apply accepts name/email from question when profile is blank", async () => {
    const db = createApplyDb();
    const result = await runApplicationAgent(
      {
        jobId: JOB_B,
        jobTitle: "Software Engineer",
        confirm: true,
        question: "apply this job. my name is Priya Das email priya@example.com",
      },
      {
        seekerId: USER,
        applyClient: db.client,
        isDeadlinePassed: () => false,
        assertResumeStoragePath: (path, id) => {
          if (!path.startsWith(`${id}/`)) throw new Error("bad path");
        },
        loadSeekerResume: async () => ({
          resumeStoragePath: `${USER}/cv.pdf`,
          resumeFileName: "cv.pdf",
        }),
      },
    );
    expect(result.ok && result.status === "created").toBe(true);
    expect(db.rows.size).toBe(1);
  });

  it("4b) Chat resume alone is enough — propose mentions no portfolio; Confirm persists via ensureChatResume", async () => {
    const db = createApplyDb();
    const ensureChatResume = vi.fn(async () => ({
      resumeStoragePath: `${USER}/chat-cv.pdf`,
      resumeFileName: "Dibyo resume.pdf",
    }));

    const proposed = await runApplicationAgent(
      { jobId: JOB_B, jobTitle: "Software Engineer", confirm: false },
      {
        seekerId: USER,
        applyClient: db.client,
        isDeadlinePassed: () => false,
        hasChatResumeAttachment: true,
        ensureChatResume,
        loadSeekerResume: async () => ({
          fullName: "Priya Das",
          email: "priya@example.com",
        }),
      },
    );
    expect(proposed.ok && proposed.status === "needs_confirm").toBe(true);
    if (proposed.ok) {
      expect(proposed.message).toMatch(/resume/i);
      expect(proposed.message).toMatch(/no portfolio|optional/i);
      expect(proposed.message).not.toMatch(/GitHub|portfolio required/i);
    }
    expect(db.rows.size).toBe(0);
    expect(ensureChatResume).not.toHaveBeenCalled();

    const confirmed = await runApplicationAgent(
      { jobId: JOB_B, jobTitle: "Software Engineer", confirm: true },
      {
        seekerId: USER,
        applyClient: db.client,
        isDeadlinePassed: () => false,
        hasChatResumeAttachment: true,
        ensureChatResume,
        assertResumeStoragePath: (path, id) => {
          if (!path.startsWith(`${id}/`)) throw new Error("bad path");
        },
        loadSeekerResume: async () => ({
          fullName: "Priya Das",
          email: "priya@example.com",
        }),
      },
    );
    expect(ensureChatResume).toHaveBeenCalledTimes(1);
    expect(confirmed.ok && confirmed.status === "created").toBe(true);
    expect(db.rows.size).toBe(1);
  });

  it("6) Confirm with resume inserts application into DB store", async () => {
    const db = createApplyDb();
    const result = await runSupervisor(
      {
        question: "apply for this job",
        recentJobs: recent,
        confirmApply: true,
        applyJobId: JOB_A,
      },
      {
        role: "seeker",
        userId: USER,
        conversationId: "apply-confirm",
        memory,
        listLiveJobs: async () => ({ ok: true, jobs: livePool }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runApplicationAgent: (input) =>
          runApplicationAgent(input, {
            seekerId: USER,
            applyClient: db.client,
            isDeadlinePassed: () => false,
            loadSeekerResume: async () => ({
              fullName: "Priya Das",
              email: "priya@example.com",
              resumeStoragePath: `${USER}/cv.pdf`,
              resumeFileName: "cv.pdf",
            }),
            assertResumeStoragePath: (path, id) => {
              if (!path.startsWith(`${id}/`)) throw new Error("bad path");
            },
          }),
        runLegacyPipeline: async () => {
          throw new Error("legacy must not run for confirm apply");
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(db.rows.size).toBe(1);
    expect(db.rows.has(`${JOB_A}:${USER}`)).toBe(true);
    if (result.ok) {
      expect(result.applyOutcome?.status).toBe("created");
      expect(result.answer).toMatch(/submitted|already applied/i);
    }
  });

  it("7) follow-up first / second / this / that resolve correct job ids", () => {
    expect(extractSaveJobId({ question: "save the first job", recentJobs: recent })).toBe(JOB_A);
    expect(extractApplyJobId({ question: "apply to the second", recentJobs: recent })).toBe(JOB_B);
    expect(extractApplyJobId({ question: "apply for this job", recentJobs: recent })).toBe(JOB_A);
    expect(extractSaveJobId({ question: "save that one", recentJobs: recent })).toBe(JOB_A);
    expect(extractApplyJobId({ question: "apply for that job", recentJobs: recent })).toBe(JOB_A);
  });
});
