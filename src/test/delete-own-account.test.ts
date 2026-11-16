import { describe, expect, it, vi } from "vitest";
import {
  COMPANY_LOGOS_BUCKET,
  RESUMES_BUCKET,
} from "@/lib/hirehub-storage";
import {
  STORAGE_CLEANUP_BLOCKED_MESSAGE,
  collectOwnedStorageObjectPaths,
  cleanupCompanyLogoStorage,
  cleanupUserResumeStorage,
  isStorageCleanupSuccessful,
  removeOwnedStorageFolder,
  type AccountDeleteStorage,
} from "@/lib/delete-account-storage";
import {
  canAdminDeleteTargetRole,
  canDeleteOwnAccount,
  performAdminDeleteUser,
  performDeleteOwnAccount,
  type DeleteAccountAdminClient,
} from "@/lib/delete-own-account";

describe("canDeleteOwnAccount", () => {
  it("allows seekers and recruiters only", () => {
    expect(canDeleteOwnAccount("job_seeker")).toBe(true);
    expect(canDeleteOwnAccount("recruiter")).toBe(true);
    expect(canDeleteOwnAccount("admin")).toBe(false);
    expect(canDeleteOwnAccount(null)).toBe(false);
    expect(canDeleteOwnAccount(undefined)).toBe(false);
  });
});

describe("canAdminDeleteTargetRole", () => {
  it("mirrors seeker/recruiter-only targets", () => {
    expect(canAdminDeleteTargetRole("job_seeker")).toBe(true);
    expect(canAdminDeleteTargetRole("recruiter")).toBe(true);
    expect(canAdminDeleteTargetRole("admin")).toBe(false);
  });
});

describe("collectOwnedStorageObjectPaths", () => {
  const owner = "11111111-1111-1111-1111-111111111111";

  it("builds safe owner-scoped paths and skips unsafe names", () => {
    expect(
      collectOwnedStorageObjectPaths(owner, [
        { name: "a.pdf", id: "1" },
        { name: "nested/evil.pdf", id: "2" },
        { name: "..", id: "3" },
        { name: "", id: "4" },
        { name: "logo.png", id: "5" },
      ]),
    ).toEqual([`${owner}/a.pdf`, `${owner}/logo.png`]);
  });

  it("returns empty for empty listings", () => {
    expect(collectOwnedStorageObjectPaths(owner, [])).toEqual([]);
    expect(collectOwnedStorageObjectPaths(owner, null)).toEqual([]);
    expect(collectOwnedStorageObjectPaths(owner, undefined)).toEqual([]);
  });

  it("rejects invalid owner ids", () => {
    expect(() => collectOwnedStorageObjectPaths("../x", [{ name: "a.pdf", id: "1" }])).toThrow(
      /Invalid storage owner id/,
    );
  });
});

describe("isStorageCleanupSuccessful", () => {
  it("requires attempted cleanup with no errors", () => {
    expect(isStorageCleanupSuccessful({ attempted: true, removed: [], errors: [] })).toBe(true);
    expect(isStorageCleanupSuccessful({ attempted: false, removed: [], errors: [] })).toBe(false);
    expect(
      isStorageCleanupSuccessful({ attempted: true, removed: [], errors: ["list failed"] }),
    ).toBe(false);
  });
});

