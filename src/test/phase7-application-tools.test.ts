import { describe, expect, it, vi } from "vitest";
import {
  looksLikeCheckStatusIntent,
  looksLikeSaveJobIntent,
  runApplicationAgent,
  runCheckApplicationStatusTool,
  runSaveJobTool,
} from "@/lib/ai/agents/application";
import { runSupervisor } from "@/lib/ai/agents/supervisor";
import type { SaveJobClient } from "@/lib/save-job";
import {
  checkSeekerApplicationStatus,
  SEEKER_STATUS_PAGE_SIZE,
  type SeekerApplicationStatusClient,
} from "@/lib/seeker-application-status";
import type { ApplyToJobClient, ApplyToJobRow } from "@/lib/apply-to-job";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SEEKER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_SEEKER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const APP_OWN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const APP_OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function createSaveStore() {
  const rows = new Map<string, { id: string; seekerId: string; jobId: string }>();
  let insertCalls = 0;

  const client: SaveJobClient = {
    async findApprovedJob(jobId) {
      return { data: { id: jobId, title: "React Engineer" }, error: null };
    },
    async findExistingSavedJob(jobId, seekerId) {
      const hit = rows.get(`${seekerId}:${jobId}`);
      return { data: hit ? { id: hit.id } : null, error: null };
    },
    async insertSavedJob(row) {
      insertCalls += 1;
      const key = `${row.seeker_id}:${row.job_id}`;
      if (rows.has(key)) {
        return {
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        };
      }
      const id = `saved-${rows.size + 1}`;
      rows.set(key, { id, seekerId: row.seeker_id, jobId: row.job_id });
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

function createStatusStore(seed: Array<{ id: string; seekerId: string; jobId: string }>) {
  let pageCalls = 0;
  const client: SeekerApplicationStatusClient = {
    async listForSeeker({ seekerId, jobId, applicationId, pageSize, offset }) {
      pageCalls += 1;
      let rows = seed
        .filter((r) => r.seekerId === seekerId)
        .map((r) => ({
          id: r.id,
          status: "applied",
          createdAt: "2026-11-01T00:00:00.000Z",
          jobId: r.jobId,
          jobTitle: r.seekerId === SEEKER_ID ? "Own Role" : "Leaked Role",
          companyName: "Acme",
          location: "Dhaka",
        }));
      if (applicationId) rows = rows.filter((r) => r.id === applicationId);
      if (jobId) rows = rows.filter((r) => r.jobId === jobId);
      return { data: rows.slice(offset, offset + pageSize), error: null };
    },
  };
  return {
    client,
    get pageCalls() {
      return pageCalls;
    },
  };
}

function createApplyStore() {
  const rows = new Map<string, { id: string; row: ApplyToJobRow }>();
  const client: ApplyToJobClient = {
    async findApprovedJob(jobId) {
      return {
        data: { id: jobId, status: "approved", application_deadline: null, description: "x" },
        error: null,
      };
    },
    async findExistingApplication(jobId, seekerId) {
      const hit = rows.get(`${jobId}:${seekerId}`);
      return { data: hit ? { id: hit.id } : null, error: null };
    },
    async insertApplication(row) {
      const key = `${row.job_id}:${row.seeker_id}`;
      const id = `app-${rows.size + 1}`;
      rows.set(key, { id, row });
      return { data: { id }, error: null };
    },
  };
  return client;
}

describe("Phase 7 Application Agent — Save Job tool", () => {
  it("detects save job intent", () => {
    expect(looksLikeSaveJobIntent("Please save this job")).toBe(true);
    expect(looksLikeSaveJobIntent("bookmark the first job")).toBe(true);
    expect(looksLikeSaveJobIntent("saved first one")).toBe(true);
    expect(looksLikeSaveJobIntent("save Software Engineer")).toBe(true);
    expect(looksLikeSaveJobIntent("What is React?")).toBe(false);
  });

  it("saves a job successfully for the authenticated seeker", async () => {
    const store = createSaveStore();
    const result = await runSaveJobTool(
      { jobId: JOB_ID, jobTitle: "React Engineer" },
      { seekerId: SEEKER_ID, saveClient: store.client },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("saved");
      expect(result.jobId).toBe(JOB_ID);
      expect(result.savedJobId).toBeTruthy();
    }
    expect(store.insertCalls).toBe(1);
    expect(store.rowCount).toBe(1);
  });

  it("prevents duplicate saved jobs", async () => {
    const store = createSaveStore();
    const deps = { seekerId: SEEKER_ID, saveClient: store.client };

    const first = await runSaveJobTool({ jobId: JOB_ID }, deps);
    const second = await runSaveJobTool({ jobId: JOB_ID }, deps);

    expect(first.ok && first.status === "saved").toBe(true);
    expect(second.ok && second.status === "already_saved").toBe(true);
    expect(store.rowCount).toBe(1);
  });

  it("rejects unauthorized save when seeker id is missing", async () => {
    const store = createSaveStore();
    const result = await runSaveJobTool(
      { jobId: JOB_ID },
      { seekerId: "  ", saveClient: store.client },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unauthorized");
    expect(store.insertCalls).toBe(0);
  });
});

describe("Phase 7 Application Agent — Check Application Status tool", () => {
  it("detects check status intent", () => {
    expect(looksLikeCheckStatusIntent("Check my application status")).toBe(true);
    expect(looksLikeCheckStatusIntent("What is the status of my application?")).toBe(true);
    expect(looksLikeCheckStatusIntent("Show my applications")).toBe(true);
    expect(looksLikeCheckStatusIntent("Find React jobs")).toBe(false);
  });

  it("returns the authenticated seeker's application status", async () => {
    const store = createStatusStore([
      { id: APP_OWN, seekerId: SEEKER_ID, jobId: JOB_ID },
      { id: APP_OTHER, seekerId: OTHER_SEEKER, jobId: JOB_ID },
    ]);

    const result = await runCheckApplicationStatusTool(
      {},
      { seekerId: SEEKER_ID, statusClient: store.client },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applications).toHaveLength(1);
      expect(result.applications[0]!.id).toBe(APP_OWN);
      expect(result.applications[0]!.jobTitle).toBe("Own Role");
      expect(result.applications[0]!.status).toBe("applied");
    }
  });

  it("returns more than 10 applications via pagination", async () => {
    const seed = Array.from({ length: 12 }, (_, i) => ({
      id: `dddddddd-dddd-4ddd-8ddd-dddddddddd${String(i).padStart(2, "0")}`,
      seekerId: SEEKER_ID,
      jobId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${String(i).padStart(2, "0")}`,
    }));
    const store = createStatusStore(seed);

    const result = await checkSeekerApplicationStatus(store.client, { seekerId: SEEKER_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applications).toHaveLength(12);
      expect(result.applications.length).toBeGreaterThan(10);
    }
    // One page is enough when page size is 50 and count is 12.
    expect(store.pageCalls).toBe(1);
    expect(SEEKER_STATUS_PAGE_SIZE).toBeGreaterThanOrEqual(50);
  });

  it("paginates across multiple pages for larger lists", async () => {
    const seed = Array.from({ length: SEEKER_STATUS_PAGE_SIZE + 3 }, (_, i) => {
      const n = String(i).padStart(3, "0");
      return {
        id: `dddddddd-dddd-4ddd-8ddd-ddddddddd${n}`,
        seekerId: SEEKER_ID,
        jobId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa${n}`,
      };
    });
    const store = createStatusStore(seed);
    const result = await checkSeekerApplicationStatus(store.client, { seekerId: SEEKER_ID });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.applications).toHaveLength(SEEKER_STATUS_PAGE_SIZE + 3);
    expect(store.pageCalls).toBe(2);
  });

  it("returns only the matching application for a specific applicationId", async () => {
    const store = createStatusStore([
      { id: APP_OWN, seekerId: SEEKER_ID, jobId: JOB_ID },
      {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        seekerId: SEEKER_ID,
        jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
      },
    ]);

    const result = await runCheckApplicationStatusTool(
      { applicationId: APP_OWN },
      { seekerId: SEEKER_ID, statusClient: store.client },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applications).toHaveLength(1);
      expect(result.applications[0]!.id).toBe(APP_OWN);
    }
  });

  it("cannot read another seeker's application by id", async () => {
    const store = createStatusStore([
      { id: APP_OWN, seekerId: SEEKER_ID, jobId: JOB_ID },
      { id: APP_OTHER, seekerId: OTHER_SEEKER, jobId: JOB_ID },
    ]);

    const result = await runCheckApplicationStatusTool(
      { applicationId: APP_OTHER },
      { seekerId: SEEKER_ID, statusClient: store.client },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applications).toHaveLength(0);
      expect(result.message).toMatch(/could not find that application/i);
      expect(result.message).not.toMatch(/Leaked Role/);
    }
  });

  it("returns db error without leaking rows", async () => {
    const client: SeekerApplicationStatusClient = {
      async listForSeeker() {
        return { data: [], error: { message: "connection failed" } };
      },
    };
    const result = await runCheckApplicationStatusTool({}, { seekerId: SEEKER_ID, statusClient: client });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("db");
      expect(result.message).toMatch(/connection failed/i);
    }
  });
});

