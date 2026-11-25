/**
 * Extract durable semantic facts from already-redacted user text.
 * Heuristic only (free, deterministic) — no paid APIs.
 */

import { extractSearchPreferences } from "@/lib/ai/memory/server-memory";
import { extractSkillsFromQuestion } from "@/lib/ai/skill-extract";
import type { SemanticMemoryKind } from "@/lib/ai/memory/memory-write-policy";
import { MEMORY_WRITE_POLICY } from "@/lib/ai/memory/memory-write-policy";
import { redactPii } from "@/lib/ai/guardrails/pii";

export type ExtractedSemanticFact = {
  kind: SemanticMemoryKind;
  content: string;
  importance: number;
};

const ROLE_PATTERNS: RegExp[] = [
  /\b(?:looking for|want(?:ing)?|seeking|target(?:ing)?|prefer(?:ring)?|interested in)\s+(?:a\s+|an\s+)?([A-Za-z][A-Za-z0-9+#. /-]{2,60}?)(?:\s+role|\s+job|\s+position)?\b/i,
  /\b(?:i am|i'm)\s+a\s+([A-Za-z][A-Za-z0-9+#. /-]{2,60}?)\b/i,
  /\b(front[- ]?end|back[- ]?end|full[- ]?stack|data scientist|product manager|devops|mobile|android|ios)\s+(?:developer|engineer|role|job)?\b/i,
];

const RUBRIC_PATTERNS: RegExp[] = [
  /\b(?:must have|require(?:s|d)?|rubric|screening)\s*:?\s*([A-Za-z0-9+#,./ -]{3,120})/i,
  /\bprefer(?:s|ring)?\s+candidates?\s+(?:with|who)\s+([A-Za-z0-9+#,./ -]{3,120})/i,
];

function pushFact(
  out: ExtractedSemanticFact[],
  kind: SemanticMemoryKind,
  content: string,
  importance: number,
) {
  const scrubbed = redactPii(content).text.trim().slice(0, MEMORY_WRITE_POLICY.maxSemanticContentChars);
  if (!scrubbed || scrubbed.length < 2) return;
  if (out.some((f) => f.kind === kind && f.content.toLowerCase() === scrubbed.toLowerCase())) return;
  out.push({ kind, content: scrubbed, importance });
}

export function extractSemanticFactsFromText(
  redactedText: string,
  options?: { role?: "seeker" | "recruiter" | string | null },
): ExtractedSemanticFact[] {
  const text = redactPii(redactedText).text.trim();
  if (!text) return [];

  const out: ExtractedSemanticFact[] = [];
  const prefs = extractSearchPreferences(text);
  for (const loc of prefs.locations) pushFact(out, "location", loc, 0.8);
  if (prefs.remotePreferred) pushFact(out, "preference", "Prefers remote work", 0.7);
  for (const kw of prefs.keywords) {
    if (/front|back|full|stack|developer|engineer|intern|junior|senior/i.test(kw)) {
      pushFact(out, "target_role", kw, 0.75);
    } else {
      pushFact(out, "preference", kw, 0.55);
    }
  }
  for (const skill of extractSkillsFromQuestion(text)) {
    pushFact(out, "skill", skill, 0.85);
  }
  for (const re of ROLE_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) pushFact(out, "target_role", m[1].trim(), 0.9);
  }
  if (options?.role === "recruiter" || options?.role === "admin") {
    for (const re of RUBRIC_PATTERNS) {
      const m = text.match(re);
      if (m?.[1]) pushFact(out, "recruiter_rubric", m[1].trim(), 0.85);
    }
  }
  return out.slice(0, 12);
}
