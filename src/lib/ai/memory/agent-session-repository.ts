/**
 * Path B — JWT-scoped load/save for public.agent_sessions.
 * Never uses service role. user_id always comes from the authenticated caller.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  assertConversationId,
  clampPayloadSize,
  mergeAgentSessionPayloads,
  parseAgentSessionPayload,
  type AgentSessionMemoryPayload,
} from "@/lib/ai/memory/agent-session-payload";

export type AgentSessionRow = {
  memory: AgentSessionMemoryPayload;
  updatedAt: string;
};

export type AgentSessionLoadResult =
  | { ok: true; row: AgentSessionRow | null; source: "db" | "empty" }
  | { ok: false; fallback: true; reason: "unavailable" | "missing_table" | "invalid" | "forbidden" };

export type AgentSessionSaveResult =
  | { ok: true; updatedAt: string; merged: boolean }
  | {
      ok: false;
      fallback: true;
      reason: "unavailable" | "missing_table" | "invalid" | "conflict_exhausted" | "forbidden";
    };

/** Minimal surface for unit tests (no full Supabase client required). */
export type AgentSessionDb = {
  load(userId: string, conversationId: string): Promise<{
    data: { memory: unknown; updated_at: string } | null;
    error: { message?: string; code?: string } | null;
  }>;
  insert(args: {
    userId: string;
    conversationId: string;
    memory: AgentSessionMemoryPayload;
    updatedAt: string;
  }): Promise<{ data: { updated_at: string } | null; error: { message?: string; code?: string } | null }>;
  updateIfUnchanged(args: {
    userId: string;
    conversationId: string;
    memory: AgentSessionMemoryPayload;
    expectedUpdatedAt: string;
    nextUpdatedAt: string;
  }): Promise<{
    data: { updated_at: string } | null;
    error: { message?: string; code?: string } | null;
    matched: boolean;
  }>;
};

function isMissingRelation(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = `${error.message ?? ""} ${error.code ?? ""}`.toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .*agent_sessions.* does not exist|could not find the table|schema cache/i.test(msg)
  );
}

function isRlsOrAuth(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = `${error.message ?? ""}`.toLowerCase();
  return /permission denied|rls|row-level security|jwt|not authorized|42501/i.test(msg);
}

export function createSupabaseAgentSessionDb(
  supabase: SupabaseClient<Database> | SupabaseClient,
): AgentSessionDb {
  // Untyped until PROPOSED_0027 is applied and types regenerated; cast keeps compile green.
  const db = supabase as SupabaseClient;

  return {
    async load(userId, conversationId) {
      const { data, error } = await db
        .from("agent_sessions")
        .select("memory, updated_at")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .maybeSingle();
      if (error) return { data: null, error };
      if (!data) return { data: null, error: null };
      return {
        data: {
          memory: (data as { memory: unknown }).memory,
          updated_at: (data as { updated_at: string }).updated_at,
        },
        error: null,
      };
    },

    async insert({ userId, conversationId, memory, updatedAt }) {
      const { data, error } = await db
        .from("agent_sessions")
        .insert({
          user_id: userId,
          conversation_id: conversationId,
          memory: memory as unknown as Json,
          updated_at: updatedAt,
        })
        .select("updated_at")
        .maybeSingle();
      return {
        data: data ? { updated_at: (data as { updated_at: string }).updated_at } : null,
        error,
      };
    },

    async updateIfUnchanged({ userId, conversationId, memory, expectedUpdatedAt, nextUpdatedAt }) {
      const { data, error } = await db
        .from("agent_sessions")
        .update({
          memory: memory as unknown as Json,
          updated_at: nextUpdatedAt,
        })
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .eq("updated_at", expectedUpdatedAt)
        .select("updated_at")
        .maybeSingle();
      if (error) return { data: null, error, matched: false };
      if (!data) return { data: null, error: null, matched: false };
      return {
        data: { updated_at: (data as { updated_at: string }).updated_at },
        error: null,
        matched: true,
      };
    },
  };
}

export async function loadAgentSession(
  db: AgentSessionDb,
  userId: string,
  conversationId: string,
): Promise<AgentSessionLoadResult> {
  const conv = assertConversationId(conversationId);
  if (!conv || !userId.trim()) {
    return { ok: false, fallback: true, reason: "invalid" };
  }

  try {
    const { data, error } = await db.load(userId, conv);
    if (error) {
      if (isMissingRelation(error)) return { ok: false, fallback: true, reason: "missing_table" };
      if (isRlsOrAuth(error)) return { ok: false, fallback: true, reason: "forbidden" };
      return { ok: false, fallback: true, reason: "unavailable" };
    }
    if (!data) return { ok: true, row: null, source: "empty" };
    const parsed = parseAgentSessionPayload(data.memory);
    if (!parsed) return { ok: false, fallback: true, reason: "invalid" };
    return {
      ok: true,
      row: { memory: parsed, updatedAt: data.updated_at },
      source: "db",
    };
  } catch {
    return { ok: false, fallback: true, reason: "unavailable" };
  }
}

