/**
 * A4 rolling summarization / compaction for agent session payloads.
 * Keeps skills, preferences, summary facts; trims raw turns when over budget.
 */

import type { AgentSessionMemoryPayload } from "@/lib/ai/memory/agent-session-payload";
import { MEMORY_WRITE_POLICY } from "@/lib/ai/memory/memory-write-policy";
import { redactPii } from "@/lib/ai/guardrails/pii";

export type CompactionMetrics = {
  beforeTokens: number;
  afterTokens: number;
  beforeTurns: number;
  afterTurns: number;
  compacted: boolean;
  summary: string;
  fidelityFacts: string[];
};

/** Rough token estimate used for A4 before/after evidence (chars/4). */
export function estimateTokens(text: string): number {
  return Math.ceil(Math.max(0, text.length) / 4);
}

export function estimatePayloadTokens(payload: AgentSessionMemoryPayload): number {
  try {
    return estimateTokens(JSON.stringify(payload));
  } catch {
    return 0;
  }
}

function buildExtractiveSummary(payload: AgentSessionMemoryPayload): string {
  const parts: string[] = [];
  if (payload.summary?.trim()) parts.push(payload.summary.trim());
  if (payload.skills.length) parts.push(`Skills: ${payload.skills.slice(0, 12).join(", ")}`);
  const prefs = payload.preferences;
  if (prefs.locations.length) parts.push(`Locations: ${prefs.locations.join(", ")}`);
  if (prefs.remotePreferred) parts.push("Prefers remote");
  if (prefs.keywords.length) parts.push(`Keywords: ${prefs.keywords.slice(0, 8).join(", ")}`);
  const userTurns = payload.turns.filter((t) => t.role === "user").slice(-4);
  for (const t of userTurns) {
    parts.push(`User said: ${t.text.slice(0, 120)}`);
  }
  return redactPii(parts.join(". ")).text.slice(0, 800);
}

/** Key facts that must survive compaction (fidelity check). */
export function extractFidelityFacts(payload: AgentSessionMemoryPayload): string[] {
  const facts: string[] = [];
  for (const s of payload.skills.slice(0, 8)) facts.push(`skill:${s.toLowerCase()}`);
  for (const loc of payload.preferences.locations) facts.push(`location:${loc.toLowerCase()}`);
  for (const kw of payload.preferences.keywords.slice(0, 6)) {
    facts.push(`keyword:${kw.toLowerCase()}`);
  }
  if (payload.preferences.remotePreferred) facts.push("preference:remote");
  if (payload.summary?.trim()) {
    facts.push(`summary:${payload.summary.trim().slice(0, 80).toLowerCase()}`);
  }
  return facts;
}

export function fidelityCheck(
  before: string[],
  afterPayload: AgentSessionMemoryPayload,
): { kept: string[]; missing: string[]; ok: boolean } {
  const afterText = [
    afterPayload.summary ?? "",
    ...afterPayload.skills,
    ...afterPayload.preferences.locations,
    ...afterPayload.preferences.keywords,
    afterPayload.preferences.remotePreferred ? "remote" : "",
    ...afterPayload.turns.map((t) => t.text),
  ]
    .join(" ")
    .toLowerCase();

  const kept: string[] = [];
  const missing: string[] = [];
  for (const fact of before) {
    const value = fact.includes(":") ? fact.slice(fact.indexOf(":") + 1) : fact;
    if (value && afterText.includes(value)) kept.push(fact);
    else missing.push(fact);
  }
  return { kept, missing, ok: missing.length === 0 };
}

/**
 * Compact when turns exceed threshold or payload is large.
 * Preserves skills/preferences; writes rolling summary; trims turns.
 */
export function compactAgentSessionPayload(
  payload: AgentSessionMemoryPayload,
  options?: { force?: boolean; turnThreshold?: number; keepTurns?: number },
): { payload: AgentSessionMemoryPayload; metrics: CompactionMetrics } {
  const turnThreshold = options?.turnThreshold ?? MEMORY_WRITE_POLICY.compactTurnThreshold;
  const keepTurns = options?.keepTurns ?? MEMORY_WRITE_POLICY.keepTurnsAfterCompact;
  const beforeTokens = estimatePayloadTokens(payload);
  const beforeTurns = payload.turns.length;
  const fidelityFacts = extractFidelityFacts(payload);

  const shouldCompact =
    Boolean(options?.force) ||
    payload.turns.length > turnThreshold ||
    beforeTokens > 6_000;

  if (!shouldCompact) {
    return {
      payload,
      metrics: {
        beforeTokens,
        afterTokens: beforeTokens,
        beforeTurns,
        afterTurns: beforeTurns,
        compacted: false,
        summary: payload.summary ?? "",
        fidelityFacts,
      },
    };
  }

  const summary = buildExtractiveSummary(payload);
  const next: AgentSessionMemoryPayload = {
    ...payload,
    summary,
    turns: payload.turns.slice(-keepTurns),
  };

  return {
    payload: next,
    metrics: {
      beforeTokens,
      afterTokens: estimatePayloadTokens(next),
      beforeTurns,
      afterTurns: next.turns.length,
      compacted: true,
      summary,
      fidelityFacts,
    },
  };
}
