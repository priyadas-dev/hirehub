import { describe, expect, it } from "vitest";
import {
  createConversationId,
  deleteConversation,
  emptyHistoryStore,
  renameConversation,
  titleFromQuestion,
  upsertConversation,
} from "@/lib/ai/assistant-history";

describe("assistant history helpers", () => {
  it("builds titles and upserts without duplicating conversation ids", () => {
    expect(titleFromQuestion("Find me a software developer job")).toBe(
      "Find me a software developer job",
    );
    const id = createConversationId();
    let store = emptyHistoryStore();
    store = upsertConversation(store, {
      id,
      title: "First",
      updatedAt: "2026-01-01T00:00:00Z",
      messages: [],
    });
    store = upsertConversation(store, {
      id,
      title: "First updated",
      updatedAt: "2026-01-02T00:00:00Z",
      messages: [
        { id: "m1", question: "hi", result: { ok: true }, createdAt: "2026-01-02T00:00:00Z" },
      ],
    });
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0]?.title).toBe("First updated");
  });

  it("renames and deletes conversations", () => {
    let store = emptyHistoryStore();
    store = upsertConversation(store, {
      id: "c1",
      title: "Old",
      updatedAt: "2026-01-01T00:00:00Z",
      messages: [],
    });
    store = renameConversation(store, "c1", "  New title  ");
    expect(store.conversations[0]?.title).toBe("New title");
    store = deleteConversation(store, "c1");
    expect(store.conversations).toHaveLength(0);
  });
});
