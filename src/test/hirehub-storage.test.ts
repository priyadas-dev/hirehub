import { describe, expect, it } from "vitest";
import {
  assertStorageOwnerId,
  buildCompanyLogoObjectPath,
  buildResumeObjectPath,
  isExternalHttpUrl,
  isMissingSchemaError,
  isStorageObjectPath,
  sanitizeUploadFileName,
  storageFirstFolder,
  storagePathIsSafe,
} from "@/lib/hirehub-storage";

/** Sample UUIDs shaped like live auth/company ids. */
const SEEKER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";

describe("hirehub storage helpers", () => {
  it("detects http(s) URLs vs storage paths", () => {
    expect(isExternalHttpUrl("https://cdn.example/a.png")).toBe(true);
    expect(isExternalHttpUrl("folder/file.pdf")).toBe(false);
    expect(isStorageObjectPath("seeker-id/resume.pdf")).toBe(true);
    expect(isStorageObjectPath("https://cdn.example/a.png")).toBe(false);
    expect(isStorageObjectPath("nested/too/deep.pdf")).toBe(false);
  });

  it("mirrors PROPOSED_0008 storage_path_is_safe rules", () => {
    expect(storagePathIsSafe(`${SEEKER_ID}/abc-resume.pdf`)).toBe(true);
    expect(storagePathIsSafe("a/b")).toBe(true);
    expect(storagePathIsSafe("ab")).toBe(false); // length < 3
    expect(storagePathIsSafe("a/b/c")).toBe(false); // nested
    expect(storagePathIsSafe("a\\b")).toBe(false);
    expect(storagePathIsSafe("a/b c.pdf")).toBe(false); // whitespace
    expect(storagePathIsSafe("a/report..pdf")).toBe(false); // '..' substring
    expect(storagePathIsSafe("../x/y")).toBe(false);
    expect(storageFirstFolder(`${SEEKER_ID}/file.pdf`)).toBe(SEEKER_ID);
  });

  it("builds owner-scoped paths that pass storage_path_is_safe + owner folder", () => {
    const resume = buildResumeObjectPath(SEEKER_ID, "My Resume.pdf");
    expect(storagePathIsSafe(resume)).toBe(true);
    expect(storageFirstFolder(resume)).toBe(SEEKER_ID);
    expect(resume).toMatch(
      new RegExp(`^${SEEKER_ID}/[0-9a-f-]+-My_Resume\\.pdf$`, "i"),
    );
    expect(resume.includes("..")).toBe(false);

    const logo = buildCompanyLogoObjectPath(COMPANY_ID, "logo!.png");
    expect(storagePathIsSafe(logo)).toBe(true);
    expect(storageFirstFolder(logo)).toBe(COMPANY_ID);
    expect(logo).toMatch(/\.png$/);
    expect(logo.includes("..")).toBe(false);
  });

  it("sanitizes names so '..' and spaces never reach Storage object names", () => {
    expect(sanitizeUploadFileName("../../etc/passwd", "x.pdf")).toBe("passwd");
    expect(sanitizeUploadFileName("ok-name.pdf", "x.pdf")).toBe("ok-name.pdf");
    expect(sanitizeUploadFileName("report..final.pdf", "x.pdf")).toBe("report.final.pdf");
    expect(sanitizeUploadFileName("My Resume.pdf", "x.pdf")).toBe("My_Resume.pdf");
    expect(sanitizeUploadFileName("..pdf", "resume.pdf")).toBe("pdf");

    const tricky = buildResumeObjectPath(SEEKER_ID, "draft..v2.pdf");
    expect(storagePathIsSafe(tricky)).toBe(true);
    expect(tricky.includes("..")).toBe(false);
  });

  it("rejects invalid owner folder ids", () => {
    expect(() => assertStorageOwnerId("")).toThrow(/invalid storage owner/i);
    expect(() => assertStorageOwnerId("a/b")).toThrow(/invalid storage owner/i);
    expect(() => buildResumeObjectPath("bad/id", "a.pdf")).toThrow(/invalid storage owner/i);
  });

  it("recognizes missing-schema PostgREST errors", () => {
    expect(isMissingSchemaError("column profiles.resume_storage_path does not exist")).toBe(true);
    expect(isMissingSchemaError("Could not find the 'logo_url' column")).toBe(true);
    expect(isMissingSchemaError("permission denied")).toBe(false);
  });
});
