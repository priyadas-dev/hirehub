import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readAssistantHistory,
  renameConversation,
  titleFromQuestion,
  writeAssistantHistory,
} from "@/lib/ai/assistant-history";
import {
  ensureAssistantLiveState,
  getAssistantLiveState,
  resetAssistantLiveConversation,
  runAssistantLiveAsk,
  subscribeAssistantLive,
} from "@/lib/ai/assistant-live-store";

const okAnswer = (answer: string) =>
  ({
    ok: true as const,
    answer,
    insufficientContext: false as const,
    ragAvailable: true as const,
    liveJobsAvailable: true as const,
    soughtLiveJobs: false as const,
    corpusCitations: [] as const,
    liveCitations: [] as const,
  }) as never;

describe("assistant live store", () => {
  afterEach(() => {
    // Reset module state between tests by forcing a new user id space.
    const state = getAssistantLiveState();
    if (state) {
      resetAssistantLiveConversation(state.userId);
    }
  });

  it("keeps pending turns across ensure calls (survives remount)", async () => {
    const userId = "seeker-live-1";
    ensureAssistantLiveState(userId);

    let resolveAsk!: (value: {
      ok: true;
      answer: string;
      insufficientContext: false;
      ragAvailable: true;
      liveJobsAvailable: true;
      soughtLiveJobs: false;
      corpusCitations: [];
      liveCitations: [];
    }) => void;
    const askPromise = new Promise<Parameters<typeof resolveAsk>[0]>((resolve) => {
      resolveAsk = resolve;
    });

    const ask = vi.fn(async () => askPromise);

    const running = runAssistantLiveAsk(userId, {
      question: "What is React?",
      ask: ask as never,
    });

    expect(getAssistantLiveState()?.busy).toBe(true);
    expect(getAssistantLiveState()?.turns.some((t) => t.pending)).toBe(true);

    // Simulate remount — same in-memory store.
    const remounted = ensureAssistantLiveState(userId);
    expect(remounted.busy).toBe(true);
    expect(remounted.turns).toHaveLength(1);
    expect(remounted.turns[0]?.pending).toBe(true);

    resolveAsk({
      ok: true,
      answer: "React is a JavaScript UI library.",
      insufficientContext: false,
      ragAvailable: true,
      liveJobsAvailable: true,
      soughtLiveJobs: false,
      corpusCitations: [],
      liveCitations: [],
    });
    await running;

    expect(getAssistantLiveState()?.busy).toBe(false);
    expect(getAssistantLiveState()?.turns[0]?.pending).toBe(false);
    expect(getAssistantLiveState()?.turns[0]?.result?.ok).toBe(true);
  });

  it("notifies subscribers when a turn completes", async () => {
    const userId = "seeker-live-2";
    ensureAssistantLiveState(userId);
    const listener = vi.fn();
    const unsub = subscribeAssistantLive(listener);

    await runAssistantLiveAsk(userId, {
      question: "Explain OOP briefly.",
      ask: async () => okAnswer("OOP groups data and behaviour into objects."),
    });

    expect(listener.mock.calls.length).toBeGreaterThan(0);
    unsub();
  });

  it("keeps the first-message History title across follow-ups and renames", async () => {
    const userId = "seeker-live-title-1";
    ensureAssistantLiveState(userId);

    const firstQuestion = "I know React, JavaScript and SQL. Find suitable jobs";
    const firstTitle = titleFromQuestion(firstQuestion);

    await runAssistantLiveAsk(userId, {
      question: firstQuestion,
      ask: async () => okAnswer("Here are matching jobs."),
    });

    const afterFirst = readAssistantHistory(userId).conversations[0];
    expect(afterFirst?.title).toBe(firstTitle);
    const conversationId = afterFirst?.id;
    expect(conversationId).toBeTruthy();

    await runAssistantLiveAsk(userId, {
      question: "Show me remote jobs",
      ask: async () => okAnswer("Here are remote jobs."),
    });

    const afterFollowUp = readAssistantHistory(userId).conversations.find(
      (c) => c.id === conversationId,
    );
    expect(afterFollowUp?.title).toBe(firstTitle);
    expect(afterFollowUp?.messages.length).toBeGreaterThanOrEqual(2);

    const renamed = renameConversation(
      readAssistantHistory(userId),
      conversationId!,
      "My React search",
    );
    writeAssistantHistory(userId, renamed);

    await runAssistantLiveAsk(userId, {
      question: "What about full-time roles?",
      ask: async () => okAnswer("Here are full-time roles."),
    });

    const afterRename = readAssistantHistory(userId).conversations.find(
      (c) => c.id === conversationId,
    );
    expect(afterRename?.title).toBe("My React search");
  });
});
