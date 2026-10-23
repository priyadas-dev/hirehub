import { describe, expect, it } from "vitest";
import {
  JOB_SKILL_MATCH_DELIVERY,
  JOB_SKILL_MATCH_TYPE,
  buildJobSkillMatchNotification,
  dedupeJobSkillMatchDrafts,
  isEligibleSkillMatchSeeker,
  isJobApprovedTransition,
  jobSkillMatchDedupeKey,
  matchedSkillsForApprovedJob,
  planJobSkillMatchNotifications,
  type JobSkillMatchJobFields,
  type SeekerSkillProfile,
} from "@/lib/job-skill-match-notify";

const job: JobSkillMatchJobFields = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Full Stack Engineer",
  description: "Build APIs with Node.js and React. PostgreSQL experience preferred.",
  location: "Dhaka",
  salary_range: "80k-100k",
  job_type: "full_time",
  company_name: "Acme Soft",
  status: "approved",
};

const matchingSeeker: SeekerSkillProfile = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "job_seeker",
  skills: "React, TypeScript, SQL",
};

const nonMatchingSeeker: SeekerSkillProfile = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  role: "job_seeker",
  skills: "Kubernetes, AWS, Docker",
};

const emptySkillsSeeker: SeekerSkillProfile = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  role: "job_seeker",
  skills: "   ",
};

const nullSkillsSeeker: SeekerSkillProfile = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  role: "job_seeker",
  skills: null,
};

const recruiterProfile: SeekerSkillProfile = {
  id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  role: "recruiter",
  skills: "React, Node.js",
};

describe("isJobApprovedTransition", () => {
  it("fires only when status newly becomes approved", () => {
    expect(isJobApprovedTransition("pending", "approved")).toBe(true);
    expect(isJobApprovedTransition("closed", "approved")).toBe(true);
    expect(isJobApprovedTransition("rejected", "approved")).toBe(true);
  });

  it("skips non-approval and no-op updates", () => {
    expect(isJobApprovedTransition("approved", "approved")).toBe(false);
    expect(isJobApprovedTransition("pending", "rejected")).toBe(false);
    expect(isJobApprovedTransition("approved", "closed")).toBe(false);
    expect(isJobApprovedTransition("pending", "pending")).toBe(false);
  });
});

describe("matchedSkillsForApprovedJob", () => {
  it("returns overlapping known skills from profile vs job text", () => {
    const matched = matchedSkillsForApprovedJob(matchingSeeker.skills, job);
    // Job text has React + Node.js + PostgreSQL; seeker lists React/TypeScript/SQL.
    expect(matched).toEqual(["React"]);
    expect(matched).not.toContain("TypeScript");
    expect(matched).not.toContain("SQL");
  });

  it("returns empty for non-overlapping skills", () => {
    expect(matchedSkillsForApprovedJob(nonMatchingSeeker.skills, job)).toEqual([]);
  });

  it("handles missing or blank profile skills safely", () => {
    expect(matchedSkillsForApprovedJob(null, job)).toEqual([]);
    expect(matchedSkillsForApprovedJob(undefined, job)).toEqual([]);
    expect(matchedSkillsForApprovedJob("", job)).toEqual([]);
    expect(matchedSkillsForApprovedJob("   ", job)).toEqual([]);
    expect(matchedSkillsForApprovedJob("cooking, baking", job)).toEqual([]);
  });
});

describe("eligibility and planning", () => {
  it("only treats job seekers with non-blank skills as eligible", () => {
    expect(isEligibleSkillMatchSeeker(matchingSeeker)).toBe(true);
    expect(isEligibleSkillMatchSeeker(emptySkillsSeeker)).toBe(false);
    expect(isEligibleSkillMatchSeeker(nullSkillsSeeker)).toBe(false);
    expect(isEligibleSkillMatchSeeker(recruiterProfile)).toBe(false);
  });

  it("notifies only matching seekers on approval", () => {
    const drafts = planJobSkillMatchNotifications({
      oldStatus: "pending",
      newStatus: "approved",
      job,
      seekers: [
        matchingSeeker,
        nonMatchingSeeker,
        emptySkillsSeeker,
        nullSkillsSeeker,
        recruiterProfile,
      ],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.recipient_id).toBe(matchingSeeker.id);
    expect(drafts[0]?.type).toBe(JOB_SKILL_MATCH_TYPE);
    expect(drafts[0]?.link_path).toBe(`/seeker/jobs/${job.id}`);
    expect(drafts[0]?.dedupe_key).toBe(jobSkillMatchDedupeKey(job.id, matchingSeeker.id));
    expect(drafts[0]?.body).toMatch(/React|SQL/i);
    expect(drafts[0]?.matchedSkills.length).toBeGreaterThan(0);
  });

  it("does not notify on non-approval updates", () => {
    const drafts = planJobSkillMatchNotifications({
      oldStatus: "approved",
      newStatus: "closed",
      job,
      seekers: [matchingSeeker],
    });
    expect(drafts).toEqual([]);
  });

  it("does not notify when already approved (no transition)", () => {
    const drafts = planJobSkillMatchNotifications({
      oldStatus: "approved",
      newStatus: "approved",
      job,
      seekers: [matchingSeeker],
    });
    expect(drafts).toEqual([]);
  });
});

describe("deduplication and authorization stance", () => {
  it("uses a stable per-job-per-seeker dedupe key so repeats do not duplicate", () => {
    const first = planJobSkillMatchNotifications({
      oldStatus: "pending",
      newStatus: "approved",
      job,
      seekers: [matchingSeeker],
    });
    const second = planJobSkillMatchNotifications({
      oldStatus: "closed",
      newStatus: "approved",
      job,
      seekers: [matchingSeeker],
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.dedupe_key).toBe(second[0]?.dedupe_key);

    const afterFirst = dedupeJobSkillMatchDrafts(
      first.map((d) => d.dedupe_key),
      second,
    );
    expect(afterFirst).toEqual([]);
  });

  it("buildJobSkillMatchNotification returns null without matches", () => {
    expect(
      buildJobSkillMatchNotification({
        seekerId: matchingSeeker.id,
        job,
        matchedSkills: [],
      }),
    ).toBeNull();
  });

  it("keeps delivery server-side and does not expose a client insert path", () => {
    expect(JOB_SKILL_MATCH_DELIVERY.clientMayInsert).toBe(false);
    expect(JOB_SKILL_MATCH_DELIVERY.clientMayListOtherSeekersSkills).toBe(false);
    expect(JOB_SKILL_MATCH_DELIVERY.deliveryPath).toBe("security_definer_trigger");
    expect(JOB_SKILL_MATCH_DELIVERY.notificationType).toBe("job_skill_match");
  });
});
