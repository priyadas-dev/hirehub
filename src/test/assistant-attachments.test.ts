import { describe, expect, it } from "vitest";
import { validateAssistantAttachment } from "@/lib/ai/assistant-attachments";

describe("validateAssistantAttachment", () => {
  it("accepts pdf, images, and docx under 2 MB", () => {
    const pdf = new File([new Uint8Array([1, 2, 3])], "cv.pdf", { type: "application/pdf" });
    const png = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });
    const jpg = new File([new Uint8Array([1])], "photo.jpg", { type: "image/jpeg" });
    const webp = new File([new Uint8Array([1])], "pic.webp", { type: "image/webp" });
    const docx = new File([new Uint8Array([1])], "resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    expect(validateAssistantAttachment(pdf)).toMatchObject({
      ok: true,
      meta: { kind: "pdf" },
    });
    expect(validateAssistantAttachment(png)).toMatchObject({
      ok: true,
      meta: { kind: "image", mime: "image/png" },
    });
    expect(validateAssistantAttachment(jpg)).toMatchObject({
      ok: true,
      meta: { kind: "image", mime: "image/jpeg" },
    });
    expect(validateAssistantAttachment(webp)).toMatchObject({
      ok: true,
      meta: { kind: "image", mime: "image/webp" },
    });
    expect(validateAssistantAttachment(docx)).toMatchObject({
      ok: true,
      meta: { kind: "docx" },
    });
  });

  it("rejects unsupported and oversized files", () => {
    const txt = new File([new Uint8Array([1])], "notes.txt", { type: "text/plain" });
    expect(validateAssistantAttachment(txt).ok).toBe(false);

    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.pdf", {
      type: "application/pdf",
    });
    const rejected = validateAssistantAttachment(big);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toMatch(/2 MB/i);
  });
});
