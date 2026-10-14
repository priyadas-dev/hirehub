import { describe, expect, it } from "vitest";
import {
  PORTFOLIO_PERSISTENCE_NOTE,
  RESUME_PDF_MAX_BYTES,
  portfolioPersistenceAvailable,
  resumePdfPersistenceAvailable,
  uploadResumePdfIfSupported,
  validatePortfolioUrl,
  validateResumePdfFile,
} from "@/lib/resume-upload";

describe("resume PDF validation", () => {
  it("accepts PDF by mime or extension", () => {
    const byMime = new File([new Uint8Array(32)], "cv.pdf", { type: "application/pdf" });
    expect(validateResumePdfFile(byMime).ok).toBe(true);

    const byExt = new File([new Uint8Array(32)], "cv.PDF", { type: "" });
    expect(validateResumePdfFile(byExt).ok).toBe(true);
  });

  it("rejects non-PDF and oversized files", () => {
    const doc = new File([new Uint8Array(8)], "notes.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(validateResumePdfFile(doc).ok).toBe(false);

    const tooBig = new File([new Uint8Array(RESUME_PDF_MAX_BYTES + 1)], "big.pdf", {
      type: "application/pdf",
    });
    expect(validateResumePdfFile(tooBig).ok).toBe(false);
  });

  it("does not claim upload persistence without a Storage bucket", () => {
    expect(resumePdfPersistenceAvailable(true, false)).toBe(false);
    expect(resumePdfPersistenceAvailable(true, true)).toBe(true);
  });

  it("upload helper fails honestly when Storage is missing", async () => {
    const file = new File([new Uint8Array(8)], "cv.pdf", { type: "application/pdf" });
    await expect(uploadResumePdfIfSupported(file, { hasUploadBucket: false })).rejects.toThrow(
      /no Supabase Storage bucket/i,
    );
  });
});

describe("portfolio URL validation", () => {
  it("allows empty portfolio URL", () => {
    expect(validatePortfolioUrl("").ok).toBe(true);
    expect(validatePortfolioUrl("   ").ok).toBe(true);
    if (validatePortfolioUrl("").ok) {
      expect(validatePortfolioUrl("").url).toBeNull();
    }
  });

  it("accepts http(s) URLs and rejects invalid ones", () => {
    expect(validatePortfolioUrl("https://priya.dev").ok).toBe(true);
    expect(validatePortfolioUrl("not-a-url").ok).toBe(false);
    expect(validatePortfolioUrl("ftp://example.com").ok).toBe(false);
  });

  it("documents that portfolio cannot persist without a column", () => {
    expect(portfolioPersistenceAvailable(false)).toBe(false);
    expect(PORTFOLIO_PERSISTENCE_NOTE).toBe("Coming soon");
  });
});
