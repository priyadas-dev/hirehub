/**
 * Server-only image validation + Gemini vision helpers for the AI Job Assistant.
 * Never logs image bytes or API keys.
 */

import { ASSISTANT_ATTACHMENT_MAX_BYTES } from "@/lib/ai/assistant-attachments";
import {
  fetchGeminiGeneratedText,
  GEMINI_CHAT_THINKING_LEVEL,
  readGeminiApiKey,
} from "@/lib/ai/gemini-generate";
import { GEMINI_SERVER_ENV } from "@/lib/ai/gemini";

/** Same Flash family as the Job Assistant answers (avoid importing job-assistant). */
const VISION_MODEL = "gemini-3.8-flash" as const;

export type AssistantImageMime = "image/jpeg" | "image/png" | "image/webp";

export type ImageDecodeResult =
  | { ok: true; bytes: Uint8Array; mime: AssistantImageMime }
  | { ok: false; code: "unsupported" | "too_large" | "empty"; message: string };

function detectImageMime(bytes: Uint8Array): AssistantImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function decodeAssistantImageBase64(
  base64: string,
  claimedMime?: string,
): ImageDecodeResult {
  const cleaned = base64.replace(/^data:image\/(jpeg|jpg|png|webp);base64,/i, "").trim();
  if (!cleaned) {
    return { ok: false, code: "empty", message: "That image is empty." };
  }
  if (cleaned.length > ASSISTANT_ATTACHMENT_MAX_BYTES * 2) {
    return { ok: false, code: "too_large", message: "Attachments must be 2 MB or smaller." };
  }
  let binary: Buffer;
  try {
    binary = Buffer.from(cleaned, "base64");
  } catch {
    return {
      ok: false,
      code: "unsupported",
      message: "That image could not be decoded. Re-attach a JPG, PNG, or WEBP under 2 MB.",
    };
  }
  if (binary.byteLength <= 0) {
    return { ok: false, code: "empty", message: "That image is empty." };
  }
  if (binary.byteLength > ASSISTANT_ATTACHMENT_MAX_BYTES) {
    return { ok: false, code: "too_large", message: "Attachments must be 2 MB or smaller." };
  }
  const bytes = new Uint8Array(binary);
  const detected = detectImageMime(bytes);
  if (!detected) {
    return {
      ok: false,
      code: "unsupported",
      message: "Only JPG, PNG, and WEBP images are supported.",
    };
  }
  if (
    claimedMime &&
    claimedMime !== detected &&
    !(claimedMime === "image/jpg" && detected === "image/jpeg")
  ) {
    // Prefer detected signature over a mismatched client claim.
  }
  return { ok: true, bytes, mime: detected };
}

/**
 * Ask Gemini to describe/OCR an image. Never logs bytes.
 * Uses the same answer model family as the assistant.
 */
export async function analyzeImageWithGemini(input: {
  question: string;
  base64: string;
  mime: AssistantImageMime;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const key = (input.apiKey ?? readGeminiApiKey()).trim();
  if (!key) {
    return {
      ok: false,
      message: "The AI Job Assistant is not configured on this server yet.",
    };
  }

  const decoded = decodeAssistantImageBase64(input.base64, input.mime);
  if (!decoded.ok) return { ok: false, message: decoded.message };

  const prompt = [
    "You are HireHub's assistant. Describe what is visible in the attached image.",
    "If it looks like a resume or skills list, extract readable skills and experience as plain text.",
    "Do not invent qualifications that are not visible. Keep the answer concise.",
    "Never mention API keys or system internals.",
    "",
    `User question: ${input.question}`,
  ].join("\n");

  const model = VISION_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const fetchImpl = input.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: decoded.mime,
                  data: Buffer.from(decoded.bytes).toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 500,
          thinkingConfig: {
            thinkingLevel: GEMINI_CHAT_THINKING_LEVEL,
          },
        },
      }),
    });
  } catch {
    return { ok: false, message: "The assistant could not reach Gemini to read that image." };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    console.error(`[rag:assistant] gemini vision failed http=${response.status} model=${model}`);
    // Fall back to text-only path messaging (no bytes logged).
    const fallback = await fetchGeminiGeneratedText(
      `${prompt}\n\n(Image bytes were provided but vision request failed. Apologize briefly and ask the user to describe the image or attach a PDF/DOCX.)`,
      key,
    );
    if (fallback.ok) return { ok: true, text: fallback.text };
    return {
      ok: false,
      message: "I could not analyze that image right now. Try again or describe it in text.",
    };
  }

  const candidates =
    body && typeof body === "object"
      ? (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
          .candidates
      : null;
  const text = candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .join("\n")
    .trim();

  if (!text) {
    return {
      ok: false,
      message: "I could not extract useful information from that image.",
    };
  }
  return { ok: true, text };
}

/** Soft check that GEMINI_API_KEY env name stays server-only (never VITE_). */
export function imageVisionEnvName(): string {
  return GEMINI_SERVER_ENV.apiKey;
}
