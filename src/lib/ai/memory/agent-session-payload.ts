/**
 * Path B — validated redacted memory payload for agent_sessions.memory JSONB.
 * Never store passwords, tokens, or raw PII here; callers redact before persist.
 */

import type {
  AgentConversationMemory,
  AgentMemoryPreferences,
  AgentMemoryRecentJob,
  AgentMemoryTurn,
} from "@/lib/ai/memory/server-memory";
import { redactPii } from "@/lib/ai/guardrails/pii";

export const AGENT_SESSION_PAYLOAD_VERSION = 1 as const;
/** Soft app-side cap (DB also enforces ~64KB via pg_column_size). */
export const AGENT_SESSION_MAX_JSON_CHARS = 48_000;
export const AGENT_SESSION_MAX_CONVERSATION_ID = 128;

export type AgentSessionMemoryPayload = {
  v: typeof AGENT_SESSION_PAYLOAD_VERSION;
  turns: AgentMemoryTurn[];
  skills: string[];
  preferences: AgentMemoryPreferences;
  recentJobs: AgentMemoryRecentJob[];
  /** A4 rolling summary after compaction (PII-redacted). */
  summary?: string;
}

const EMPTY_PREFS = (): AgentMemoryPreferences => ({
  locations: [],
  remotePreferred: false,
  keywords: [],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const t = item.trim().slice(0, 80);
    if (!t) continue;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeTurnMeta(raw: unknown): AgentMemoryTurn["meta"] {
  const base: NonNullable<AgentMemoryTurn["meta"]> = { piiRedacted: true };
  if (!isRecord(raw)) return base;
  if (typeof raw.intent === "string") base.intent = raw.intent.slice(0, 64);
  if (Array.isArray(raw.liveJobIds)) {
    base.liveJobIds = raw.liveJobIds
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.slice(0, 64))
      .slice(0, 8);
  }
  if (typeof raw.fairness === "string") base.fairness = raw.fairness.slice(0, 32);
  if (typeof raw.status === "string") base.status = raw.status.slice(0, 32);
  if (typeof raw.count === "number" && Number.isFinite(raw.count)) {
    base.count = Math.max(0, Math.min(10_000, Math.floor(raw.count)));
  }
  return base;
}

function sanitizeTurn(raw: unknown): AgentMemoryTurn | null {
  if (!isRecord(raw)) return null;
  const role = raw.role;
  if (role !== "user" && role !== "assistant" && role !== "system") return null;
  const textRaw = typeof raw.text === "string" ? raw.text : "";
  const scrubbed = redactPii(textRaw).text.slice(0, 500);
  const at =
    typeof raw.at === "string" && raw.at.trim()
      ? raw.at.slice(0, 40)
      : new Date().toISOString();
  return {
    role,
    text: scrubbed,
    at,
    meta: sanitizeTurnMeta(raw.meta),
  };
}

function sanitizeRecentJob(raw: unknown): AgentMemoryRecentJob | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id || id.length > 64) return null;
  return {
    id,
    title: (typeof raw.title === "string" ? raw.title : "Job").slice(0, 160),
    location: typeof raw.location === "string" ? raw.location.slice(0, 120) : null,
    company_name: typeof raw.company_name === "string" ? raw.company_name.slice(0, 160) : null,
    job_type: typeof raw.job_type === "string" ? raw.job_type.slice(0, 64) : null,
    description: typeof raw.description === "string" ? raw.description.slice(0, 600) : null,
  };
}

function sanitizePreferences(raw: unknown): AgentMemoryPreferences {
  if (!isRecord(raw)) return EMPTY_PREFS();
  return {
    locations: asStringArray(raw.locations, 4),
    remotePreferred: Boolean(raw.remotePreferred),
    keywords: asStringArray(raw.keywords, 8),
  };
}

/** Parse + sanitize untrusted JSONB into a safe payload (or null if unusable). */
export function parseAgentSessionPayload(raw: unknown): AgentSessionMemoryPayload | null {
  if (!isRecord(raw)) return null;
  const turnsIn = Array.isArray(raw.turns) ? raw.turns : [];
  const turns: AgentMemoryTurn[] = [];
  for (const t of turnsIn.slice(-24)) {
    const s = sanitizeTurn(t);
    if (s) turns.push(s);
  }
  const recentJobs: AgentMemoryRecentJob[] = [];
  const jobsIn = Array.isArray(raw.recentJobs) ? raw.recentJobs : [];
  for (const j of jobsIn.slice(0, 8)) {
    const s = sanitizeRecentJob(j);
    if (s) recentJobs.push(s);
  }
  const summaryRaw = typeof raw.summary === "string" ? raw.summary : "";
  const summary = summaryRaw ? redactPii(summaryRaw).text.slice(0, 800) : undefined;

  return {
    v: AGENT_SESSION_PAYLOAD_VERSION,
    turns,
    skills: asStringArray(raw.skills, 24),
    preferences: sanitizePreferences(raw.preferences),
    recentJobs,
    ...(summary ? { summary } : {}),
  };
}

