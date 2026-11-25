/**
 * Assessment 4 — Memory Layer unit evidence.
 */

import { describe, expect, it } from "vitest";
import { redactPii } from "@/lib/ai/guardrails/pii";
import {
  compactAgentSessionPayload,
  estimatePayloadTokens,
  fidelityCheck,
  extractFidelityFacts,
} from "@/lib/ai/memory/compaction";
import { extractSemanticFactsFromText } from "@/lib/ai/memory/fact-extract";
import { MEMORY_WRITE_POLICY } from "@/lib/ai/memory/memory-write-policy";
import { createInMemoryEpisodicStore } from "@/lib/ai/memory/episodic-memory";
import {
  createInMemorySemanticStore,
  formatRecalledMemoryBlock,
  persistFactsFromUserTurn,
  recalledMemoriesToDiscoveryEnrichment,
} from "@/lib/ai/memory/semantic-memory";
import { createSupervisorMemoryLayer } from "@/lib/ai/memory/supervisor-memory-layer";
import { createServerAgentMemory } from "@/lib/ai/memory/server-memory";
import { runSupervisor } from "@/lib/ai/agents/supervisor";
import type { AgentSessionMemoryPayload } from "@/lib/ai/memory/agent-session-payload";
import { parseAgentSessionPayload } from "@/lib/ai/memory/agent-session-payload";

function fakeEmbed(texts: string[]): Promise<number[][]> {
  return Promise.resolve(
    texts.map((t) => {
      const dims = 384;
      const out = new Array<number>(dims);
      let sumSq = 0;
      const seed = t.length + t.charCodeAt(0);
      for (let i = 0; i < dims; i++) {
        const v = Math.sin(seed * (i + 1) * 12.9898) * 10000;
        out[i] = v - Math.floor(v);
        sumSq += out[i]! * out[i]!;
      }
      const norm = Math.sqrt(sumSq) || 1;
      return out.map((n) => n / norm);
    }),
  );
}