describe("removeOwnedStorageFolder", () => {
  it("lists, removes, and re-lists to confirm the owner folder is empty", async () => {
    const owner = "22222222-2222-2222-2222-222222222222";
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          { name: "resume.pdf", id: "1" },
          { name: "app.pdf", id: "2" },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const storage: AccountDeleteStorage = {
      from: vi.fn((bucket: string) => {
        expect(bucket).toBe(RESUMES_BUCKET);
        return { list, remove };
      }),
    };

    const result = await removeOwnedStorageFolder(storage, RESUMES_BUCKET, owner);
    expect(list).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith([`${owner}/resume.pdf`, `${owner}/app.pdf`]);
    expect(result.removed).toEqual([`${owner}/resume.pdf`, `${owner}/app.pdf`]);
    expect(result.errors).toEqual([]);
    expect(isStorageCleanupSuccessful(result)).toBe(true);
  });

  it("no-ops when the folder is empty", async () => {
    const owner = "33333333-3333-3333-3333-333333333333";
    const list = vi.fn().mockResolvedValue({ data: [], error: null });
    const remove = vi.fn();
    const storage: AccountDeleteStorage = {
      from: () => ({ list, remove }),
    };

    const result = await removeOwnedStorageFolder(storage, RESUMES_BUCKET, owner);
    expect(remove).not.toHaveBeenCalled();
    // Initial list empty + verify list empty.
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.removed).toEqual([]);
    expect(result.attempted).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("records list errors without throwing", async () => {
    const owner = "44444444-4444-4444-4444-444444444444";
    const storage: AccountDeleteStorage = {
      from: () => ({
        list: vi.fn().mockResolvedValue({ data: null, error: { message: "list failed" } }),
        remove: vi.fn(),
      }),
    };
    const result = await removeOwnedStorageFolder(storage, COMPANY_LOGOS_BUCKET, owner);
    expect(result.errors).toContain("list failed");
    expect(result.removed).toEqual([]);
    expect(isStorageCleanupSuccessful(result)).toBe(false);
  });

  it("fails when files remain after remove", async () => {
    const owner = "88888888-8888-8888-8888-888888888888";
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ name: "stuck.pdf", id: "1" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ name: "stuck.pdf", id: "1" }],
        error: null,
      });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const result = await removeOwnedStorageFolder(
      { from: () => ({ list, remove }) },
      RESUMES_BUCKET,
      owner,
    );
    expect(result.errors[0]).toMatch(/Could not remove 1 file/);
    expect(isStorageCleanupSuccessful(result)).toBe(false);
  });
});

