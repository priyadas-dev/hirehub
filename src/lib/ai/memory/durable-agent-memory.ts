/**
 * Path B — hydrate/persist wrappers around createServerAgentMemory.
 * Falls back to in-process-only memory when agent_sessions is unavailable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ServerAgentMemory } from "@/lib/ai/memory/server-memory";
import {
  createSupabaseAgentSessionDb,
  loadAgentSession,
  saveAgentSession,
  type AgentSessionDb,
} from "@/lib/ai/memory/agent-session-repository";
import { compactAgentSessionPayload } from "@/lib/ai/memory/compaction";

export type DurableMemoryStatus = {
  hydrated: boolean;
  persisted: boolean;
  fallback: boolean;
  reason?: string;
};

/** Process-local latch when agent_sessions is missing — avoid hammering PostgREST. */
let durableStoreUnavailable = false;

/** Don't block chat on a slow / hung agent_sessions probe (Path A fallback). */
const DURABLE_IO_TIMEOUT_MS = 2_500;

/** Test helper */
export function _resetDurableUnavailableLatchForTests() {
  durableStoreUnavailable = false;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Load durable row into the process cache before Supervisor runs.
 * On failure: leave cache as-is (Path A behavior) and return fallback=true.
 */
export async function hydrateDurableAgentMemory(args: {
  memory: ServerAgentMemory;
  userId: string;
  conversationId: string;
  db?: AgentSessionDb;
  supabase?: SupabaseClient<Database> | SupabaseClient;
}): Promise<DurableMemoryStatus> {
  if (durableStoreUnavailable) {
    return { hydrated: false, persisted: false, fallback: true, reason: "unavailable" };
  }

  const db = args.db ?? (args.supabase ? createSupabaseAgentSessionDb(args.supabase) : null);
  if (!db) {
    return { hydrated: false, persisted: false, fallback: true, reason: "no_db" };
  }

  const loadedOrTimeout = await withTimeout(
    loadAgentSession(db, args.userId, args.conversationId),
    DURABLE_IO_TIMEOUT_MS,
  );
  if (loadedOrTimeout === "timeout") {
    return { hydrated: false, persisted: false, fallback: true, reason: "unavailable" };
  }
  const loaded = loadedOrTimeout;
  if (!loaded.ok) {
    if (loaded.reason === "missing_table") durableStoreUnavailable = true;
    return {
      hydrated: false,
      persisted: false,
      fallback: true,
      reason: loaded.reason,
    };
  }

  if (loaded.row) {
    args.memory.replaceFromPayload(
      args.userId,
      args.conversationId,
      loaded.row.memory,
      loaded.row.updatedAt,
    );
  } else {
    args.memory.enableDurableTracking(args.userId, args.conversationId, null);
  }

  return { hydrated: true, persisted: false, fallback: false };
}

/**
 * Persist dirty cache to agent_sessions after Supervisor finishes.
 * Skips when not dirty or when hydrate fell back / durable tracking off.
 */
export async function persistDurableAgentMemory(args: {
  memory: ServerAgentMemory;
  userId: string;
  conversationId: string;
  db?: AgentSessionDb;
  supabase?: SupabaseClient<Database> | SupabaseClient;
}): Promise<DurableMemoryStatus> {
  const meta = args.memory.getDurableMeta(args.userId, args.conversationId);
  if (!meta?.durableEnabled) {
    return { hydrated: false, persisted: false, fallback: true, reason: "not_durable" };
  }
  if (!meta.dirty) {
    return { hydrated: true, persisted: false, fallback: false, reason: "clean" };
  }

  const db = args.db ?? (args.supabase ? createSupabaseAgentSessionDb(args.supabase) : null);
  if (!db) {
    return { hydrated: true, persisted: false, fallback: true, reason: "no_db" };
  }

  const rawPayload = args.memory.toPayload(args.userId, args.conversationId);
  if (!rawPayload) {
    return { hydrated: true, persisted: false, fallback: true, reason: "empty" };
  }

  // A4 Phase 3: compact before durable write so agent_sessions never blows the JSON budget.
  const { payload, metrics } = compactAgentSessionPayload(rawPayload);
  if (metrics.compacted) {
    args.memory.applyCompactedPayload(args.userId, args.conversationId, payload);
  }

  const savedOrTimeout = await withTimeout(
    saveAgentSession(db, {
      userId: args.userId,
      conversationId: args.conversationId,
      memory: payload,
      expectedUpdatedAt: meta.expectedUpdatedAt,
    }),
    DURABLE_IO_TIMEOUT_MS,
  );
  if (savedOrTimeout === "timeout") {
    return { hydrated: true, persisted: false, fallback: true, reason: "unavailable" };
  }
  const saved = savedOrTimeout;

  if (!saved.ok) {
    return {
      hydrated: true,
      persisted: false,
      fallback: true,
      reason: saved.reason,
    };
  }

  args.memory.markPersisted(args.userId, args.conversationId, saved.updatedAt);
  return { hydrated: true, persisted: true, fallback: false };
}

/** Hydrate → run → persist (persist attempted even if run throws). */
export async function withDurableAgentMemory<T>(args: {
  memory: ServerAgentMemory;
  userId: string;
  conversationId: string;
  db?: AgentSessionDb;
  supabase?: SupabaseClient<Database> | SupabaseClient;
  run: () => Promise<T>;
}): Promise<{ result: T; durable: { hydrate: DurableMemoryStatus; persist: DurableMemoryStatus } }> {
  const hydrate = await hydrateDurableAgentMemory(args);
  try {
    const result = await args.run();
    const persist = await persistDurableAgentMemory(args);
    return { result, durable: { hydrate, persist } };
  } catch (err) {
    await persistDurableAgentMemory(args).catch(() => undefined);
    throw err;
  }
}
