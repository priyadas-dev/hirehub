import { GEMINI_SERVER_ENV } from "@/lib/ai/gemini";
import { GEMINI_ASSISTANT_MODEL } from "@/lib/ai/job-assistant";

export type GenerateTextResult =
  | { ok: true; text: string; model: string }
  | { ok: false; message: string };

function extractGeneratedText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const content = (candidates[0] as { content?: unknown })?.content;
  if (!content || typeof content !== "object") return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  const texts = parts
    .map((p) => (p && typeof p === "object" ? (p as { text?: unknown }).text : null))
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  if (!texts.length) return null;
  return texts.join("\n").trim();
}

/**
 * Server-only Gemini text generation. Never returns the API key.
 */
export async function fetchGeminiGeneratedText(
  prompt: string,
  apiKey: string,
  options?: {
    model?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<GenerateTextResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { ok: false, message: "The AI Job Assistant is not configured on this server yet." };
  }

  const text = prompt.trim();
  if (!text) return { ok: false, message: "Prompt is empty." };

  const model = options?.model ?? GEMINI_ASSISTANT_MODEL;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": trimmedKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 700,
        },
      }),
    });
  } catch {
    return { ok: false, message: "The assistant could not reach Gemini. Try again shortly." };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      message: "The assistant service returned an error. Check server configuration and try again.",
    };
  }

  const generated = extractGeneratedText(body);
  if (!generated) {
    return { ok: false, message: "The assistant returned an empty response." };
  }

  return { ok: true, text: generated, model };
}

export function readGeminiApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env[GEMINI_SERVER_ENV.apiKey]?.trim() ?? "";
}
