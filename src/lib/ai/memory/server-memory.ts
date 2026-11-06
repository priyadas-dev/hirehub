/**
 * Server-side shared memory for multi-agent turns (Phase 6 / Task 3).
 * In-process only — no DB migration. Keyed by userId + conversationId.
 * Callers must pass PII-redacted text; appendTurn also re-redacts defensively.
 */

import { redactPii } from "@/lib/ai/guardrails/pii";

export type AgentMemoryTurn = {
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
  meta?: {
    intent?: string;
    liveJobIds?: string[];
    fairness?: string;
    piiRedacted?: boolean;
    status?: string;
    count?: number;
  };
};

export type AgentMemoryPreferences = {
  locations: string[];
  remotePreferred: boolean;
  keywords: string[];
};

export type AgentMemoryRecentJob = {
  id: string;
  title: string;
  location?: string | null;
  company_name?: string | null;
  job_type?: string | null;
  description?: string | null;
};

export type AgentConversationMemory = {
  userId: string;
  conversationId: string;
  updatedAt: string;
  turns: AgentMemoryTurn[];
  skills: string[];
  preferences: AgentMemoryPreferences;
  recentJobs: AgentMemoryRecentJob[];
};

export type DiscoveryMemoryBundle = {
  skills: string[];
  preferences: AgentMemoryPreferences;
  conversationContext: string;
  /** Compact preference hints for live job queries (already redacted). */
  searchHints: string;
};

export type ApplicationMemoryBundle = {
  /** Recent approved job cards only — no full transcript. */
  recentJobs: AgentMemoryRecentJob[];
};

const store = new Map<string, AgentConversationMemory>();

const EMPTY_PREFS = (): AgentMemoryPreferences => ({
  locations: [],
  remotePreferred: false,
  keywords: [],
});

export function memoryKey(userId: string, conversationId: string): string {
  return `${userId}::${conversationId}`;
}

/** Lightweight job-search preference extraction from already-redacted text. */
export function extractSearchPreferences(redactedQuestion: string): AgentMemoryPreferences {
  const text = redactedQuestion.trim();
  const locations: string[] = [];
  const keywords: string[] = [];

  const inMatch = text.match(
    /\b(?:in|near|around|at)\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?=\s+(?:for|with|and|or|please|jobs?|roles?|positions?)|[.,!?]|$)/i,
  );
  if (inMatch?.[1]) {
    const loc = inMatch[1].trim().replace(/\s+/g, " ");
    if (loc.length >= 2 && loc.length <= 40) locations.push(loc);
  }

  for (const city of ["Dhaka", "Chittagong", "Sylhet", "Khulna", "Rajshahi", "London", "Remote"]) {
    if (new RegExp(`\\b${city}\\b`, "i").test(text) && city.toLowerCase() !== "remote") {
      if (!locations.some((l) => l.toLowerCase() === city.toLowerCase())) locations.push(city);
    }
  }

  const remotePreferred = /\b(remote|work\s+from\s+home|wfh)\b/i.test(text);

  const kw = text.match(
    /\b(full[- ]?stack|front[- ]?end|back[- ]?end|react|node|python|typescript|internship|junior|senior)\b/gi,
  );
  if (kw) {
    for (const k of kw) {
      const norm = k.trim();
      if (!keywords.some((x) => x.toLowerCase() === norm.toLowerCase())) keywords.push(norm);
    }
  }

  return {
    locations: locations.slice(0, 4),
    remotePreferred,
    keywords: keywords.slice(0, 8),
  };
}

export function preferencesToSearchHints(prefs: AgentMemoryPreferences): string {
  const parts: string[] = [];
  if (prefs.locations.length) parts.push(prefs.locations.join(" "));
  if (prefs.remotePreferred) parts.push("remote");
  if (prefs.keywords.length) parts.push(prefs.keywords.slice(0, 4).join(" "));
  return parts.join(" ").trim().slice(0, 160);
}

function mergePreferenceRecords(
  a: AgentMemoryPreferences,
  b: AgentMemoryPreferences,
): AgentMemoryPreferences {
  const locations = [...a.locations];
  for (const loc of b.locations) {
    if (!locations.some((l) => l.toLowerCase() === loc.toLowerCase())) locations.push(loc);
  }
  const keywords = [...a.keywords];
  for (const kw of b.keywords) {
    if (!keywords.some((k) => k.toLowerCase() === kw.toLowerCase())) keywords.push(kw);
  }
  return {
    locations: locations.slice(0, 4),
    remotePreferred: a.remotePreferred || b.remotePreferred,
    keywords: keywords.slice(0, 8),
  };
}

