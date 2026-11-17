import { describe, expect, it } from "vitest";
import {
  formatSeekerChatUserQuestion,
  stripJobUuidsFromText,
} from "@/lib/ai/assistant-chat-display";

const JOB_ID = "52267b9c-77c4-44e8-83c5-0347aa5ac593";

describe("formatSeekerChatUserQuestion", () => {
  it("replaces confirm-apply UUID dumps with the job title", () => {
    const packed = [
      "show me jobs",
      "apply Software Developer",
      `Please confirm apply to job ${JOB_ID}`,
    ].join("\n");

    expect(
      formatSeekerChatUserQuestion(
        packed,
        new Map([[JOB_ID, "Software Developer"]]),
      ),
    ).toBe("Please confirm apply to Software Developer");
  });

  it("falls back when title is unknown", () => {
    expect(
      formatSeekerChatUserQuestion(`Please confirm apply to job ${JOB_ID}`),
    ).toBe("Please confirm apply");
  });

  it("keeps titled confirm lines without UUID", () => {
    expect(
      formatSeekerChatUserQuestion("Please confirm apply to Software Developer"),
    ).toBe("Please confirm apply to Software Developer");
  });

  it("strips stray UUIDs from normal user text", () => {
    expect(
      formatSeekerChatUserQuestion(`apply to ${JOB_ID} please`),
    ).toBe("apply to please");
  });
});

describe("stripJobUuidsFromText", () => {
  it("removes UUIDs while preserving identity hints", () => {
    const text = `Dibyo Das\nmail is my profile mail\nPlease confirm apply to job ${JOB_ID}`;
    const stripped = stripJobUuidsFromText(text);
    expect(stripped).toContain("Dibyo Das");
    expect(stripped).toContain("mail is my profile mail");
    expect(stripped).not.toContain(JOB_ID);
    expect(stripped).toMatch(/Please confirm apply/);
  });
});
