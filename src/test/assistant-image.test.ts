import { describe, expect, it } from "vitest";
import { decodeAssistantImageBase64 } from "@/lib/ai/assistant-image";

describe("assistant-image decode", () => {
  it("accepts JPEG magic bytes", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = decodeAssistantImageBase64(jpeg.toString("base64"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mime).toBe("image/jpeg");
  });

  it("accepts PNG magic bytes", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const result = decodeAssistantImageBase64(png.toString("base64"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mime).toBe("image/png");
  });

  it("rejects malformed / empty", () => {
    expect(decodeAssistantImageBase64("").ok).toBe(false);
    expect(decodeAssistantImageBase64(Buffer.from([1, 2, 3]).toString("base64")).ok).toBe(false);
  });
});
