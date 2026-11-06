/**
 * Idempotent apply under concurrent requests (Assessment 3 Track 3 / Task 3D).
 *
 * These tests use an in-memory client that **simulates** Postgres UNIQUE
 * `(job_id, seeker_id)` + SQLSTATE 23505 under a forced TOCTOU race window.
 * They prove `applyToJob` collapses concurrent attempts to one logical row and
 * safe already_applied outcomes — they do **not** prove live PostgreSQL
 * locking by themselves. See docs/ASSESSMENT_3_TRACK3_IDEMPOTENT_APPLICATIONS.md
 * for DB evidence and manual live verification steps.
 */

import { describe, expect, it, vi } from "vitest";
import {
  applyToJob,
  type ApplyToJobClient,
  type ApplyToJobInput,
  type ApplyToJobRow,
} from "@/lib/apply-to-job";
import { runApplicationAgent } from "@/lib/ai/agents/application";

const JOB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SEEKER_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SEEKER_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const CONCURRENT = 10;

type Store = {
  rows: Map<string, { id: string; row: ApplyToJobRow }>;
  insertAttempts: number;
  client: ApplyToJobClient;
};

function approvedJobClientBase(
  rows: Map<string, { id: string; row: ApplyToJobRow }>,
  counters: { insertAttempts: number },
  findExisting: ApplyToJobClient["findExistingApplication"],
): ApplyToJobClient {
  return {
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
    findExistingApplication: findExisting,
    async insertApplication(row) {
      counters.insertAttempts += 1;
      await Promise.resolve();
      const key = `${row.job_id}:${row.seeker_id}`;
      if (rows.has(key)) {
        return {
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        };
      }
      const id = `app-${rows.size + 1}-${counters.insertAttempts}`;
      rows.set(key, { id, row });
      return { data: { id }, error: null };
    },
  };
}

/**
 * Race-aware store: holds the first `expectedFindBarrier` findExisting calls until
 * all have arrived, so every concurrent apply sees “no row”, then UNIQUE on insert.
 */
function createRacingUniqueStore(expectedFindBarrier: number): Store {
  const rows = new Map<string, { id: string; row: ApplyToJobRow }>();
  const counters = { insertAttempts: 0 };
  let findsArrived = 0;
  let releaseFinds!: () => void;
  const findsReady = new Promise<void>((resolve) => {
    releaseFinds = resolve;
  });

  const client = approvedJobClientBase(rows, counters, async (jobId, seekerId) => {
    findsArrived += 1;
    if (findsArrived >= expectedFindBarrier) releaseFinds();
    await findsReady;
    const hit = rows.get(`${jobId}:${seekerId}`);
    return { data: hit ? { id: hit.id } : null, error: null };
  });

  return {
    get rows() {
      return rows;
    },
    get insertAttempts() {
      return counters.insertAttempts;
    },
    client,
  };
}

/** Sequential-friendly UNIQUE store (no find barrier). */
function createUniqueStore(): Store {
  const rows = new Map<string, { id: string; row: ApplyToJobRow }>();
  const counters = { insertAttempts: 0 };
  const client = approvedJobClientBase(rows, counters, async (jobId, seekerId) => {
    const hit = rows.get(`${jobId}:${seekerId}`);
    return { data: hit ? { id: hit.id } : null, error: null };
  });
  return {
    get rows() {
      return rows;
    },
    get insertAttempts() {
      return counters.insertAttempts;
    },
    client,
  };
}

function baseInput(
  overrides: Partial<ApplyToJobInput> & Pick<ApplyToJobInput, "jobId" | "seekerId">,
): ApplyToJobInput {
  return {
    canPersistStorage: false,
    resumeUrl: "https://example.com/resume.pdf",
    isDeadlinePassed: () => false,
    ...overrides,
  };
}