describe("A4 write policy + fact extract", () => {
  it("extracts location, skills, and target role from redacted seeker text", () => {
    const facts = extractSemanticFactsFromText(
      "I am strongest in React and TypeScript. Looking for a frontend role in Dhaka.",
    );
    expect(facts.some((f) => f.kind === "location" && /dhaka/i.test(f.content))).toBe(true);
    expect(facts.some((f) => f.kind === "skill")).toBe(true);
    expect(facts.some((f) => f.kind === "target_role" || f.kind === "preference")).toBe(true);
  });

  it("redacts PII before semantic content is considered durable", () => {
    const scrubbed = redactPii(
      "Call me at 01712345678 or email priya@example.com — I want React jobs in Dhaka",
    ).text;
    expect(scrubbed).not.toMatch(/01712345678/);
    expect(scrubbed).not.toMatch(/priya@example.com/i);
    for (const f of extractSemanticFactsFromText(scrubbed)) {
      expect(f.content).not.toMatch(/@/);
      expect(f.content).not.toMatch(/\d{8,}/);
    }
  });

  it("exposes explicit allow-lists for kinds and events", () => {
    expect(MEMORY_WRITE_POLICY.allowedSemanticKinds).toContain("target_role");
    expect(MEMORY_WRITE_POLICY.neverPersist).toContain("passwords");
    expect(MEMORY_WRITE_POLICY.recallTopK).toBe(5);
  });

  it("rejects semantic upserts outside the write policy", async () => {
    const store = createInMemorySemanticStore();
    const rejected = await store.upsertFact({
      userId: "u1",
      kind: "password" as never,
      content: "secret-password-value",
      embedding: (await fakeEmbed(["secret"]))[0],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe("policy");
  });

  it("isolates semantic recall by user_id (RLS-shaped own-row behavior)", async () => {
    const store = createInMemorySemanticStore();
    await persistFactsFromUserTurn({
      store,
      userId: "user-a",
      redactedText: "React jobs in Dhaka",
      embedImpl: fakeEmbed,
    });
    await persistFactsFromUserTurn({
      store,
      userId: "user-b",
      redactedText: "Python jobs in Sylhet",
      embedImpl: fakeEmbed,
    });
    const forA = await store.recall({
      userId: "user-a",
      query: "jobs",
      queryEmbedding: (await fakeEmbed(["React Dhaka"]))[0],
    });
    expect(forA.every((m) => !/sylhet|python/i.test(m.content))).toBe(true);
    expect(forA.some((m) => /dhaka|react/i.test(m.content))).toBe(true);
  });
});

describe("A4 semantic recall session1 → session2", () => {
  it("recalls a fact learned in session 1 during session 2 query", async () => {
    const store = createInMemorySemanticStore();
    const userId = "user-a4-1";
    await persistFactsFromUserTurn({
      store,
      userId,
      redactedText: "I want Frontend developer roles in Dhaka with React",
      embedImpl: fakeEmbed,
    });
    const recalled = await store.recall({
      userId,
      query: "What jobs fit me?",
      queryEmbedding: (await fakeEmbed(["Frontend React Dhaka"]))[0],
      topK: 5,
    });
    expect(recalled.length).toBeGreaterThan(0);
    expect(formatRecalledMemoryBlock(recalled).toLowerCase()).toMatch(/dhaka|react|frontend/);
  });

  it("enriches Discovery searchHints from recalled semantic facts", () => {
    const enrichment = recalledMemoriesToDiscoveryEnrichment([
      {
        id: "1",
        kind: "location",
        content: "Dhaka",
        similarity: 0.9,
        score: 0.9,
        lastSeenAt: new Date().toISOString(),
      },
      {
        id: "2",
        kind: "skill",
        content: "React",
        similarity: 0.88,
        score: 0.88,
        lastSeenAt: new Date().toISOString(),
      },
    ]);
    expect(enrichment.skills).toContain("React");
    expect(enrichment.searchHints.toLowerCase()).toMatch(/dhaka/);
  });

  it("side-by-side: warm memory block is non-empty vs cold start empty", async () => {
    const store = createInMemorySemanticStore();
    const userId = "user-a4-side";
    const cold = await store.recall({
      userId,
      query: "show me jobs",
      queryEmbedding: (await fakeEmbed(["show me jobs"]))[0],
    });
    expect(cold).toHaveLength(0);

    await persistFactsFromUserTurn({
      store,
      userId,
      redactedText: "Target role: Backend engineer. Location: Sylhet. Skill: Node",
      embedImpl: fakeEmbed,
    });
    const warm = await store.recall({
      userId,
      query: "show me jobs",
      queryEmbedding: (await fakeEmbed(["Backend Node Sylhet"]))[0],
    });
    expect(warm.length).toBeGreaterThan(0);
    expect(formatRecalledMemoryBlock(warm)).toMatch(/Known about this user/);
  });

  it("forget-me clears semantic recall", async () => {
    const store = createInMemorySemanticStore();
    const userId = "user-forget";
    await persistFactsFromUserTurn({
      store,
      userId,
      redactedText: "React jobs in Dhaka",
      embedImpl: fakeEmbed,
    });
    expect(
      (
        await store.recall({
          userId,
          query: "jobs",
          queryEmbedding: (await fakeEmbed(["React Dhaka"]))[0],
        })
      ).length,
    ).toBeGreaterThan(0);
    const deleted = await store.deleteAllForUser(userId);
    expect(deleted.ok).toBe(true);
    expect(
      await store.recall({
        userId,
        query: "jobs",
        queryEmbedding: (await fakeEmbed(["React Dhaka"]))[0],
      }),
    ).toHaveLength(0);
  });

  it("forget-me clears Path A process cache for the user", () => {
    const memory = createServerAgentMemory({ isolated: true });
    const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
    memory.mergeSkills(userId, "c1", ["React"]);
    memory.mergeSkills("other-user", "c1", ["Go"]);
    expect(memory.clearAllForUser(userId)).toBeGreaterThan(0);
    expect(memory.get(userId, "c1")).toBeNull();
    expect(memory.get("other-user", "c1")?.skills).toContain("Go");
  });

  it("forget-me clears episodic events for the user", async () => {
    const episodic = createInMemoryEpisodicStore();
    await episodic.append({
      userId: "ep-user",
      conversationId: "c1",
      eventType: "user_turn",
      summaryText: "Looking for React in Dhaka",
    });
    await episodic.append({
      userId: "ep-other",
      conversationId: "c1",
      eventType: "user_turn",
      summaryText: "Looking for Go",
    });
    const cleared = await episodic.deleteAllForUser("ep-user");
    expect(cleared.deleted).toBe(1);
    expect(await episodic.listRecent("ep-user")).toHaveLength(0);
    expect(await episodic.listRecent("ep-other")).toHaveLength(1);
  });
});

describe("A4 compaction + fidelity", () => {
  it("reduces tokens and keeps key facts", () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text:
        i % 2 === 0
          ? `I am a React developer in Dhaka looking for frontend work turn ${i}`
          : `Here are some jobs for you turn ${i}`,
      at: new Date(2026, 0, 1, 0, i).toISOString(),
    }));
    const payload: AgentSessionMemoryPayload = {
      v: 1,
      turns,
      skills: ["React", "TypeScript"],
      preferences: {
        locations: ["Dhaka"],
        remotePreferred: false,
        keywords: ["frontend", "React"],
      },
      recentJobs: [],
    };
    const beforeFacts = extractFidelityFacts(payload);
    const beforeTokens = estimatePayloadTokens(payload);
    const { payload: after, metrics } = compactAgentSessionPayload(payload, { force: true });
    expect(metrics.compacted).toBe(true);
    expect(metrics.afterTokens).toBeLessThan(beforeTokens);
    expect(fidelityCheck(beforeFacts, after).ok).toBe(true);
  });

  it("parseAgentSessionPayload re-redacts summary on read", () => {
    const parsed = parseAgentSessionPayload({
      v: 1,
      turns: [],
      skills: [],
      preferences: { locations: [], remotePreferred: false, keywords: [] },
      recentJobs: [],
      summary: "Candidate email is leak@example.com in Dhaka",
    });
    expect(parsed?.summary).toBeTruthy();
    expect(parsed?.summary).not.toMatch(/leak@example.com/i);
  });
});

