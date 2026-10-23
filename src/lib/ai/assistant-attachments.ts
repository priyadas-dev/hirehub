/**
 * Client-side attachment validation for the AI Job Assistant.
 * Supported when server can extract content: PDF, JPG/PNG/WEBP, DOCX (max 2 MB).
 */

export const ASSISTANT_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;

export const ASSISTANT_ATTACHMENT_ACCEPT = [
  "application/pdf",
  ".pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".docx",
].join(",");

export type AssistantAttachmentKind = "pdf" | "image" | "docx";

export type AssistantAttachmentMime =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type AssistantAttachmentMeta = {
  name: string;
  mime: AssistantAttachmentMime;
  sizeBytes: number;
  kind: AssistantAttachmentKind;
};

export type AssistantAttachmentValidation =
  { ok: true; meta: AssistantAttachmentMeta } | { ok: false; error: string };

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function validateAssistantAttachment(file: File): AssistantAttachmentValidation {
  const mime = (file.type || "").toLowerCase();
  const ext = extensionOf(file.name);
  const name = file.name.slice(0, 120) || "attachment";

  if (file.size <= 0) {
    return { ok: false, error: "That file is empty." };
  }
  if (file.size > ASSISTANT_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: "Attachments must be 2 MB or smaller." };
  }

  if (mime === "application/pdf" || ext === ".pdf") {
    return {
      ok: true,
      meta: {
        name: name.endsWith(".pdf") ? name : `${name}.pdf`,
        mime: "application/pdf",
        sizeBytes: file.size,
        kind: "pdf",
      },
    };
  }

  if (mime === "image/jpeg" || mime === "image/jpg" || ext === ".jpg" || ext === ".jpeg") {
    return {
      ok: true,
      meta: { name, mime: "image/jpeg", sizeBytes: file.size, kind: "image" },
    };
  }
  if (mime === "image/png" || ext === ".png") {
    return {
      ok: true,
      meta: { name, mime: "image/png", sizeBytes: file.size, kind: "image" },
    };
  }
  if (mime === "image/webp" || ext === ".webp") {
    return {
      ok: true,
      meta: { name, mime: "image/webp", sizeBytes: file.size, kind: "image" },
    };
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  ) {
    return {
      ok: true,
      meta: {
        name: name.endsWith(".docx") ? name : `${name}.docx`,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: file.size,
        kind: "docx",
      },
    };
  }

  return {
    ok: false,
    error: "Supported attachments: PDF, JPG, PNG, WEBP, or DOCX (max 2 MB).",
  };
}

/** Convert a File to base64 for the server extractor (browser-only). */
export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
