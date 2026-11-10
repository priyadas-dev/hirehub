/**
 * Lightweight PII redaction for assistant prompts / memory text.
 * Conservative patterns — prefer missing edge cases over mangling job IDs.
 */

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE =
  /(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\w)/g;
const LABELED_ID_RE =
  /\b(?:nid|national\s*id|passport|ssn|social\s*security)\s*[:#-]?\s*\d[\d\s-]{6,}\b/gi;

export type PiiRedactionResult = {
  text: string;
  redacted: boolean;
  kinds: Array<"email" | "phone" | "government_id">;
};

export function redactPii(input: string): PiiRedactionResult {
  const kinds: PiiRedactionResult["kinds"] = [];
  let text = input;

  if (EMAIL_RE.test(text)) {
    kinds.push("email");
    text = text.replace(EMAIL_RE, "[REDACTED_EMAIL]");
  }
  EMAIL_RE.lastIndex = 0;

  if (LABELED_ID_RE.test(text)) {
    kinds.push("government_id");
    text = text.replace(LABELED_ID_RE, "[REDACTED_ID]");
  }
  LABELED_ID_RE.lastIndex = 0;

  if (PHONE_RE.test(text)) {
    kinds.push("phone");
    text = text.replace(PHONE_RE, "[REDACTED_PHONE]");
  }
  PHONE_RE.lastIndex = 0;

  return { text, redacted: kinds.length > 0, kinds };
}
