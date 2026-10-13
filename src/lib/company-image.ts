import { supabase } from "@/integrations/supabase/client";
import {
  COMPANY_LOGOS_BUCKET,
  FILE_UPLOADS_PENDING_NOTE,
  LOGO_SIGNED_URL_TTL_SEC,
  buildCompanyLogoObjectPath,
  createSignedStorageUrl,
  isExternalHttpUrl,
  isStorageObjectPath,
  probeHireHubFileUploadsReady,
  storageFirstFolder,
} from "@/lib/hirehub-storage";

export const COMPANY_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
/** No SVG — unsanitized SVG is an XSS risk in <img> contexts. */
export const COMPANY_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type CompanyImageValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type UploadedCompanyLogo = {
  storagePath: string;
  signedUrl: string;
};

/** Validate a manually entered image URL (http/https only). */
export function validateCompanyImageUrl(raw: string): CompanyImageValidation {
  const value = raw.trim();
  if (!value) return { ok: false, error: "Enter an image URL or upload a file." };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "Enter a valid image URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Image URL must start with http:// or https://." };
  }
  return { ok: true, url: parsed.toString() };
}

/** Validate a picked image file before preview / upload attempt. */
export function validateCompanyImageFile(file: File): CompanyImageValidation {
  if (!file.type || !ALLOWED_MIME.has(file.type)) {
    return { ok: false, error: "Choose a JPEG, PNG, WebP, or GIF image (SVG is not allowed)." };
  }
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > COMPANY_IMAGE_MAX_BYTES) {
    return { ok: false, error: "Image must be 2 MB or smaller." };
  }
  return { ok: true, url: "" };
}

export const COMPANY_IMAGE_PERSISTENCE_NOTE = FILE_UPLOADS_PENDING_NOTE;

export function companyImagePersistenceAvailable(schemaReady: boolean, hasUploadBucket: boolean) {
  return schemaReady && hasUploadBucket;
}

export async function uploadCompanyLogo(file: File, companyId: string): Promise<UploadedCompanyLogo> {
  const ready = await probeHireHubFileUploadsReady();
  if (!ready) throw new Error(FILE_UPLOADS_PENDING_NOTE);

  const validated = validateCompanyImageFile(file);
  if (!validated.ok) throw new Error(validated.error);

  const storagePath = buildCompanyLogoObjectPath(companyId, file.name);
  const { error } = await supabase.storage.from(COMPANY_LOGOS_BUCKET).upload(storagePath, file, {
    contentType: file.type || "image/png",
    upsert: false,
  });
  if (error) throw error;

  const signedUrl = await createSignedStorageUrl(
    COMPANY_LOGOS_BUCKET,
    storagePath,
    LOGO_SIGNED_URL_TTL_SEC,
  );
  return { storagePath, signedUrl };
}

export async function removeCompanyLogoObject(storagePath: string): Promise<void> {
  if (!isStorageObjectPath(storagePath)) return;
  const { error } = await supabase.storage.from(COMPANY_LOGOS_BUCKET).remove([storagePath]);
  if (error) throw error;
}

/** Persist logo_url as a Storage path or external https URL (never a signed URL). */
export async function saveCompanyLogoUrl(
  companyId: string,
  recruiterId: string,
  logoUrl: string | null,
): Promise<void> {
  const ready = await probeHireHubFileUploadsReady();
  if (!ready) throw new Error(FILE_UPLOADS_PENDING_NOTE);

  if (logoUrl) {
    if (isExternalHttpUrl(logoUrl)) {
      /* legacy https URL — allowed by companies_logo_url_shape_chk */
    } else if (!isStorageObjectPath(logoUrl) || storageFirstFolder(logoUrl) !== companyId) {
      throw new Error("Logo Storage path must be {company_id}/{file} or an http(s) URL.");
    }
  }

  const { data, error } = await supabase
    .from("companies")
    .update({ logo_url: logoUrl })
    .eq("id", companyId)
    .eq("recruiter_id", recruiterId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Company logo could not be saved.");
}
