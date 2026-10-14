import { supabase } from "@/integrations/supabase/client";

/** Private Storage buckets from PROPOSED_0008 (apply migration before live uploads succeed). */
export const RESUMES_BUCKET = "resumes";
export const COMPANY_LOGOS_BUCKET = "company-logos";

/** Short-lived signed URL TTLs (seconds). Never persist these URLs in the database. */
export const RESUME_SIGNED_URL_TTL_SEC = 120;
export const LOGO_SIGNED_URL_TTL_SEC = 300;

/** Shown when a file upload cannot be saved yet. */
export const COMING_SOON_MESSAGE = "Coming soon";

export const FILE_UPLOADS_PENDING_NOTE = COMING_SOON_MESSAGE;

let readyCache: boolean | null = null;

/** Reset after tests or after a migration is applied in the same session. */
export function resetFileUploadsReadyCache() {
  readyCache = null;
}

/**
 * Detects whether PROPOSED_0008 columns are visible to PostgREST.
 * Returns false (honest) when columns are missing; does not invent schema.
 */
export async function probeHireHubFileUploadsReady(): Promise<boolean> {
  if (readyCache !== null) return readyCache;

  const profileProbe = await supabase.from("profiles").select("resume_storage_path").limit(1);
  if (profileProbe.error && isMissingSchemaError(profileProbe.error.message)) {
    readyCache = false;
    return false;
  }

  const companyProbe = await supabase.from("companies").select("logo_url").limit(1);
  if (companyProbe.error && isMissingSchemaError(companyProbe.error.message)) {
    readyCache = false;
    return false;
  }

  const appProbe = await supabase.from("applications").select("portfolio_url,resume_storage_path").limit(1);
  if (appProbe.error && isMissingSchemaError(appProbe.error.message)) {
    readyCache = false;
    return false;
  }

  readyCache = true;
  return true;
}

export function isMissingSchemaError(message: string): boolean {
  return /column|schema cache|does not exist|Could not find/i.test(message);
}

export function isExternalHttpUrl(value: string | null | undefined): boolean {
  return !!value && /^https?:\/\//i.test(value.trim());
}

/**
 * Mirrors PROPOSED_0008 `public.storage_path_is_safe(text)`:
 * exactly `{folder}/{file}`, length 3–512, no `..`, no `\`, no whitespace.
 */
export function storagePathIsSafe(value: string | null | undefined): boolean {
  if (!value) return false;
  const objectName = value.trim();
  if (objectName.length < 3 || objectName.length > 512) return false;
  if (objectName.includes("..")) return false;
  if (objectName.includes("\\")) return false;
  if (/\s/.test(objectName)) return false;
  if (!/^[^/]+\/[^/]+$/.test(objectName)) return false;
  const folder = objectName.split("/")[0];
  return folder.length > 0;
}

/** Storage object paths look like `{uuid}/{filename}` — not http(s). */
export function isStorageObjectPath(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (isExternalHttpUrl(v)) return false;
  return storagePathIsSafe(v);
}

export function storageFirstFolder(objectName: string): string | null {
  if (!storagePathIsSafe(objectName)) return null;
  return objectName.trim().split("/")[0] || null;
}

/** Owner folder for Storage paths — must be a single path segment (usually a UUID). */
export function assertStorageOwnerId(ownerId: string): string {
  const id = ownerId.trim();
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..") || /\s/.test(id)) {
    throw new Error("Invalid storage owner id.");
  }
  return id;
}

/**
 * Sanitize a display filename for use as the object-name file segment.
 * Must not produce spaces, slashes, or `..` (rejected by storage_path_is_safe).
 */
export function sanitizeUploadFileName(fileName: string, fallback: string): string {
  const base = fileName.split(/[/\\]/).pop() || fallback;
  let cleaned = base.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  // SQL rejects any '..' substring anywhere in the object name.
  cleaned = cleaned.replace(/\.{2,}/g, ".");
  cleaned = cleaned.replace(/^\.+/, "").replace(/\.+$/, "");
  cleaned = cleaned.slice(0, 80);
  if (!cleaned || cleaned === "." || cleaned.includes("..")) {
    return fallback.replace(/[^\w.\-]+/g, "_").replace(/\.{2,}/g, ".") || "file";
  }
  return cleaned;
}

export function buildResumeObjectPath(ownerUserId: string, fileName: string): string {
  const owner = assertStorageOwnerId(ownerUserId);
  const safe = sanitizeUploadFileName(fileName, "resume.pdf");
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;
  const path = `${owner}/${id}-${safe}`;
  if (!storagePathIsSafe(path)) {
    throw new Error("Built resume Storage path failed safety checks.");
  }
  return path;
}

export function buildCompanyLogoObjectPath(companyId: string, fileName: string): string {
  const owner = assertStorageOwnerId(companyId);
  const safe = sanitizeUploadFileName(fileName, "logo.png");
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;
  const path = `${owner}/${id}-${safe}`;
  if (!storagePathIsSafe(path)) {
    throw new Error("Built company-logo Storage path failed safety checks.");
  }
  return path;
}

export async function createSignedStorageUrl(
  bucket: string,
  path: string,
  expiresIn: number,
): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Could not create a signed download link.");
  return data.signedUrl;
}

export async function resolveDisplayUrl(
  value: string | null | undefined,
  kind: "resume" | "logo",
): Promise<string | null> {
  if (!value) return null;
  const trimmed = value.trim();
  if (isExternalHttpUrl(trimmed)) return trimmed;
  if (!isStorageObjectPath(trimmed)) return null;
  const bucket = kind === "resume" ? RESUMES_BUCKET : COMPANY_LOGOS_BUCKET;
  const ttl = kind === "resume" ? RESUME_SIGNED_URL_TTL_SEC : LOGO_SIGNED_URL_TTL_SEC;
  return createSignedStorageUrl(bucket, trimmed, ttl);
}