export async function saveAgentSession(
  db: AgentSessionDb,
  args: {
    userId: string;
    conversationId: string;
    memory: AgentSessionMemoryPayload;
    /** Row updated_at observed at hydrate time; null means insert-or-create. */
    expectedUpdatedAt: string | null;
  },
): Promise<AgentSessionSaveResult> {
  const conv = assertConversationId(args.conversationId);
  if (!conv || !args.userId.trim()) {
    return { ok: false, fallback: true, reason: "invalid" };
  }

  let payload = clampPayloadSize(args.memory);
  const nextUpdatedAt = new Date().toISOString();

  try {
    if (!args.expectedUpdatedAt) {
      const inserted = await db.insert({
        userId: args.userId,
        conversationId: conv,
        memory: payload,
        updatedAt: nextUpdatedAt,
      });
      if (inserted.error) {
        // Concurrent insert race → treat as conflict and merge once.
        if (/duplicate|23505|unique/i.test(`${inserted.error.message ?? ""} ${inserted.error.code ?? ""}`)) {
          return saveAgentSessionWithMerge(db, {
            userId: args.userId,
            conversationId: conv,
            memory: payload,
          });
        }
        if (isMissingRelation(inserted.error)) return { ok: false, fallback: true, reason: "missing_table" };
        if (isRlsOrAuth(inserted.error)) return { ok: false, fallback: true, reason: "forbidden" };
        return { ok: false, fallback: true, reason: "unavailable" };
      }
      return {
        ok: true,
        updatedAt: inserted.data?.updated_at ?? nextUpdatedAt,
        merged: false,
      };
    }

    const updated = await db.updateIfUnchanged({
      userId: args.userId,
      conversationId: conv,
      memory: payload,
      expectedUpdatedAt: args.expectedUpdatedAt,
      nextUpdatedAt,
    });

    if (updated.error) {
      if (isMissingRelation(updated.error)) return { ok: false, fallback: true, reason: "missing_table" };
      if (isRlsOrAuth(updated.error)) return { ok: false, fallback: true, reason: "forbidden" };
      return { ok: false, fallback: true, reason: "unavailable" };
    }

    if (updated.matched && updated.data) {
      return { ok: true, updatedAt: updated.data.updated_at, merged: false };
    }

    // Stale write — reload, merge, retry once.
    return saveAgentSessionWithMerge(db, {
      userId: args.userId,
      conversationId: conv,
      memory: payload,
    });
  } catch {
    return { ok: false, fallback: true, reason: "unavailable" };
  }
}

async function saveAgentSessionWithMerge(
  db: AgentSessionDb,
  args: { userId: string; conversationId: string; memory: AgentSessionMemoryPayload },
): Promise<AgentSessionSaveResult> {
  const loaded = await loadAgentSession(db, args.userId, args.conversationId);
  if (!loaded.ok) return { ok: false, fallback: true, reason: loaded.reason };

  const merged = loaded.row
    ? mergeAgentSessionPayloads(loaded.row.memory, args.memory)
    : args.memory;
  const clamped = clampPayloadSize(merged);
  const nextUpdatedAt = new Date().toISOString();

  if (!loaded.row) {
    const inserted = await db.insert({
      userId: args.userId,
      conversationId: args.conversationId,
      memory: clamped,
      updatedAt: nextUpdatedAt,
    });
    if (inserted.error) {
      if (isMissingRelation(inserted.error)) return { ok: false, fallback: true, reason: "missing_table" };
      return { ok: false, fallback: true, reason: "conflict_exhausted" };
    }
    return { ok: true, updatedAt: inserted.data?.updated_at ?? nextUpdatedAt, merged: true };
  }

  const updated = await db.updateIfUnchanged({
    userId: args.userId,
    conversationId: args.conversationId,
    memory: clamped,
    expectedUpdatedAt: loaded.row.updatedAt,
    nextUpdatedAt,
  });
  if (updated.error || !updated.matched || !updated.data) {
    return { ok: false, fallback: true, reason: "conflict_exhausted" };
  }
  return { ok: true, updatedAt: updated.data.updated_at, merged: true };
}

/** In-memory DB stub for unit tests. */
export function createInMemoryAgentSessionDb(): AgentSessionDb & {
  _rows: Map<string, { memory: AgentSessionMemoryPayload; updated_at: string }>;
} {
  const rows = new Map<string, { memory: AgentSessionMemoryPayload; updated_at: string }>();
  const key = (u: string, c: string) => `${u}::${c}`;
  return {
    _rows: rows,
    async load(userId, conversationId) {
      const row = rows.get(key(userId, conversationId));
      return { data: row ? { memory: row.memory, updated_at: row.updated_at } : null, error: null };
    },
    async insert({ userId, conversationId, memory, updatedAt }) {
      const k = key(userId, conversationId);
      if (rows.has(k)) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      rows.set(k, { memory, updated_at: updatedAt });
      return { data: { updated_at: updatedAt }, error: null };
    },
    async updateIfUnchanged({ userId, conversationId, memory, expectedUpdatedAt, nextUpdatedAt }) {
      const k = key(userId, conversationId);
      const existing = rows.get(k);
      if (!existing || existing.updated_at !== expectedUpdatedAt) {
        return { data: null, error: null, matched: false };
      }
      rows.set(k, { memory, updated_at: nextUpdatedAt });
      return { data: { updated_at: nextUpdatedAt }, error: null, matched: true };
    },
  };
}
