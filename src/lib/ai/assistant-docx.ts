/**
 * Server-only DOCX text extraction for the AI Job Assistant.
 * Never logs document contents.
 */

import mammoth from "mammoth";
import { ASSISTANT_ATTACHMENT_MAX_BYTES } from "@/lib/ai/assistant-attachments";

export type DocxExtractResult =
  | { ok: true; text: string; charCount: number }
  | {
      ok: false;
      code: "unsupported" | "too_large" | "empty" | "unreadable";
      message: string;
    };

function looksLikeZipDocx(bytes: Uint8Array): boolean {
  // DOCX is a ZIP (PK..) package.
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function decodeDocxBase64(base64: string): Uint8Array | null {
  const cleaned = base64
    .replace(
      /^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/i,
      "",
    )
    .trim();
  if (!cleaned || cleaned.length > ASSISTANT_ATTACHMENT_MAX_BYTES * 2) return null;
  try {
    const binary = Buffer.from(cleaned, "base64");
    if (binary.byteLength <= 0 || binary.byteLength > ASSISTANT_ATTACHMENT_MAX_BYTES) return null;
    const bytes = new Uint8Array(binary);
    if (!looksLikeZipDocx(bytes)) return null;
    return bytes;
  } catch {
    return null;
  }
}

export async function extractDocxText(bytes: Uint8Array): Promise<DocxExtractResult> {
  if (bytes.byteLength <= 0) {
    return {
      ok: false,
      code: "empty",
      message: "That document is empty. Attach a readable DOCX or type your question.",
    };
  }
  if (bytes.byteLength > ASSISTANT_ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      code: "too_large",
      message: "Attachments must be 2 MB or smaller.",
    };
  }
  if (!looksLikeZipDocx(bytes)) {
    return {
      ok: false,
      code: "unsupported",
      message: "That file does not look like a DOCX document.",
    };
  }

  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    const text = (result.value ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 20) {
      return {
        ok: false,
        code: "empty",
        message:
          "I could not read enough text from that DOCX. Try a different file or type your question.",
      };
    }
    return { ok: true, text, charCount: text.length };
  } catch {
    return {
      ok: false,
      code: "unreadable",
      message: "I could not read that DOCX. Attach a valid Word document or type your question.",
    };
  }
}
