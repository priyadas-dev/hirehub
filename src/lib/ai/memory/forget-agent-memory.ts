/**
 * A4 "forget me" — delete durable agent memory for the signed-in user.
 * Clears Path B sessions + episodic + semantic layers. JWT only.
 */

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createSupabaseEpisodicStore } from "@/lib/ai/memory/episodic-memory";
import { createSupabaseSemanticStore } from "@/lib/ai/memory/semantic-memory";

export type ForgetAgentMemoryResult =
  | {
      ok: true;
      deleted: { sessions: number; events: number; semantic: number };
    }
  | { ok: false; message: string };

export async function forgetAgentMemoryForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<ForgetAgentMemoryResult> {
  if (!userId.trim()) {
    return { ok: false, message: "Not signed in." };
  }

  const db = supabase as SupabaseClient;
  let sessions = 0;
  let events = 0;
  let semantic = 0;

  const sessionDelete = await db
    .from("agent_sessions")
    .delete()
    .eq("user_id", userId)
    .select("id");
  if (!sessionDelete.error && Array.isArray(sessionDelete.data)) {
    sessions = sessionDelete.data.length;
  } else if (sessionDelete.error) {
    const msg = `${sessionDelete.error.message ?? ""}`.toLowerCase();
    if (!/does not exist|pgrst205|42p01/.test(msg)) {
      return { ok: false, message: "Could not clear conversation memory." };
    }
  }

  const episodic = createSupabaseEpisodicStore(supabase);
  const episodicResult = await episodic.deleteAllForUser(userId);
  events = episodicResult.deleted;

  const semanticStore = createSupabaseSemanticStore(supabase);
  const semanticResult = await semanticStore.deleteAllForUser(userId);
  semantic = semanticResult.deleted;

  return {
    ok: true,
    deleted: { sessions, events, semantic },
  };
}

export const forgetMyAgentMemory = createServerFn({ method: "POST" }).handler(
  async (): Promise<ForgetAgentMemoryResult> => {
    const ctx = await requireSupabaseAuth();
    return forgetAgentMemoryForUser(ctx.supabase as SupabaseClient, ctx.user.id);
  },
);