describe("applyToJob concurrent idempotency (simulated UNIQUE + 23505)", () => {
  it(`collapses ${CONCURRENT} concurrent applies for the same job+seeker to one row`, async () => {
    const store = createRacingUniqueStore(CONCURRENT);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        applyToJob(store.client, baseInput({ jobId: JOB_A, seekerId: SEEKER_1 })),
      ),
    );

    expect(store.rows.size).toBe(1);
    expect(store.rows.has(`${JOB_A}:${SEEKER_1}`)).toBe(true);

    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(CONCURRENT);

    const created = ok.filter((r) => r.ok && r.status === "created");
    const duplicates = ok.filter((r) => r.ok && r.status === "already_applied");
    expect(created).toHaveLength(1);
    expect(duplicates).toHaveLength(CONCURRENT - 1);

    const applicationId = created[0]!.ok ? created[0].applicationId : "";
    for (const r of duplicates) {
      if (r.ok) expect(r.applicationId).toBe(applicationId);
    }

    // UNIQUE race: more than one insert attempted, but only one row kept.
    expect(store.insertAttempts).toBeGreaterThanOrEqual(2);
  });

  it("retry after success returns already_applied without a second row", async () => {
    const store = createUniqueStore();
    const first = await applyToJob(store.client, baseInput({ jobId: JOB_A, seekerId: SEEKER_1 }));
    expect(first.ok && first.status === "created").toBe(true);

    const retries = await Promise.all(
      Array.from({ length: 5 }, () =>
        applyToJob(store.client, baseInput({ jobId: JOB_A, seekerId: SEEKER_1 })),
      ),
    );

    expect(store.rows.size).toBe(1);
    for (const r of retries) {
      expect(r.ok && r.status === "already_applied").toBe(true);
      if (r.ok && first.ok) expect(r.applicationId).toBe(first.applicationId);
    }
  });

  it("allows a different seeker to apply to the same job", async () => {
    const store = createUniqueStore();
    const a = await applyToJob(store.client, baseInput({ jobId: JOB_A, seekerId: SEEKER_1 }));
    const b = await applyToJob(store.client, baseInput({ jobId: JOB_A, seekerId: SEEKER_2 }));
    expect(a.ok && a.status === "created").toBe(true);
    expect(b.ok && b.status === "created").toBe(true);
    expect(store.rows.size).toBe(2);
  });

  it("allows the same seeker to apply to a different job", async () => {
    const store = createUniqueStore();
    const a = await applyToJob(store.client, baseInput({ jobId: JOB_A, seekerId: SEEKER_1 }));
    const b = await applyToJob(store.client, baseInput({ jobId: JOB_B, seekerId: SEEKER_1 }));
    expect(a.ok && a.status === "created").toBe(true);
    expect(b.ok && b.status === "created").toBe(true);
    expect(store.rows.size).toBe(2);
  });

  it("rejects unauthenticated / empty seeker id without inserting", async () => {
    const store = createUniqueStore();
    const result = await applyToJob(store.client, baseInput({ jobId: JOB_A, seekerId: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unauthorized");
    expect(store.rows.size).toBe(0);
    expect(store.insertAttempts).toBe(0);
  });
});

describe("Application agent confirm gate still required under apply path", () => {
  it("unconfirmed apply attempts 0 inserts even if called repeatedly", async () => {
    const insertApplication = vi.fn(async () => ({
      data: { id: "should-not-insert" },
      error: null,
    }));
    const client: ApplyToJobClient = {
      findApprovedJob: async (jobId) => ({
        data: { id: jobId, status: "approved", application_deadline: null },
        error: null,
      }),
      findExistingApplication: async () => ({ data: null, error: null }),
      insertApplication,
    };

    const runs = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        runApplicationAgent(
          { jobId: JOB_A, jobTitle: "React Engineer", confirm: false },
          {
            seekerId: SEEKER_1,
            applyClient: client,
            isDeadlinePassed: () => false,
          },
        ),
      ),
    );

    expect(insertApplication).not.toHaveBeenCalled();
    for (const r of runs) {
      expect(r.ok && r.status === "needs_confirm").toBe(true);
      if (r.ok && r.status === "needs_confirm") {
        expect(r.insertsAttempted).toBe(0);
      }
    }
  });
});