describe("Phase 7 Application Agent tools — supervisor routing", () => {
  const legacy = async () => ({
    ok: true as const,
    answer: "legacy",
    insufficientContext: false,
    ragAvailable: false,
    liveJobsAvailable: false,
    soughtLiveJobs: false,
    corpusCitations: [] as [],
    liveCitations: [] as [],
    model: "legacy",
  });

  it("routes save job intent to Application Agent save tool", async () => {
    const runSave = vi.fn(async () => ({
      ok: true as const,
      status: "saved" as const,
      savedJobId: "saved-1",
      jobId: JOB_ID,
      title: "React Engineer",
      message: "Saved.",
    }));
    const runApply = vi.fn();
    const runStatus = vi.fn();

    const result = await runSupervisor(
      {
        question: "Please save this job",
        recentJobs: [{ id: JOB_ID, title: "React Engineer", location: "Dhaka" }],
      },
      {
        role: "seeker",
        userId: SEEKER_ID,
        runApplicationAgent: runApply,
        runSaveJobTool: runSave,
        runCheckApplicationStatusTool: runStatus,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: legacy,
      },
    );

    expect(runSave).toHaveBeenCalledWith(expect.objectContaining({ jobId: JOB_ID }));
    expect(runApply).not.toHaveBeenCalled();
    expect(runStatus).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model).toBe("application-agent");
      expect(result.saveOutcome?.status).toBe("saved");
      expect(result.supervisor?.routedTo).toBe("application");
    }
  });

  it("routes check status intent to Application Agent status tool", async () => {
    const runStatus = vi.fn(async () => ({
      ok: true as const,
      applications: [
        {
          id: APP_OWN,
          status: "shortlisted",
          createdAt: "2026-11-01T00:00:00.000Z",
          jobId: JOB_ID,
          jobTitle: "React Engineer",
          companyName: "Acme",
          location: "Dhaka",
        },
      ],
      message: "Your application is shortlisted.",
    }));
    const runSave = vi.fn();
    const runApply = vi.fn();

    const result = await runSupervisor(
      { question: "Check my application status" },
      {
        role: "seeker",
        userId: SEEKER_ID,
        runApplicationAgent: runApply,
        runSaveJobTool: runSave,
        runCheckApplicationStatusTool: runStatus,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: legacy,
      },
    );

    expect(runStatus).toHaveBeenCalledTimes(1);
    expect(runSave).not.toHaveBeenCalled();
    expect(runApply).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applicationStatuses?.[0]?.status).toBe("shortlisted");
      expect(result.supervisor?.routedTo).toBe("application");
    }
  });

  it("preserves confirm-to-apply over save/status", async () => {
    const runApply = vi.fn(async () => ({
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
    const runSave = vi.fn();
    const runStatus = vi.fn();

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
        runApplicationAgent: runApply,
        runSaveJobTool: runSave,
        runCheckApplicationStatusTool: runStatus,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: legacy,
      },
    );

    expect(runApply).toHaveBeenCalledWith(expect.objectContaining({ jobId: JOB_ID, confirm: false }));
    expect(runSave).not.toHaveBeenCalled();
    expect(runStatus).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pendingApply?.jobId).toBe(JOB_ID);
    }
  });

  it("confirm-to-apply agent still inserts only when confirmed", async () => {
    const applyClient = createApplyStore();
    const unconfirmed = await runApplicationAgent(
      { jobId: JOB_ID, jobTitle: "React Engineer", confirm: false },
      { seekerId: SEEKER_ID, applyClient, isDeadlinePassed: () => false },
    );
    expect(unconfirmed.ok && unconfirmed.status === "needs_confirm").toBe(true);

    const confirmed = await runApplicationAgent(
      {
        jobId: JOB_ID,
        jobTitle: "React Engineer",
        confirm: true,
        coverNote: "I build web apps with React and TypeScript.",
      },
      {
        seekerId: SEEKER_ID,
        applyClient,
        isDeadlinePassed: () => false,
        loadSeekerResume: async () => ({
          fullName: "Priya Das",
          email: "priya@example.com",
          resumeUrl: "https://example.com/r.pdf",
        }),
      },
    );
    expect(confirmed.ok && confirmed.status === "created").toBe(true);
  });
});
