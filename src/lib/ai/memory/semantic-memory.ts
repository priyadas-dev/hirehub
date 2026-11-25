/**
 * A4 semantic / long-term memory — embed + upsert + similarity recall.
 * Uses gte-small 384-d to match agent_semantic_memories.embedding_gte.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts } from "@/lib/ai/embed-provider";
import { GTE_EMBEDDING_DIMENSIONS } from "@/lib/ai/gte-embed";
import { redactPii } from "@/lib/ai/guardrails/pii";
import {
  extractSemanticFactsFromText,
  type ExtractedSemanticFact,
} from "@/lib/ai/memory/fact-extract";
import {
  MEMORY_WRITE_POLICY,
  isAllowedSemanticKind,
  type SemanticMemoryKind,
} from "@/lib/ai/memory/memory-write-policy";

export type RecalledSemanticMemory = {
  id: string;
  kind: string;
  content: string;
  similarity: number;
  score: number;
  lastSeenAt: string;
};

export type SemanticMemoryStore = {
  upsertFact(args: {
    userId: string;
    kind: SemanticMemoryKind;
    content: string;
    importance?: number;
    embedding?: number[];
  }): Promise<{ ok: boolean; id?: string; reason?: string }>;
  recall(args: {
    userId: string;
    query: string;
    topK?: number;
    queryEmbedding?: number[];
  }): Promise<RecalledSemanticMemory[]>;
  deleteAllForUser(userId: string): Promise<{ ok: boolean; deleted: number }>;
};

function contentHash(kind: string, content: string): string {
  const s = `${kind}::${content.toLowerCase()}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = (h >>> 0).toString(16).padStart(8, "0");
  let h2 = 0;
  for (let i = 0; i < s.length; i++) h2 = (Math.imul(31, h2) + s.charCodeAt(i)) | 0;
  const b = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${a}${b}${s.length.toString(16)}`.slice(0, 40);
}

function unitVector(dims: number, seed: number): number[] {
  const out = new Array<number>(dims);
  let sumSq = 0;
  for (let i = 0; i < dims; i++) {
    const v = Math.sin(seed * (i + 1) * 12.9898) * 10000;
    out[i] = v - Math.floor(v);
    sumSq += out[i]! * out[i]!;
  }
  const norm = Math.sqrt(sumSq) || 1;
  return out.map((n) => n / norm);
}

async function embedForMemory(
  text: string,
  embedImpl?: (texts: string[]) => Promise<number[][]>,
): Promise<number[] | null> {
  if (embedImpl) {
    const rows = await embedImpl([text]);
    const vec = rows[0];
    if (!vec || vec.length !== GTE_EMBEDDING_DIMENSIONS) return null;
    return vec;
  }
  const result = await embedTexts([text], { provider: "gte" });
  if (!result.ok || !result.embeddings[0]) return null;
  const vec = result.embeddings[0];
  if (vec.length !== GTE_EMBEDDING_DIMENSIONS) return null;
  return vec;
}

export function formatRecalledMemoryBlock(memories: RecalledSemanticMemory[]): string {
  if (!memories.length) return "";
  const lines = memories.map((m, i) => `${i + 1}. [${m.kind}] ${m.content}`);
  return `Known about this user (from memory):\n${lines.join("\n")}`.slice(0, 1200);
}

export function recalledMemoriesToDiscoveryEnrichment(memories: RecalledSemanticMemory[]): {
  skills: string[];
  searchHints: string;
} {
  const skills: string[] = [];
  const locations: string[] = [];
  const keywords: string[] = [];
  for (const m of memories) {
    const content = m.content.trim();
    if (!content) continue;
    if (m.kind === "skill") {
      if (!skills.some((s) => s.toLowerCase() === content.toLowerCase())) skills.push(content);
    } else if (m.kind === "location") {
      if (!locations.some((l) => l.toLowerCase() === content.toLowerCase())) locations.push(content);
    } else if (m.kind === "target_role" || m.kind === "preference") {
      if (!keywords.some((k) => k.toLowerCase() === content.toLowerCase())) {
        keywords.push(content.slice(0, 40));
      }
    }
  }
  const searchHints = [...locations, ...keywords.slice(0, 4), ...skills.slice(0, 4)]
    .join(" ")
    .trim()
    .slice(0, 160);
  return { skills: skills.slice(0, 12), searchHints };
}

export function semanticRecallTraceMeta(memories: RecalledSemanticMemory[]): {
  count: number;
  kinds: string[];
  preview: string;
} {
  return {
    count: memories.length,
    kinds: [...new Set(memories.map((m) => m.kind))],
    preview: formatRecalledMemoryBlock(memories).slice(0, 280),
  };
}

export function createInMemorySemanticStore(): SemanticMemoryStore & {
  _rows: Map<
    string,
    {
      id: string;
      userId: string;
      kind: string;
      content: string;
      contentHash: string;
      embedding: number[];
      importance: number;
      lastSeenAt: string;
    }
  >;
} {
  const rows = new Map<
    string,
    {
      id: string;
      userId: string;
      kind: string;
      content: string;
      contentHash: string;
      embedding: number[];
      importance: number;
      lastSeenAt: string;
    }
  >();

  return {
    _rows: rows,
    async upsertFact({ userId, kind, content, importance = 0.5, embedding }) {
      if (!isAllowedSemanticKind(kind)) return { ok: false, reason: "policy" };
      const scrubbed = redactPii(content).text.slice(0, MEMORY_WRITE_POLICY.maxSemanticContentChars);
      if (!scrubbed) return { ok: false, reason: "empty" };
      const hash = contentHash(kind, scrubbed);
      const key = `${userId}::${kind}::${hash}`;
      const emb = embedding ?? unitVector(GTE_EMBEDDING_DIMENSIONS, scrubbed.length);
      const existing = rows.get(key);
      const id = existing?.id ?? crypto.randomUUID();
      rows.set(key, {
        id,
        userId,
        kind,
        content: scrubbed,
        contentHash: hash,
        embedding: emb,
        importance,
        lastSeenAt: new Date().toISOString(),
      });
      return { ok: true, id };
    },
    async recall({ userId, query, topK = MEMORY_WRITE_POLICY.recallTopK, queryEmbedding }) {
      const q = queryEmbedding ?? unitVector(GTE_EMBEDDING_DIMENSIONS, query.length);
      const scored: RecalledSemanticMemory[] = [];
      for (const row of rows.values()) {
        if (row.userId !== userId) continue;
        let dot = 0;
        for (let i = 0; i < q.length; i++) dot += q[i]! * (row.embedding[i] ?? 0);
        const similarity = Math.max(0, Math.min(1, dot));
        const score = similarity * 0.75 + row.importance * 0.25;
        scored.push({
          id: row.id,
          kind: row.kind,
          content: row.content,
          similarity,
          score,
          lastSeenAt: row.lastSeenAt,
        });
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, topK);
    },
    async deleteAllForUser(userId) {
      let deleted = 0;
      for (const [k, row] of rows) {
        if (row.userId === userId) {
          rows.delete(k);
          deleted++;
        }
      }
      return { ok: true, deleted };
    },
  };
}

export function createSupabaseSemanticStore(
  supabase: SupabaseClient,
  options?: { embedImpl?: (texts: string[]) => Promise<number[][]> },
): SemanticMemoryStore {
  const db = supabase as SupabaseClient;

  return {
    async upsertFact({ userId, kind, content, importance = 0.5, embedding }) {
      if (!isAllowedSemanticKind(kind)) return { ok: false, reason: "policy" };
      const scrubbed = redactPii(content).text.slice(0, MEMORY_WRITE_POLICY.maxSemanticContentChars);
      if (!userId.trim() || !scrubbed) return { ok: false, reason: "invalid" };
      const hash = contentHash(kind, scrubbed);
      const emb = embedding ?? (await embedForMemory(scrubbed, options?.embedImpl));
      if (!emb) return { ok: false, reason: "embed_failed" };

      const now = new Date().toISOString();
      const { data, error } = await db
        .from("agent_semantic_memories")
        .upsert(
          {
            user_id: userId,
            kind,
            content: scrubbed,
            content_hash: hash,
            embedding_gte: emb as unknown as string,
            importance,
            last_seen_at: now,
            updated_at: now,
          },
          { onConflict: "user_id,kind,content_hash" },
        )
        .select("id")
        .maybeSingle();

      if (error) {
        const msg = `${error.message ?? ""}`.toLowerCase();
        if (/does not exist|pgrst205|42p01/.test(msg)) return { ok: false, reason: "missing_table" };
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, id: (data as { id?: string } | null)?.id };
    },

    async recall({ userId, query, topK = MEMORY_WRITE_POLICY.recallTopK, queryEmbedding }) {
      if (!userId.trim()) return [];
      const emb =
        queryEmbedding ?? (await embedForMemory(redactPii(query).text, options?.embedImpl));
      if (!emb) return [];

      const { data, error } = await db.rpc("match_agent_semantic_memories", {
        query_embedding: emb as unknown as string,
        match_count: topK,
      });

      if (error || !Array.isArray(data)) return [];
      return (data as Array<Record<string, unknown>>)
        .filter((row) => Boolean(row.id))
        .map((row) => ({
          id: String(row.id),
          kind: String(row.kind ?? ""),
          content: String(row.content ?? ""),
          similarity: Number(row.similarity ?? 0),
          score: Number(row.score ?? row.similarity ?? 0),
          lastSeenAt: String(row.last_seen_at ?? ""),
        }));
    },

    async deleteAllForUser(userId) {
      const { data, error } = await db
        .from("agent_semantic_memories")
        .delete()
        .eq("user_id", userId)
        .select("id");
      if (error) return { ok: false, deleted: 0 };
      return { ok: true, deleted: Array.isArray(data) ? data.length : 0 };
    },
  };
}

export async function persistFactsFromUserTurn(args: {
  store: SemanticMemoryStore;
  userId: string;
  redactedText: string;
  role?: string | null;
  embedImpl?: (texts: string[]) => Promise<number[][]>;
}): Promise<ExtractedSemanticFact[]> {
  const facts = extractSemanticFactsFromText(args.redactedText, { role: args.role });
  for (const fact of facts) {
    const emb = args.embedImpl ? (await args.embedImpl([fact.content]))[0] : undefined;
    await args.store.upsertFact({
      userId: args.userId,
      kind: fact.kind,
      content: fact.content,
      importance: fact.importance,
      embedding: emb,
    });
  }
  return facts;
}
