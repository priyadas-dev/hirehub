/**
 * Storage cleanup before Auth account deletion.
 * Only removes objects under a verified owner folder (`{ownerId}/{file}`).
 * Never accepts client-supplied paths.
 *
 * Callers must treat any `errors` / unsuccessful cleanup as a hard failure and
 * must not report account deletion as complete while owned files may remain.
 */
import {
  COMPANY_LOGOS_BUCKET,
  RESUMES_BUCKET,
  assertStorageOwnerId,
  storagePathIsSafe,
} from "@/lib/hirehub-storage";

export type StorageListItem = {
  name?: string | null;
  id?: string | null;
};

/** Narrow Storage surface used by account deletion (real client or test double). */
export type AccountDeleteStorage = {
  from: (bucket: string) => {
    list: (
      path?: string,
      options?: { limit?: number; offset?: number },
    ) => PromiseLike<{ data: StorageListItem[] | null; error: { message: string } | null }>;
    remove: (
      paths: string[],
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
};

export type StorageFolderCleanupResult = {
  attempted: boolean;
  removed: string[];
  errors: string[];
};

/** True when cleanup finished without unresolved Storage errors. */
export function isStorageCleanupSuccessful(
  results: StorageFolderCleanupResult | StorageFolderCleanupResult[],
): boolean {
  const list = Array.isArray(results) ? results : [results];
  return list.every((result) => result.attempted && result.errors.length === 0);
}

/**
 * Build safe `{ownerId}/{file}` paths from a Storage folder listing.
 * Skips empty names and anything that fails HireHub path safety.
 */
export function collectOwnedStorageObjectPaths(
  ownerId: string,
  listed: StorageListItem[] | null | undefined,
): string[] {
  const owner = assertStorageOwnerId(ownerId);
  const paths: string[] = [];
  for (const item of listed ?? []) {
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) continue;
    const objectPath = `${owner}/${name}`;
    if (!storagePathIsSafe(objectPath)) continue;
    paths.push(objectPath);
  }
  return paths;
}

const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 100;

async function listOwnedStoragePaths(
  bucketClient: ReturnType<AccountDeleteStorage["from"]>,
  owner: string,
): Promise<{ paths: string[]; error?: string }> {
  const allPaths: string[] = [];
  for (let offset = 0; offset < 5_000; offset += LIST_PAGE_SIZE) {
    try {
      const listed = await bucketClient.list(owner, { limit: LIST_PAGE_SIZE, offset });
      if (listed.error) {
        return { paths: allPaths, error: listed.error.message };
      }
      const page = collectOwnedStorageObjectPaths(owner, listed.data);
      allPaths.push(...page);
      if (!listed.data || listed.data.length < LIST_PAGE_SIZE) break;
    } catch (err) {
      return {
        paths: allPaths,
        error: err instanceof Error ? err.message : "Storage list failed.",
      };
    }
  }
  return { paths: allPaths };
}

/**
 * List and remove every safe object under `{ownerId}/` in the given bucket.
 * Re-lists after remove; any remaining object or list/remove error is reported
 * in `errors` so callers can refuse to claim a complete account deletion.
 */
export async function removeOwnedStorageFolder(
  storage: AccountDeleteStorage,
  bucket: string,
  ownerId: string,
): Promise<StorageFolderCleanupResult> {
  const result: StorageFolderCleanupResult = { attempted: false, removed: [], errors: [] };
  let owner: string;
  try {
    owner = assertStorageOwnerId(ownerId);
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : "Invalid storage owner id.");
    return result;
  }

  result.attempted = true;
  const bucketClient = storage.from(bucket);

  const listed = await listOwnedStoragePaths(bucketClient, owner);
  if (listed.error) {
    result.errors.push(listed.error);
    return result;
  }

  for (let i = 0; i < listed.paths.length; i += REMOVE_BATCH_SIZE) {
    const batch = listed.paths.slice(i, i + REMOVE_BATCH_SIZE);
    try {
      const removed = await bucketClient.remove(batch);
      if (removed.error) {
        result.errors.push(removed.error.message);
      } else {
        result.removed.push(...batch);
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : "Storage remove failed.");
    }
  }

  if (result.errors.length > 0) return result;

  // Confirm the folder is empty so we never report success while files remain.
  const verify = await listOwnedStoragePaths(bucketClient, owner);
  if (verify.error) {
    result.errors.push(verify.error);
    return result;
  }
  if (verify.paths.length > 0) {
    result.errors.push(
      `Could not remove ${verify.paths.length} file(s) from ${bucket}/${owner}. Try again or contact support.`,
    );
  }

  return result;
}

/** Remove all resume objects for a user folder in the private resumes bucket. */
export async function cleanupUserResumeStorage(
  storage: AccountDeleteStorage,
  userId: string,
): Promise<StorageFolderCleanupResult> {
  return removeOwnedStorageFolder(storage, RESUMES_BUCKET, userId);
}

/** Remove all logo objects for each company folder in company-logos. */
export async function cleanupCompanyLogoStorage(
  storage: AccountDeleteStorage,
  companyIds: string[],
): Promise<StorageFolderCleanupResult[]> {
  const results: StorageFolderCleanupResult[] = [];
  for (const companyId of companyIds) {
    results.push(await removeOwnedStorageFolder(storage, COMPANY_LOGOS_BUCKET, companyId));
  }
  return results;
}

export function logStorageCleanupFailures(
  label: string,
  results: StorageFolderCleanupResult | StorageFolderCleanupResult[],
): void {
  const list = Array.isArray(results) ? results : [results];
  for (const result of list) {
    for (const message of result.errors) {
      console.error(`[delete-account] ${label}:`, message);
    }
  }
}

export const STORAGE_CLEANUP_BLOCKED_MESSAGE =
  "Could not delete all of your uploaded files. Your account was not deleted. Please try again or contact support.";