describe("A4 supervisor memory layer inject", () => {
  it("injects recalled memory into discovery conversation context", async () => {
    const semantic = createInMemorySemanticStore();
    const episodic = createInMemoryEpisodicStore();
    const memoryLayer = createSupervisorMemoryLayer({
      semantic,
      episodic,
      embedImpl: fakeEmbed,
    });
    const memory = createServerAgentMemory({ isolated: true });
    const userId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";

    await persistFactsFromUserTurn({
      store: semantic,
      userId,
      redactedText: "Frontend React Dhaka",
      embedImpl: fakeEmbed,
    });

    const result = await runSupervisor(
      { question: "Find developer jobs for me" },
      {
        role: "seeker",
        userId,
        conversationId: "conv-a4",
        memory,
        memoryLayer,
        listLiveJobs: async () => ({
          ok: true as const,
          jobs: [
            {
              id: "job-1",
              title: "React Developer",
              location: "Dhaka",
              company_name: "Acme",
              company_id: "co-1",
              job_type: "full_time",
              description: "React TypeScript",
              status: "approved",
              created_at: new Date().toISOString(),
            },
          ],
        }),
        retrieveCorpus: async () => ({ ok: true as const, matches: [] }),
        runLegacyPipeline: async () => ({
          ok: true as const,
          answer: "legacy",
          insufficientContext: false,
          ragAvailable: false,
          liveJobsAvailable: false,
          soughtLiveJobs: false,
          corpusCitations: [],
          liveCitations: [],
          model: "test",
        }),
      },
    );

    expect(result).toMatchObject({ ok: true });
    const events = await episodic.listRecent(userId, 20);
    expect(events.some((e) => e.eventType === "user_turn")).toBe(true);
    expect(result.supervisor?.semanticRecall?.count).toBeGreaterThan(0);
  });
});
