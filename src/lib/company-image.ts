/** Client-side company logo/cover image helpers (no schema inventing). */

export const COMPANY_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const COMPANY_IMAGE_ACCEPT = "image/*";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

export type CompanyImageValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

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
    if (!file.type.startsWith("image/")) {
      return { ok: false, error: "Choose an image file (JPEG, PNG, WebP, GIF, or SVG)." };
    }
  }
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > COMPANY_IMAGE_MAX_BYTES) {
    return { ok: false, error: "Image must be 2 MB or smaller." };
  }
  return { ok: true, url: "" };
}

/**
 * HireHub has no `companies.logo_url` (or similar) column and no Storage bucket
 * policies in-repo. Uploads must not invent schema or bypass RLS.
 */
export const COMPANY_IMAGE_PERSISTENCE_NOTE =
  "Logo preview works here, but HireHub cannot save company images yet: the companies table has no logo/image column, and no Supabase Storage bucket/policies are configured in this project. Add a logo_url column plus a Storage bucket with owner upload RLS to persist logos.";

export function companyImagePersistenceAvailable(hasLogoColumn: boolean, hasUploadBucket: boolean) {
  return hasLogoColumn && hasUploadBucket;
}
