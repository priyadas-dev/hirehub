/**
 * Server-only PDF text extraction for the AI Job Assistant.
 * Never logs resume contents. Uses unpdf (PDF.js) on the server.
 */

import { extractText } from "unpdf";
import { ASSISTANT_ATTACHMENT_MAX_BYTES } from "@/lib/ai/assistant-attachments";

export const RESUME_PDF_MAX_BYTES = ASSISTANT_ATTACHMENT_MAX_BYTES;
export const RESUME_PDF_MIME = "application/pdf" as const;

export type ResumePdfExtractResult =
  | { ok: true; text: string; pageCount: number; charCount: number }
  | {
      ok: false;
      code: "unsupported" | "too_large" | "empty" | "unreadable" | "encrypted";
      message: string;
    };

function looksEncryptedOrEmptyError(message: string): "encrypted" | "unreadable" {
  if (/password|encrypt|secured/i.test(message)) return "encrypted";
  return "unreadable";
}

/** Decode a base64 PDF payload without logging contents. */
export function decodeResumePdfBase64(base64: string): Uint8Array | null {
  const cleaned = base64.replace(/^data:application\/pdf;base64,/i, "").trim();
  if (!cleaned || cleaned.length > RESUME_PDF_MAX_BYTES * 2) return null;
  try {
    const binary = Buffer.from(cleaned, "base64");
    if (binary.byteLength <= 0 || binary.byteLength > RESUME_PDF_MAX_BYTES) return null;
    // PDF magic header
    if (binary[0] !== 0x25 || binary[1] !== 0x50 || binary[2] !== 0x44 || binary[3] !== 0x46) {
      return null;
    }
    return new Uint8Array(binary);
  } catch {
    return null;
  }
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * Extract plain text from a PDF buffer.
 * Returns a clear failure when the PDF is empty, encrypted, or unreadable.
 */
export async function extractResumePdfText(bytes: Uint8Array): Promise<ResumePdfExtractResult> {
  if (bytes.byteLength <= 0) {
    return {
      ok: false,
      code: "empty",
      message: "That PDF is empty. Upload a readable resume PDF, or type your skills in the chat.",
    };
  }
  if (bytes.byteLength > RESUME_PDF_MAX_BYTES) {
    return {
      ok: false,
      code: "too_large",
      message: "Resume PDF must be 2 MB or smaller.",
    };
  }
  if (!hasPdfMagic(bytes)) {
    return {
      ok: false,
      code: "unsupported",
      message: "Only PDF resumes are supported for content matching right now.",
    };
  }

  try {
    const result = await extractText(bytes, { mergePages: true });
    const text = (
      typeof result.text === "string"
        ? result.text
        : Array.isArray(result.text)
          ? result.text.join("\n")
          : ""
    )
      .split("\u0000")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const pageCount = Number(result.totalPages) || 0;

    if (!text || text.length < 40) {
      return {
        ok: false,
        code: "empty",
        message:
          "I could not read enough text from that PDF (it may be scanned or image-only). Upload a text-based PDF or list your skills in chat.",
      };
    }

    return {
      ok: true,
      text,
      pageCount,
      charCount: text.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "PDF parse failed";
    const code = looksEncryptedOrEmptyError(msg);
    return {
      ok: false,
      code,
      message:
        code === "encrypted"
          ? "That PDF appears password-protected. Upload an unlocked PDF or list your skills in chat."
          : "I could not read that PDF. Upload a readable text-based resume PDF or list your skills in chat.",
    };
  }
}
