import { describe, expect, it } from "vitest";
import { decodeDocxBase64, extractDocxText } from "@/lib/ai/assistant-docx";

describe("assistant-docx", () => {
  it("rejects non-zip / empty payloads", async () => {
    expect(decodeDocxBase64("dGVzdA==")).toBeNull();
    const empty = await extractDocxText(new Uint8Array());
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe("empty");
  });

  it("rejects oversized buffers", async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 10);
    bytes[0] = 0x50;
    bytes[1] = 0x4b;
    const result = await extractDocxText(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("too_large");
  });
});
