/**
 * Wires A4 episodic + semantic stores into SupervisorMemoryLayer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseEpisodicStore,
  createInMemoryEpisodicStore,
  type EpisodicMemoryStore,
} from "@/lib/ai/memory/episodic-memory";
import {
  createSupabaseSemanticStore,
  createInMemorySemanticStore,
  type SemanticMemoryStore,
} from "@/lib/ai/memory/semantic-memory";
import { persistFactsFromUserTurn } from "@/lib/ai/memory/semantic-memory";
import type { SupervisorMemoryLayer } from "@/lib/ai/agents/supervisor";
import { MEMORY_WRITE_POLICY } from "@/lib/ai/memory/memory-write-policy";

export function createSupervisorMemoryLayer(args: {
  supabase?: SupabaseClient;
  semantic?: SemanticMemoryStore;
  episodic?: EpisodicMemoryStore;
  embedImpl?: (texts: string[]) => Promise<number[][]>;
}): SupervisorMemoryLayer {
  const semantic =
    args.semantic ??
    (args.supabase
      ? createSupabaseSemanticStore(args.supabase, { embedImpl: args.embedImpl })
      : createInMemorySemanticStore());
  const episodic =
    args.episodic ??
    (args.supabase ? createSupabaseEpisodicStore(args.supabase) : createInMemoryEpisodicStore());

  return {
    async recall(userId, query) {
      return semantic.recall({
        userId,
        query,
        topK: MEMORY_WRITE_POLICY.recallTopK,
      });
    },
    async persistTurn({ userId, conversationId, redactedText, role }) {
      await episodic.append({
        userId,
        conversationId,
        eventType: "user_turn",
        summaryText: redactedText.slice(0, 400),
        meta: { role: role ?? null },
      });

      const facts = await persistFactsFromUserTurn({
        store: semantic,
        userId,
        redactedText,
        role,
        embedImpl: args.embedImpl,
      });

      for (const fact of facts) {
        await episodic.append({
          userId,
          conversationId,
          eventType: "fact_learned",
          summaryText: `${fact.kind}: ${fact.content}`.slice(0, 400),
          meta: { kind: fact.kind, importance: fact.importance },
        });
      }
    },
  };
}