describe("cleanup helpers", () => {
  it("cleanupUserResumeStorage uses the resumes bucket", async () => {
    const owner = "55555555-5555-5555-5555-555555555555";
    const from = vi.fn().mockReturnValue({
      list: vi
        .fn()
        .mockResolvedValueOnce({ data: [{ name: "r.pdf", id: "1" }], error: null })
        .mockResolvedValueOnce({ data: [], error: null }),
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    await cleanupUserResumeStorage({ from }, owner);
    expect(from).toHaveBeenCalledWith(RESUMES_BUCKET);
  });

  it("cleanupCompanyLogoStorage cleans each company folder", async () => {
    const c1 = "66666666-6666-6666-6666-666666666666";
    const c2 = "77777777-7777-7777-7777-777777777777";
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ name: "logo.png", id: "1" }], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ name: "logo.png", id: "1" }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const from = vi.fn().mockReturnValue({ list, remove });

    const results = await cleanupCompanyLogoStorage({ from }, [c1, c2]);
    expect(from).toHaveBeenCalledWith(COMPANY_LOGOS_BUCKET);
    expect(list).toHaveBeenCalledWith(c1, expect.any(Object));
    expect(list).toHaveBeenCalledWith(c2, expect.any(Object));
    expect(results).toHaveLength(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

/** Storage list: files on first call per folder, empty on verify. */
function createCleaningStorageList() {
  const callsByOwner = new Map<string, number>();
  return vi.fn(async (owner: string) => {
    const n = (callsByOwner.get(owner) ?? 0) + 1;
    callsByOwner.set(owner, n);
    if (n === 1) {
      return { data: [{ name: "file.pdf", id: "1" }], error: null };
    }
    return { data: [], error: null };
  });
}

function createMockAdmin(input: {
  profile: { id: string; role: string; resume_storage_path?: string | null } | null;
  profileError?: string;
  companies?: { id: string; logo_url?: string | null }[];
  companiesError?: string;
  deleteError?: string;
}): {
  admin: DeleteAccountAdminClient;
  storageList: ReturnType<typeof vi.fn>;
  storageRemove: ReturnType<typeof vi.fn>;
  deleteUser: ReturnType<typeof vi.fn>;
  companiesEq: ReturnType<typeof vi.fn>;
} {
  const storageList = createCleaningStorageList();
  const storageRemove = vi.fn().mockResolvedValue({ data: [], error: null });
  const deleteUser = vi.fn().mockResolvedValue({
    error: input.deleteError ? { message: input.deleteError } : null,
  });
  const companiesEq = vi.fn().mockResolvedValue({
    data: input.companies ?? [],
    error: input.companiesError ? { message: input.companiesError } : null,
  });

  const admin: DeleteAccountAdminClient = {
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: input.profile,
                error: input.profileError ? { message: input.profileError } : null,
              }),
            }),
          }),
        };
      }
      if (table === "job_revisions") {
        return {
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "companies") {
        return {
          select: () => ({
            eq: companiesEq,
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from: () => ({
        list: storageList,
        remove: storageRemove,
      }),
    },
    auth: {
      admin: { deleteUser },
    },
  };

  return { admin, storageList, storageRemove, deleteUser, companiesEq };
}

describe("performDeleteOwnAccount", () => {
  const seekerId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const recruiterId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const companyId = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  it("cleans resume storage and deletes Auth for a seeker", async () => {
    const { admin, storageList, storageRemove, deleteUser, companiesEq } = createMockAdmin({
      profile: { id: seekerId, role: "job_seeker", resume_storage_path: `${seekerId}/old.pdf` },
    });

    const result = await performDeleteOwnAccount(admin, seekerId);
    expect(result).toEqual({ ok: true });
    expect(storageList).toHaveBeenCalled();
    expect(storageRemove).toHaveBeenCalledWith([`${seekerId}/file.pdf`]);
    expect(companiesEq).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith(seekerId);
  });

  it("cleans company logos and deletes Auth for a recruiter", async () => {
    const { admin, storageList, storageRemove, deleteUser, companiesEq } = createMockAdmin({
      profile: { id: recruiterId, role: "recruiter" },
      companies: [{ id: companyId, logo_url: `${companyId}/logo.png` }],
    });

    const result = await performDeleteOwnAccount(admin, recruiterId);
    expect(result).toEqual({ ok: true });
    expect(companiesEq).toHaveBeenCalledWith("recruiter_id", recruiterId);
    expect(storageList).toHaveBeenCalled();
    expect(storageRemove).toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith(recruiterId);
  });

  it("rejects admin without Storage or Auth delete", async () => {
    const { admin, storageList, deleteUser } = createMockAdmin({
      profile: { id: seekerId, role: "admin" },
    });

    const result = await performDeleteOwnAccount(admin, seekerId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Admin accounts cannot be deleted/i);
    expect(storageList).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("does not delete Auth or report success when Storage cleanup fails", async () => {
    const { admin, deleteUser } = createMockAdmin({
      profile: { id: seekerId, role: "job_seeker" },
    });
    admin.storage = {
      from: () => ({
        list: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
        remove: vi.fn(),
      }),
    };

    const result = await performDeleteOwnAccount(admin, seekerId);
    expect(result).toEqual({ ok: false, message: STORAGE_CLEANUP_BLOCKED_MESSAGE });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("does not delete Auth when recruiter company lookup fails", async () => {
    const { admin, deleteUser } = createMockAdmin({
      profile: { id: recruiterId, role: "recruiter" },
      companiesError: "companies unavailable",
    });

    const result = await performDeleteOwnAccount(admin, recruiterId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/companies unavailable|company files/i);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("returns Auth delete errors after successful Storage cleanup", async () => {
    const { admin } = createMockAdmin({
      profile: { id: seekerId, role: "job_seeker" },
      deleteError: "cannot delete",
    });
    const result = await performDeleteOwnAccount(admin, seekerId);
    expect(result).toEqual({ ok: false, message: "cannot delete" });
  });
});

describe("performAdminDeleteUser", () => {
  const adminId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const seekerId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const otherAdminId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

  it("lets an admin delete a seeker", async () => {
    const { admin, deleteUser } = createMockAdmin({
      profile: { id: seekerId, role: "job_seeker" },
    });
    const result = await performAdminDeleteUser(admin, {
      callerId: adminId,
      callerRole: "admin",
      targetUserId: seekerId,
    });
    expect(result).toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledWith(seekerId);
  });

  it("rejects non-admin callers", async () => {
    const { admin, deleteUser } = createMockAdmin({
      profile: { id: seekerId, role: "job_seeker" },
    });
    const result = await performAdminDeleteUser(admin, {
      callerId: seekerId,
      callerRole: "job_seeker",
      targetUserId: seekerId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Only admins/i);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("rejects deleting self", async () => {
    const { admin, deleteUser } = createMockAdmin({
      profile: { id: adminId, role: "admin" },
    });
    const result = await performAdminDeleteUser(admin, {
      callerId: adminId,
      callerRole: "admin",
      targetUserId: adminId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/your own account/i);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("rejects deleting another admin", async () => {
    const { admin, deleteUser } = createMockAdmin({
      profile: { id: otherAdminId, role: "admin" },
    });
    const result = await performAdminDeleteUser(admin, {
      callerId: adminId,
      callerRole: "admin",
      targetUserId: otherAdminId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Admin accounts cannot be deleted/i);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
