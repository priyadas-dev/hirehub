import { beforeEach, describe, expect, it } from "vitest";
import {
  createServerAgentMemory,
} from "@/lib/ai/memory/server-memory";
import {
  createInMemoryAgentSessionDb,
  loadAgentSession,
  saveAgentSession,
} from "@/lib/ai/memory/agent-session-repository";
import {
  _resetDurableUnavailableLatchForTests,
  hydrateDurableAgentMemory,
  persistDurableAgentMemory,
  withDurableAgentMemory,
} from "@/lib/ai/memory/durable-agent-memory";
import {
  mergeAgentSessionPayloads,
  parseAgentSessionPayload,
  conversationMemoryToPayload,
} from "@/lib/ai/memory/agent-session-payload";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const CONV = "seeker-assistant";
const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("Path B payload sanitization", () => {
  it("redacts PII when parsing untrusted JSONB", () => {
    const parsed = parseAgentSessionPayload({
      v: 1,
      turns: [
        {
          role: "user",
          text: "Call 555-123-4567 or me@example.com",
          at: "2026-11-06T00:00:00.000Z",
        },
      ],
      skills: ["React"],
      preferences: { locations: ["Dhaka"], remotePreferred: false, keywords: [] },
      recentJobs: [],
    });
    expect(parsed?.turns[0]?.text).toMatch(/REDACTED/);
    expect(parsed?.turns[0]?.text).not.toContain("555-123-4567");
    expect(parsed?.turns[0]?.text).not.toContain("me@example.com");
  });

  it("strips unexpected turn meta keys from untrusted JSONB", () => {
    const parsed = parseAgentSessionPayload({
      turns: [
        {
          role: "user",
          text: "Find React jobs",
          at: "2026-11-06T00:00:00.000Z",
          meta: {
            intent: "job_search",
            secretToken: "should-not-persist",
            nested: { evil: true },
          },
        },
      ],
      skills: [],
      preferences: { locations: [], remotePreferred: false, keywords: [] },
      recentJobs: [],
    });
    expect(parsed?.turns[0]?.meta?.intent).toBe("job_search");
    expect(parsed?.turns[0]?.meta).not.toHaveProperty("secretToken");
    expect(parsed?.turns[0]?.meta).not.toHaveProperty("nested");
  });

  it("isolated memory factories do not share Maps", () => {
    const a = createServerAgentMemory({ isolated: true });
    const b = createServerAgentMemory({ isolated: true });
    a.mergeSkills(USER_A, CONV, ["React"]);
    expect(b.get(USER_A, CONV)).toBeNull();
    expect(a.getDiscoveryBundle(USER_A, CONV).skills).toEqual(["React"]);
  });

  it("merges skills and recent jobs without dropping either side", () => {
    const a = parseAgentSessionPayload({
      turns: [],
      skills: ["React"],
      preferences: { locations: ["Dhaka"], remotePreferred: false, keywords: [] },
      recentJobs: [{ id: JOB_ID, title: "React Eng" }],
    })!;
    const b = parseAgentSessionPayload({
      turns: [],
      skills: ["TypeScript"],
      preferences: { locations: [], remotePreferred: true, keywords: ["remote"] },
      recentJobs: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "TS Eng" }],
    })!;
    const merged = mergeAgentSessionPayloads(a, b);
    expect(merged.skills).toEqual(expect.arrayContaining(["React", "TypeScript"]));
    expect(merged.preferences.remotePreferred).toBe(true);
    expect(merged.recentJobs).toHaveLength(2);
  });
});

