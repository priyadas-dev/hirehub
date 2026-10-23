import { describe, expect, it } from "vitest";
import { rankJobsBySkills } from "@/lib/ai/skill-match";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";

const base = {
  description: null as string | null,
  location: "Remote" as string | null,
  company_id: "co-1",
  created_at: "2026-10-01T00:00:00Z",
  job_type: "full_time" as string | null,
  company_name: "Acme",
};

const jobs: LiveApprovedJob[] = [
  {
    ...base,
    id: "1",
    title: "Software Developer",
    description: "Need Laravel and Vue skills for web panel maintenance.",
    status: "approved",
    job_type: "contract",
    company_name: "Manor IT",
  },
  {
    ...base,
    id: "2",
    title: "HR & Admin",
    description: "Must need English communication skill.",
    status: "approved",
    location: "Sylhet",
  },
  {
    ...base,
    id: "3",
    title: "Pending React Dev",
    description: "React TypeScript",
    status: "pending",
  },
];

describe("rankJobsBySkills", () => {
  it("ranks approved jobs by real skill overlap and explains matches", () => {
    const ranked = rankJobsBySkills(jobs, ["Laravel", "Vue", "React"], {
      limit: 8,
      requireSkillHit: true,
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.title).toBe("Software Developer");
    expect(ranked[0]?.matchedSkills).toEqual(expect.arrayContaining(["Laravel", "Vue"]));
    expect(ranked[0]?.matchReason).toMatch(/Laravel|Vue/i);
  });

  it("excludes pending jobs even when skills match", () => {
    const ranked = rankJobsBySkills(jobs, ["React", "TypeScript"], { requireSkillHit: true });
    expect(ranked.every((j) => j.status === "approved")).toBe(true);
    expect(ranked.some((j) => j.id === "3")).toBe(false);
  });

  it("returns empty when no skill evidence exists in job text", () => {
    const ranked = rankJobsBySkills(jobs, ["Kubernetes"], { requireSkillHit: true });
    expect(ranked).toHaveLength(0);
  });

  it("ranks multiple skill hits above single-hit jobs", () => {
    const pool: LiveApprovedJob[] = [
      {
        ...base,
        id: "a",
        title: "Full Stack",
        description: "Laravel and Vue and PHP.",
        status: "approved",
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        ...base,
        id: "b",
        title: "PHP Maintainer",
        description: "PHP only maintenance.",
        status: "approved",
        created_at: "2026-10-01T00:00:00Z",
      },
    ];
    const ranked = rankJobsBySkills(pool, ["Laravel", "Vue", "PHP"], { requireSkillHit: true });
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.id).toBe("a");
    expect(ranked[0]?.matchReason).toMatch(/Laravel/);
  });
});
