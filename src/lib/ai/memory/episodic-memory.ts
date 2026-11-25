/**
 * A4 episodic memory — durable per-user event log (redacted summaries).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { redactPii } from "@/lib/ai/guardrails/pii";
import {
  isAllowedEventType,
  MEMORY_WRITE_POLICY,
  type EpisodicEventType,
} from "@/lib/ai/memory/memory-write-policy";

export type EpisodicEvent = {
  id?: string;
  userId: string;
  conversationId: string;
  eventType: EpisodicEventType;
  summaryText: string;
  meta?: Record<string, unknown>;
  createdAt?: string;
};

export type EpisodicMemoryStore = {
  append(event: EpisodicEvent): Promise<{ ok: boolean; id?: string; reason?: string }>;
  listRecent(userId: string, limit?: number): Promise<EpisodicEvent[]>;
  deleteAllForUser(userId: string): Promise<{ ok: boolean; deleted: number }>;
};

export function createInMemoryEpisodicStore(): EpisodicMemoryStore & {
  _rows: EpisodicEvent[];
} {
  const rows: EpisodicEvent[] = [];
  return {
    _rows: rows,
    async append(event) {
      if (!isAllowedEventType(event.eventType)) return { ok: false, reason: "policy" };
      const summaryText = redactPii(event.summaryText).text.slice(
        0,
        MEMORY_WRITE_POLICY.maxEpisodicSummaryChars,
      );
      if (!summaryText) return { ok: false, reason: "empty" };
      const id = crypto.randomUUID();
      rows.push({
        ...event,
        id,
        summaryText,
        createdAt: new Date().toISOString(),
      });
      return { ok: true, id };
    },
    async listRecent(userId, limit = 20) {
      return rows
        .filter((r) => r.userId === userId)
        .slice(-limit)
        .reverse();
    },
    async deleteAllForUser(userId) {
      let deleted = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i]?.userId === userId) {
          rows.splice(i, 1);
          deleted++;
        }
      }
      return { ok: true, deleted };
    },
  };
}

export function createSupabaseEpisodicStore(supabase: SupabaseClient): EpisodicMemoryStore {
  const db = supabase as SupabaseClient;
  return {
    async append(event) {
      if (!isAllowedEventType(event.eventType)) return { ok: false, reason: "policy" };
      const summaryText = redactPii(event.summaryText).text.slice(
        0,
        MEMORY_WRITE_POLICY.maxEpisodicSummaryChars,
      );
      if (!event.userId.trim() || !summaryText) return { ok: false, reason: "invalid" };

      const { data, error } = await db
        .from("agent_memory_events")
        .insert({
          user_id: event.userId,
          conversation_id: event.conversationId.slice(0, 128),
          event_type: event.eventType,
          summary_text: summaryText,
          meta: event.meta ?? {},
        })
        .select("id")
        .maybeSingle();

      if (error) {
        const msg = `${error.message ?? ""}`.toLowerCase();
        if (/does not exist|pgrst205|42p01/.test(msg)) {
          return { ok: false, reason: "missing_table" };
        }
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, id: (data as { id?: string } | null)?.id };
    },

    async listRecent(userId, limit = 20) {
      const { data, error } = await db
        .from("agent_memory_events")
        .select("id, user_id, conversation_id, event_type, summary_text, meta, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error || !Array.isArray(data)) return [];
      return data.map((row) => ({
        id: String((row as { id: string }).id),
        userId: String((row as { user_id: string }).user_id),
        conversationId: String((row as { conversation_id: string }).conversation_id),
        eventType: (row as { event_type: EpisodicEventType }).event_type,
        summaryText: String((row as { summary_text: string }).summary_text),
        meta: ((row as { meta?: Record<string, unknown> }).meta ?? {}) as Record<string, unknown>,
        createdAt: String((row as { created_at: string }).created_at),
      }));
    },

    async deleteAllForUser(userId) {
      const { data, error } = await db
        .from("agent_memory_events")
        .delete()
        .eq("user_id", userId)
        .select("id");
      if (error) return { ok: false, deleted: 0 };
      return { ok: true, deleted: Array.isArray(data) ? data.length : 0 };
    },
  };
}