export function createServerAgentMemory(options?: { maxTurns?: number }) {
  const maxTurns = options?.maxTurns ?? 24;

  return {
    get(userId: string, conversationId: string): AgentConversationMemory | null {
      return store.get(memoryKey(userId, conversationId)) ?? null;
    },

    ensure(userId: string, conversationId: string): AgentConversationMemory {
      const key = memoryKey(userId, conversationId);
      const existing = store.get(key);
      if (existing) {
        // Backward-compatible defaults for older in-process shapes in long-lived servers.
        if (!existing.preferences) existing.preferences = EMPTY_PREFS();
        if (!existing.recentJobs) existing.recentJobs = [];
        return existing;
      }
      const created: AgentConversationMemory = {
        userId,
        conversationId,
        updatedAt: new Date().toISOString(),
        turns: [],
        skills: [],
        preferences: EMPTY_PREFS(),
        recentJobs: [],
      };
      store.set(key, created);
      return created;
    },

    /**
     * Append a turn. Text is re-redacted. Exact consecutive duplicates are skipped.
     * @returns whether a new turn was stored
     */
    appendTurn(
      userId: string,
      conversationId: string,
      turn: Omit<AgentMemoryTurn, "at"> & { at?: string },
    ): { memory: AgentConversationMemory; appended: boolean } {
      const mem = this.ensure(userId, conversationId);
      const scrubbed = redactPii(turn.text);
      const text = scrubbed.text.slice(0, 500);
      const last = mem.turns[mem.turns.length - 1];
      if (last && last.role === turn.role && last.text === text) {
        return { memory: mem, appended: false };
      }

      mem.turns.push({
        ...turn,
        text,
        at: turn.at ?? new Date().toISOString(),
        meta: {
          ...turn.meta,
          piiRedacted: Boolean(turn.meta?.piiRedacted || scrubbed.redacted),
        },
      });
      if (mem.turns.length > maxTurns) {
        mem.turns = mem.turns.slice(-maxTurns);
      }
      mem.updatedAt = new Date().toISOString();
      store.set(memoryKey(userId, conversationId), mem);
      return { memory: mem, appended: true };
    },

    mergeSkills(userId: string, conversationId: string, skills: string[]): string[] {
      const mem = this.ensure(userId, conversationId);
      const set = new Set([...mem.skills, ...skills.map((s) => s.trim()).filter(Boolean)]);
      mem.skills = [...set].slice(0, 24);
      mem.updatedAt = new Date().toISOString();
      store.set(memoryKey(userId, conversationId), mem);
      return mem.skills;
    },

    mergePreferences(
      userId: string,
      conversationId: string,
      prefs: Partial<AgentMemoryPreferences> | AgentMemoryPreferences,
    ): AgentMemoryPreferences {
      const mem = this.ensure(userId, conversationId);
      const incoming: AgentMemoryPreferences = {
        locations: prefs.locations ?? [],
        remotePreferred: Boolean(prefs.remotePreferred),
        keywords: prefs.keywords ?? [],
      };
      mem.preferences = mergePreferenceRecords(mem.preferences ?? EMPTY_PREFS(), incoming);
      mem.updatedAt = new Date().toISOString();
      store.set(memoryKey(userId, conversationId), mem);
      return mem.preferences;
    },

    rememberRecentJobs(
      userId: string,
      conversationId: string,
      jobs: AgentMemoryRecentJob[],
    ): AgentMemoryRecentJob[] {
      const mem = this.ensure(userId, conversationId);
      if (!jobs.length) return mem.recentJobs;
      const byId = new Map<string, AgentMemoryRecentJob>();
      for (const j of jobs) {
        if (!j.id?.trim()) continue;
        byId.set(j.id, {
          id: j.id,
          title: (j.title || "Job").slice(0, 160),
          location: j.location ?? null,
          company_name: j.company_name ?? null,
          job_type: j.job_type ?? null,
          description: j.description ? j.description.slice(0, 600) : null,
        });
      }
      // Newest discovery wins ordering; keep prior jobs that weren't replaced.
      for (const prev of mem.recentJobs) {
        if (!byId.has(prev.id)) byId.set(prev.id, prev);
      }
      mem.recentJobs = [...byId.values()].slice(0, 8);
      mem.updatedAt = new Date().toISOString();
      store.set(memoryKey(userId, conversationId), mem);
      return mem.recentJobs;
    },

    /** Prior turns as short context for specialists (PII already redacted). */
    toConversationContext(userId: string, conversationId: string, maxChars = 1200): string {
      const mem = this.get(userId, conversationId);
      if (!mem?.turns.length) return "";
      const lines: string[] = [];
      for (const t of mem.turns.slice(-6)) {
        const label = t.role === "user" ? "User" : t.role === "assistant" ? "Assistant" : "System";
        lines.push(`${label}: ${t.text}`);
      }
      return lines.join("\n").slice(0, maxChars);
    },

    /** Discovery: skills + preferences + transcript snippet. */
    getDiscoveryBundle(userId: string, conversationId: string): DiscoveryMemoryBundle {
      const mem = this.get(userId, conversationId);
      const preferences = mem?.preferences ?? EMPTY_PREFS();
      return {
        skills: mem?.skills ? [...mem.skills] : [],
        preferences: {
          locations: [...preferences.locations],
          remotePreferred: preferences.remotePreferred,
          keywords: [...preferences.keywords],
        },
        conversationContext: this.toConversationContext(userId, conversationId),
        searchHints: preferencesToSearchHints(preferences),
      };
    },

    /** Application: recent job cards only — not full transcript. */
    getApplicationBundle(userId: string, conversationId: string): ApplicationMemoryBundle {
      const mem = this.get(userId, conversationId);
      return {
        recentJobs: mem?.recentJobs ? mem.recentJobs.map((j) => ({ ...j })) : [],
      };
    },

    clear(userId: string, conversationId: string) {
      store.delete(memoryKey(userId, conversationId));
    },

    /** Test helper */
    _resetForTests() {
      store.clear();
    },
  };
}

export type ServerAgentMemory = ReturnType<typeof createServerAgentMemory>;

/** Process-default memory store for the HireHub server runtime. */
export const defaultServerAgentMemory = createServerAgentMemory();