describe("Path B repository (in-memory DB)", () => {
  const db = createInMemoryAgentSessionDb();

  beforeEach(() => {
    db._rows.clear();
  });

  it("round-trips a session for one user", async () => {
    const memory = createServerAgentMemory();
    memory.mergeSkills(USER_A, CONV, ["React"]);
    memory.mergePreferences(USER_A, CONV, {
      locations: ["Dhaka"],
      remotePreferred: false,
      keywords: ["React"],
    });
    const payload = conversationMemoryToPayload(memory.get(USER_A, CONV)!);

    const saved = await saveAgentSession(db, {
      userId: USER_A,
      conversationId: CONV,
      memory: payload,
      expectedUpdatedAt: null,
    });
    expect(saved.ok).toBe(true);

    const loaded = await loadAgentSession(db, USER_A, CONV);
    expect(loaded.ok && loaded.row?.memory.skills).toEqual(["React"]);
  });

  it("does not leak User A memory to User B key", async () => {
    await saveAgentSession(db, {
      userId: USER_A,
      conversationId: CONV,
      memory: parseAgentSessionPayload({
        turns: [],
        skills: ["SecretSkill"],
        preferences: { locations: [], remotePreferred: false, keywords: [] },
        recentJobs: [],
      })!,
      expectedUpdatedAt: null,
    });
    const other = await loadAgentSession(db, USER_B, CONV);
    expect(other.ok && other.row).toBeNull();
  });

  it("merges on concurrent stale update instead of clobbering", async () => {
    const first = await saveAgentSession(db, {
      userId: USER_A,
      conversationId: CONV,
      memory: parseAgentSessionPayload({
        turns: [],
        skills: ["React"],
        preferences: { locations: [], remotePreferred: false, keywords: [] },
        recentJobs: [],
      })!,
      expectedUpdatedAt: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate another writer advancing updated_at under us.
    const row = db._rows.get(`${USER_A}::${CONV}`)!;
    row.memory = parseAgentSessionPayload({
      turns: [],
      skills: ["React", "Node"],
      preferences: { locations: [], remotePreferred: false, keywords: [] },
      recentJobs: [],
    })!;
    row.updated_at = new Date(Date.now() + 1000).toISOString();

    const stale = await saveAgentSession(db, {
      userId: USER_A,
      conversationId: CONV,
      memory: parseAgentSessionPayload({
        turns: [],
        skills: ["TypeScript"],
        preferences: { locations: ["Dhaka"], remotePreferred: false, keywords: [] },
        recentJobs: [],
      })!,
      expectedUpdatedAt: first.updatedAt,
    });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.merged).toBe(true);

    const loaded = await loadAgentSession(db, USER_A, CONV);
    expect(loaded.ok && loaded.row?.memory.skills).toEqual(
      expect.arrayContaining(["React", "Node", "TypeScript"]),
    );
    expect(loaded.ok && loaded.row?.memory.preferences.locations).toContain("Dhaka");
  });
});

describe("Path B hydrate / persist / restart cache", () => {
  const db = createInMemoryAgentSessionDb();
  const memory = createServerAgentMemory();

  beforeEach(() => {
    db._rows.clear();
    memory._resetForTests();
    _resetDurableUnavailableLatchForTests();
  });

  it("survives process-cache clear via hydrate (restart semantics)", async () => {
    memory.enableDurableTracking(USER_A, CONV, null);
    memory.mergeSkills(USER_A, CONV, ["React"]);
    memory.rememberRecentJobs(USER_A, CONV, [
      { id: JOB_ID, title: "React Engineer", location: "Dhaka" },
    ]);

    const persist = await persistDurableAgentMemory({ memory, userId: USER_A, conversationId: CONV, db });
    expect(persist.persisted).toBe(true);

    // Simulate Node restart: clear module Map.
    memory._resetForTests();
    expect(memory.get(USER_A, CONV)).toBeNull();

    const hydrate = await hydrateDurableAgentMemory({ memory, userId: USER_A, conversationId: CONV, db });
    expect(hydrate.hydrated).toBe(true);
    expect(memory.getDiscoveryBundle(USER_A, CONV).skills).toEqual(["React"]);
    expect(memory.getApplicationBundle(USER_A, CONV).recentJobs[0]?.id).toBe(JOB_ID);
  });

  it("withDurableAgentMemory hydrates before run and persists after", async () => {
    await saveAgentSession(db, {
      userId: USER_A,
      conversationId: CONV,
      memory: parseAgentSessionPayload({
        turns: [],
        skills: ["Prior"],
        preferences: { locations: ["Dhaka"], remotePreferred: false, keywords: [] },
        recentJobs: [],
      })!,
      expectedUpdatedAt: null,
    });

    const { result, durable } = await withDurableAgentMemory({
      memory,
      userId: USER_A,
      conversationId: CONV,
      db,
      run: async () => {
        expect(memory.getDiscoveryBundle(USER_A, CONV).skills).toContain("Prior");
        memory.mergeSkills(USER_A, CONV, ["Next"]);
        return "ok";
      },
    });

    expect(result).toBe("ok");
    expect(durable.hydrate.hydrated).toBe(true);
    expect(durable.persist.persisted).toBe(true);

    memory._resetForTests();
    await hydrateDurableAgentMemory({ memory, userId: USER_A, conversationId: CONV, db });
    expect(memory.getDiscoveryBundle(USER_A, CONV).skills).toEqual(
      expect.arrayContaining(["Prior", "Next"]),
    );
  });

  it("falls back safely when DB reports missing relation", async () => {
    const failingDb = {
      async load() {
        return { data: null, error: { code: "42P01", message: "relation agent_sessions does not exist" } };
      },
      async insert() {
        return { data: null, error: { code: "42P01", message: "relation agent_sessions does not exist" } };
      },
      async updateIfUnchanged() {
        return {
          data: null,
          error: { code: "42P01", message: "relation agent_sessions does not exist" },
          matched: false,
        };
      },
    };

    const status = await hydrateDurableAgentMemory({
      memory,
      userId: USER_A,
      conversationId: CONV,
      db: failingDb,
    });
    expect(status.fallback).toBe(true);
    expect(status.reason).toBe("missing_table");

    // In-process Path A still works.
    memory.mergeSkills(USER_A, CONV, ["LocalOnly"]);
    expect(memory.getDiscoveryBundle(USER_A, CONV).skills).toEqual(["LocalOnly"]);
  });
});
