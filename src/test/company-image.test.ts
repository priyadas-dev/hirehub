import { describe, expect, it } from "vitest";
import {
  COMPANY_IMAGE_MAX_BYTES,
  companyImagePersistenceAvailable,
  validateCompanyImageFile,
  validateCompanyImageUrl,
} from "@/lib/company-image";

describe("company image validation", () => {
  it("accepts http(s) image URLs", () => {
    expect(validateCompanyImageUrl("https://cdn.example/logo.png").ok).toBe(true);
    expect(validateCompanyImageUrl("http://cdn.example/logo.png").ok).toBe(true);
  });

  it("rejects invalid or non-http URLs", () => {
    expect(validateCompanyImageUrl("").ok).toBe(false);
    expect(validateCompanyImageUrl("not-a-url").ok).toBe(false);
    expect(validateCompanyImageUrl("ftp://cdn.example/logo.png").ok).toBe(false);
  });

  it("validates file type and size", () => {
    const ok = new File([new Uint8Array(32)], "logo.png", { type: "image/png" });
    expect(validateCompanyImageFile(ok).ok).toBe(true);

    const tooBig = new File([new Uint8Array(COMPANY_IMAGE_MAX_BYTES + 1)], "big.png", {
      type: "image/png",
    });
    expect(validateCompanyImageFile(tooBig).ok).toBe(false);

    const notImage = new File([new Uint8Array(8)], "notes.txt", { type: "text/plain" });
    expect(validateCompanyImageFile(notImage).ok).toBe(false);
  });

  it("does not claim persistence without schema + storage", () => {
    expect(companyImagePersistenceAvailable(false, false)).toBe(false);
    expect(companyImagePersistenceAvailable(true, false)).toBe(false);
    expect(companyImagePersistenceAvailable(true, true)).toBe(true);
  });
});