export function conversationMemoryToPayload(
  mem: AgentConversationMemory,
): AgentSessionMemoryPayload {
  const summary = mem.summary?.trim()
    ? redactPii(mem.summary).text.slice(0, 800)
    : undefined;
  return {
    v: AGENT_SESSION_PAYLOAD_VERSION,
    turns: mem.turns.slice(-24).map((t) => ({
      role: t.role,
      text: redactPii(t.text).text.slice(0, 500),
      at: t.at,
      meta: sanitizeTurnMeta(t.meta),
    })),
    skills: mem.skills.slice(0, 24),
    preferences: {
      locations: (mem.preferences?.locations ?? []).slice(0, 4),
      remotePreferred: Boolean(mem.preferences?.remotePreferred),
      keywords: (mem.preferences?.keywords ?? []).slice(0, 8),
    },
    recentJobs: (mem.recentJobs ?? []).slice(0, 8).map((j) => ({
      id: j.id,
      title: (j.title || "Job").slice(0, 160),
      location: j.location ?? null,
      company_name: j.company_name ?? null,
      job_type: j.job_type ?? null,
      description: j.description
        ? redactPii(j.description).text.slice(0, 600)
        : null,
    })),
    ...(summary ? { summary } : {}),
  };
}

/** Merge two payloads without dropping newer skills/jobs; turns deduped then capped. */
export function mergeAgentSessionPayloads(
  a: AgentSessionMemoryPayload,
  b: AgentSessionMemoryPayload,
): AgentSessionMemoryPayload {
  const skillSet = new Set([...a.skills, ...b.skills].map((s) => s.trim()).filter(Boolean));
  const locations = [...a.preferences.locations];
  for (const loc of b.preferences.locations) {
    if (!locations.some((l) => l.toLowerCase() === loc.toLowerCase())) locations.push(loc);
  }
  const keywords = [...a.preferences.keywords];
  for (const kw of b.preferences.keywords) {
    if (!keywords.some((k) => k.toLowerCase() === kw.toLowerCase())) keywords.push(kw);
  }
  const byId = new Map<string, AgentMemoryRecentJob>();
  for (const j of [...a.recentJobs, ...b.recentJobs]) byId.set(j.id, j);

  const turnKey = (t: AgentMemoryTurn) => `${t.role}|${t.at}|${t.text}`;
  const seen = new Set<string>();
  const turns: AgentMemoryTurn[] = [];
  for (const t of [...a.turns, ...b.turns]) {
    const k = turnKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    turns.push(t);
  }

  const summary = (b.summary?.trim() || a.summary?.trim() || "")
    ? redactPii((b.summary?.trim() || a.summary || "").trim()).text.slice(0, 800)
    : undefined;

  return {
    v: AGENT_SESSION_PAYLOAD_VERSION,
    turns: turns.slice(-24),
    skills: [...skillSet].slice(0, 24),
    preferences: {
      locations: locations.slice(0, 4),
      remotePreferred: a.preferences.remotePreferred || b.preferences.remotePreferred,
      keywords: keywords.slice(0, 8),
    },
    recentJobs: [...byId.values()].slice(0, 8),
    ...(summary ? { summary } : {}),
  };
}

export function assertConversationId(conversationId: string): string | null {
  const id = conversationId.trim();
  if (!id || id.length > AGENT_SESSION_MAX_CONVERSATION_ID) return null;
  return id;
}

export function payloadWithinSizeLimit(payload: AgentSessionMemoryPayload): boolean {
  try {
    return JSON.stringify(payload).length <= AGENT_SESSION_MAX_JSON_CHARS;
  } catch {
    return false;
  }
}

/** Shrink turns if serialized payload is oversized. */
export function clampPayloadSize(payload: AgentSessionMemoryPayload): AgentSessionMemoryPayload {
  let next = payload;
  while (!payloadWithinSizeLimit(next) && next.turns.length > 2) {
    next = { ...next, turns: next.turns.slice(Math.ceil(next.turns.length / 4)) };
  }
  if (!payloadWithinSizeLimit(next)) {
    next = {
      ...next,
      turns: next.turns.slice(-4),
      recentJobs: next.recentJobs.slice(0, 3),
      skills: next.skills.slice(0, 8),
    };
  }
  return next;
}
