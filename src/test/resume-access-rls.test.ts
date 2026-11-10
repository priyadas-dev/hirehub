import { describe, expect, it, vi } from "vitest";
import {
  evaluateResumeStorageSelectAccess,
  issueResumeSignedUrlAfterAuthorization,
  otherRecruiterResumeAccessDenied,
} from "@/lib/resume-access";

const SEEKER_ID = "11111111-1111-4111-8111-111111111111";
const HIRING_RECRUITER = "22222222-2222-4222-8222-222222222222";
const OTHER_RECRUITER = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const OBJECT = `${SEEKER_ID}/uuid-resume.pdf`;
const OTHER_JOB_OBJECT = `${SEEKER_ID}/other-job-resume.pdf`;

const hiringLink = {
  seekerId: SEEKER_ID,
  resumeStoragePath: OBJECT,
  jobRecruiterId: HIRING_RECRUITER,
};

const otherRecruiterJobLink = {
  seekerId: SEEKER_ID,
  resumeStoragePath: OTHER_JOB_OBJECT,
  jobRecruiterId: OTHER_RECRUITER,
};

describe("resume Storage SELECT access (PROPOSED_0008 mirror)", () => {
  it("allows the seeker who owns the object folder", () => {
    const decision = evaluateResumeStorageSelectAccess({
      authUserId: SEEKER_ID,
      role: "job_seeker",
      objectName: OBJECT,
      applicationLinks: [],
    });
    expect(decision).toEqual({ allowed: true, reason: "owner" });
  });

  it("allows admin", () => {
    const decision = evaluateResumeStorageSelectAccess({
      authUserId: ADMIN_ID,
      role: "admin",
      objectName: OBJECT,
      applicationLinks: [hiringLink],
    });
    expect(decision).toEqual({ allowed: true, reason: "admin" });
  });

  it("allows the hiring recruiter who owns the job the seeker applied to", () => {
    const decision = evaluateResumeStorageSelectAccess({
      authUserId: HIRING_RECRUITER,
      role: "recruiter",
      objectName: OBJECT,
      applicationLinks: [hiringLink],
    });
    expect(decision).toEqual({ allowed: true, reason: "hiring_recruiter" });
  });

  it("denies a different recruiter (wrong job owner) — Assessment 3 hard problem 2", () => {
    const decision = evaluateResumeStorageSelectAccess({
      authUserId: OTHER_RECRUITER,
      role: "recruiter",
      objectName: OBJECT,
      applicationLinks: [hiringLink],
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("denied");

    expect(
      otherRecruiterResumeAccessDenied({
        objectName: OBJECT,
        seekerId: SEEKER_ID,
        hiringRecruiterId: HIRING_RECRUITER,
        otherRecruiterId: OTHER_RECRUITER,
      }),
    ).toBe(true);
  });

  it("denies recruiter for an application on another recruiter's job (path guess)", () => {
    // Hiring recruiter only has a link for OBJECT; they try OTHER_JOB_OBJECT owned by OTHER_RECRUITER.
    const decision = evaluateResumeStorageSelectAccess({
      authUserId: HIRING_RECRUITER,
      role: "recruiter",
      objectName: OTHER_JOB_OBJECT,
      applicationLinks: [hiringLink, otherRecruiterJobLink],
    });
    expect(decision).toEqual({ allowed: false, reason: "denied" });
  });

  it("denies hiring recruiter when path is not bound to an application row", () => {
    const decision = evaluateResumeStorageSelectAccess({
      authUserId: HIRING_RECRUITER,
      role: "recruiter",
      objectName: OBJECT,
      applicationLinks: [],
    });
    expect(decision).toEqual({ allowed: false, reason: "denied" });
  });

  it("denies unauthenticated callers", () => {
    const decision = evaluateResumeStorageSelectAccess({
      authUserId: null,
      role: null,
      objectName: OBJECT,
      applicationLinks: [hiringLink],
    });
    expect(decision).toEqual({ allowed: false, reason: "unauthenticated" });
  });

  it("denies unsafe / guessed invalid object paths", () => {
    expect(
      evaluateResumeStorageSelectAccess({
        authUserId: SEEKER_ID,
        role: "job_seeker",
        objectName: "../escape.pdf",
        applicationLinks: [],
      }),
    ).toEqual({ allowed: false, reason: "unsafe_path" });

    expect(
      evaluateResumeStorageSelectAccess({
        authUserId: SEEKER_ID,
        role: "job_seeker",
        objectName: `${OTHER_RECRUITER}/stolen.pdf`,
        applicationLinks: [],
      }),
    ).toEqual({ allowed: false, reason: "denied" });
  });
});

describe("authorize-before-sign (signed URL not issued when denied)", () => {
  it("issues a signed URL only after seeker authorization succeeds", async () => {
    const createSignedUrl = vi.fn(async () => "https://signed.example/seeker.pdf");
    const result = await issueResumeSignedUrlAfterAuthorization({
      authUserId: SEEKER_ID,
      role: "job_seeker",
      objectName: OBJECT,
      applicationLinks: [],
      expiresInSeconds: 120,
      createSignedUrl,
    });
    expect(result).toEqual({
      ok: true,
      signedUrl: "https://signed.example/seeker.pdf",
      reason: "owner",
    });
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith(OBJECT, 120);
  });

  it("issues a signed URL for the job-owning recruiter after authorization", async () => {
    const createSignedUrl = vi.fn(async () => "https://signed.example/hiring.pdf");
    const result = await issueResumeSignedUrlAfterAuthorization({
      authUserId: HIRING_RECRUITER,
      role: "recruiter",
      objectName: OBJECT,
      applicationLinks: [hiringLink],
      expiresInSeconds: 120,
      createSignedUrl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reason).toBe("hiring_recruiter");
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("does not call createSignedUrl when an unrelated recruiter is denied", async () => {
    const createSignedUrl = vi.fn(async () => "https://signed.example/leak.pdf");
    const result = await issueResumeSignedUrlAfterAuthorization({
      authUserId: OTHER_RECRUITER,
      role: "recruiter",
      objectName: OBJECT,
      applicationLinks: [hiringLink],
      expiresInSeconds: 120,
      createSignedUrl,
    });
    expect(result).toEqual({
      ok: false,
      reason: "denied",
      signedUrlAttempted: false,
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("does not call createSignedUrl when unauthenticated", async () => {
    const createSignedUrl = vi.fn(async () => "https://signed.example/anon.pdf");
    const result = await issueResumeSignedUrlAfterAuthorization({
      authUserId: "",
      role: "job_seeker",
      objectName: OBJECT,
      applicationLinks: [],
      expiresInSeconds: 120,
      createSignedUrl,
    });
    expect(result).toEqual({
      ok: false,
      reason: "unauthenticated",
      signedUrlAttempted: false,
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("does not call createSignedUrl for unauthorized / unsafe paths", async () => {
    const createSignedUrl = vi.fn(async () => "https://signed.example/bad.pdf");
    const badPath = await issueResumeSignedUrlAfterAuthorization({
      authUserId: SEEKER_ID,
      role: "job_seeker",
      objectName: "not-a-safe-path",
      applicationLinks: [],
      expiresInSeconds: 120,
      createSignedUrl,
    });
    expect(badPath.ok).toBe(false);
    if (!badPath.ok) {
      expect(badPath.reason).toBe("unsafe_path");
      expect(badPath.signedUrlAttempted).toBe(false);
    }
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
