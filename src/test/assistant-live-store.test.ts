import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureAssistantLiveState,
  getAssistantLiveState,
  resetAssistantLiveConversation,
  runAssistantLiveAsk,
  subscribeAssistantLive,
} from "@/lib/ai/assistant-live-store";

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
      ask: async () =>
        ({
          ok: true,
          answer: "OOP groups data and behaviour into objects.",
          insufficientContext: false,
          ragAvailable: true,
          liveJobsAvailable: true,
          soughtLiveJobs: false,
          corpusCitations: [],
          liveCitations: [],
        }) as never,
    });

    expect(listener.mock.calls.length).toBeGreaterThan(0);
    unsub();
  });
});
