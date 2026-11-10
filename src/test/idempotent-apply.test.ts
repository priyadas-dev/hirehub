import { describe, expect, it } from "vitest";
import {
  applyToJob,
  isUniqueViolation,
  type ApplyToJobClient,
  type ApplyToJobRow,
} from "@/lib/apply-to-job";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SEEKER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function baseInput(overrides: Partial<Parameters<typeof applyToJob>[1]> = {}) {
  return {
    jobId: JOB_ID,
    seekerId: SEEKER_ID,
    canPersistStorage: false,
    resumeUrl: "https://example.com/resume.pdf",
    isDeadlinePassed: () => false,
    ...overrides,
  };
}

/**
 * In-memory store that enforces UNIQUE (job_id, seeker_id) with an awaitable
 * race window — models Postgres uniqueness under concurrent inserts.
 */
function createRacingUniqueStore() {
  const rows = new Map<string, { id: string; row: ApplyToJobRow }>();
  let successfulInserts = 0;

  const client: ApplyToJobClient = {
    async findApprovedJob(jobId) {
      return {
        data: {
          id: jobId,
          status: "approved",
          application_deadline: null,
          description: "Synthetic approved job",
        },
        error: null,
      };
    },
    async findExistingApplication(jobId, seekerId) {
      const hit = rows.get(`${jobId}:${seekerId}`);
      return { data: hit ? { id: hit.id } : null, error: null };
    },
    async insertApplication(row) {
      const key = `${row.job_id}:${row.seeker_id}`;
      // Yield so parallel callers can interleave before the write.
      await Promise.resolve();
      if (rows.has(key)) {
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      await Promise.resolve();
      if (rows.has(key)) {
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      const id = `app-${rows.size + 1}-${Math.random().toString(16).slice(2, 8)}`;
      rows.set(key, { id, row });
      successfulInserts += 1;
      return { data: { id }, error: null };
    },
  };

  return {
    client,
    get rowCount() {
      return rows.size;
    },
    get successfulInserts() {
      return successfulInserts;
    },
    get soleApplicationId() {
      const only = [...rows.values()][0];
      return only?.id ?? null;
    },
  };
}

describe("isUniqueViolation", () => {
  it("detects Postgres 23505 and duplicate messaging", () => {
    expect(isUniqueViolation({ code: "23505", message: "x" })).toBe(true);
    expect(isUniqueViolation({ message: "duplicate key value" })).toBe(true);
    expect(isUniqueViolation({ code: "42501", message: "permission denied" })).toBe(false);
  });
});

describe("applyToJob idempotency", () => {
  it("returns already_applied when a row already exists (pre-check)", async () => {
    const store = createRacingUniqueStore();
    const first = await applyToJob(store.client, baseInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.status).toBe("created");

    const second = await applyToJob(store.client, baseInput());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.status).toBe("already_applied");
    expect(second.applicationId).toBe(first.applicationId);
    expect(store.rowCount).toBe(1);
    expect(store.successfulInserts).toBe(1);
  });

  it("parallel duplicate applies collapse to exactly one row (UNIQUE race)", async () => {
    const store = createRacingUniqueStore();
    const input = baseInput();

    const results = await Promise.all([
      applyToJob(store.client, input),
      applyToJob(store.client, input),
      applyToJob(store.client, input),
      applyToJob(store.client, input),
      applyToJob(store.client, input),
    ]);

    expect(store.rowCount).toBe(1);
    expect(store.successfulInserts).toBe(1);

    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(5);

    const created = ok.filter((r) => r.ok && r.status === "created");
    const already = ok.filter((r) => r.ok && r.status === "already_applied");
    expect(created.length).toBe(1);
    expect(already.length).toBe(4);

    const soleId = store.soleApplicationId;
    expect(soleId).toBeTruthy();
    for (const r of ok) {
      if (r.ok) expect(r.applicationId).toBe(soleId);
    }
  });

  it("rejects deadline-passed jobs without inserting", async () => {
    const store = createRacingUniqueStore();
    const result = await applyToJob(store.client, baseInput({ isDeadlinePassed: () => true }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("deadline");
    expect(store.rowCount).toBe(0);
  });

  it("validates storage path ownership when persisting uploads", async () => {
    const store = createRacingUniqueStore();
    const result = await applyToJob(
      store.client,
      baseInput({
        canPersistStorage: true,
        resumeUrl: null,
        resumeStoragePath: `${SEEKER_ID}/cv.pdf`,
        resumeFileName: "cv.pdf",
        assertResumeStoragePath: (path, seekerId) => {
          if (!path.startsWith(`${seekerId}/`)) {
            throw new Error("Resume Storage path must be {seeker_id}/{file}.");
          }
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(store.rowCount).toBe(1);
  });
});
