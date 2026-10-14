import { supabase } from "@/integrations/supabase/client";
import {
  FILE_UPLOADS_PENDING_NOTE,
  RESUME_SIGNED_URL_TTL_SEC,
  RESUMES_BUCKET,
  buildResumeObjectPath,
  createSignedStorageUrl,
  isStorageObjectPath,
  probeHireHubFileUploadsReady,
  storageFirstFolder,
  storagePathIsSafe,
} from "@/lib/hirehub-storage";

export const RESUME_PDF_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const RESUME_PDF_ACCEPT = "application/pdf,.pdf";

export type ResumeValidation = { ok: true } | { ok: false; error: string };

export type PortfolioUrlValidation =
  | { ok: true; url: string | null }
  | { ok: false; error: string };

export type UploadedResume = {
  storagePath: string;
  fileName: string;
  signedUrl: string;
};

/** Validate a picked resume file before any upload attempt. */
export function validateResumePdfFile(file: File): ResumeValidation {
  const isPdfMime = file.type === "application/pdf";
  const looksPdf = /\.pdf$/i.test(file.name);
  if (!isPdfMime && !looksPdf) {
    return { ok: false, error: "Choose a PDF file (.pdf)." };
  }
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > RESUME_PDF_MAX_BYTES) {
    return { ok: false, error: "Resume PDF must be 5 MB or smaller." };
  }
  return { ok: true };
}

/** Optional portfolio / personal site URL — empty is valid. */
export function validatePortfolioUrl(raw: string): PortfolioUrlValidation {
  const value = raw.trim();
  if (!value) return { ok: true, url: null };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "Enter a valid portfolio URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Portfolio URL must start with http:// or https://." };
  }
  return { ok: true, url: parsed.toString() };
}

export const RESUME_PDF_PERSISTENCE_NOTE = FILE_UPLOADS_PENDING_NOTE;

export const PORTFOLIO_PERSISTENCE_NOTE = "Coming soon";

export function resumePdfPersistenceAvailable(schemaReady: boolean, hasUploadBucket: boolean) {
  return schemaReady && hasUploadBucket;
}

export function portfolioPersistenceAvailable(schemaReady: boolean) {
  return schemaReady;
}

/**
 * Upload a seeker-owned PDF to the private `resumes` bucket.
 * Path: `{seekerId}/{uuid}-{filename}`.
 */
export async function uploadResumePdf(
  file: File,
  seekerId: string,
): Promise<UploadedResume> {
  const ready = await probeHireHubFileUploadsReady();
  if (!ready) {
    throw new Error(FILE_UPLOADS_PENDING_NOTE);
  }
  const validated = validateResumePdfFile(file);
  if (!validated.ok) throw new Error(validated.error);

  const storagePath = buildResumeObjectPath(seekerId, file.name);
  const { error } = await supabase.storage.from(RESUMES_BUCKET).upload(storagePath, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw error;

  const signedUrl = await createSignedStorageUrl(RESUMES_BUCKET, storagePath, RESUME_SIGNED_URL_TTL_SEC);
  return { storagePath, fileName: file.name, signedUrl };
}

/** @deprecated Prefer uploadResumePdf once schema is ready. */
export async function uploadResumePdfIfSupported(
  file: File,
  options: { hasUploadBucket: boolean; seekerId?: string },
): Promise<{ url: string; storagePath?: string; fileName?: string }> {
  if (!options.hasUploadBucket || !options.seekerId) {
    throw new Error(
      "Resume PDF upload is unavailable: no Supabase Storage bucket is configured for HireHub.",
    );
  }
  const uploaded = await uploadResumePdf(file, options.seekerId);
  return { url: uploaded.signedUrl, storagePath: uploaded.storagePath, fileName: uploaded.fileName };
}

export async function removeResumeObject(storagePath: string): Promise<void> {
  if (!isStorageObjectPath(storagePath)) return;
  const { error } = await supabase.storage.from(RESUMES_BUCKET).remove([storagePath]);
  if (error) throw error;
}

export async function saveProfileResume(
  seekerId: string,
  resume: { storagePath: string; fileName: string } | null,
): Promise<void> {
  const ready = await probeHireHubFileUploadsReady();
  if (!ready) throw new Error(FILE_UPLOADS_PENDING_NOTE);

  if (resume) {
    if (!storagePathIsSafe(resume.storagePath) || storageFirstFolder(resume.storagePath) !== seekerId) {
      throw new Error("Resume Storage path must be {seeker_id}/{file}.");
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      resume_storage_path: resume?.storagePath ?? null,
      resume_file_name: resume?.fileName ?? null,
    })
    .eq("id", seekerId);
  if (error) throw error;
}
