import type { LiveApprovedJob } from "@/lib/ai/live-recommend";
import { extractSkillsFromText } from "@/lib/ai/skill-extract";

export type SkillMatchedJob = LiveApprovedJob & {
  matchedSkills: string[];
  matchReason: string;
  matchScore: number;
};

function jobHaystack(job: LiveApprovedJob): string {
  return `${job.title}\n${job.description ?? ""}\n${job.company_name ?? ""}\n${job.location ?? ""}`;
}

/**
 * Rank approved jobs by overlap between seeker skills and skills that
 * literally appear in the job title/description. Does not invent matches.
 */
export function rankJobsBySkills(
  jobs: LiveApprovedJob[],
  seekerSkills: string[],
  options?: { limit?: number; requireSkillHit?: boolean },
): SkillMatchedJob[] {
  const limit = options?.limit ?? 8;
  const requireSkillHit = options?.requireSkillHit ?? true;
  const seeker = seekerSkills.map((s) => s.trim()).filter(Boolean);
  if (!seeker.length) return [];

  const seekerLower = new Set(seeker.map((s) => s.toLowerCase()));

  const ranked: SkillMatchedJob[] = [];
  for (const job of jobs) {
    if (job.status !== "approved") continue;
    const jobSkills = extractSkillsFromText(jobHaystack(job));
    const matchedSkills = jobSkills.filter((s) => seekerLower.has(s.toLowerCase()));
    if (requireSkillHit && matchedSkills.length === 0) continue;

    // Title hits count more than description-only hits.
    const titleLower = job.title.toLowerCase();
    let score = matchedSkills.length * 3;
    for (const skill of matchedSkills) {
      if (titleLower.includes(skill.toLowerCase())) score += 4;
    }

    const top = matchedSkills.slice(0, 3);
    const skillPhrase =
      top.length === 1
        ? top[0]
        : top.length === 2
          ? `${top[0]} and ${top[1]}`
          : `${top[0]}, ${top[1]}, and ${top[2]}`;
    const matchReason =
      matchedSkills.length > 0
        ? `Matches your ${skillPhrase}${matchedSkills.length > 3 ? " (+more)" : ""} skills`
        : "Related to your listed skills";

    ranked.push({
      ...job,
      matchedSkills,
      matchReason,
      matchScore: score,
    });
  }

  ranked.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return b.created_at.localeCompare(a.created_at);
  });

  // Deduplicate by id
  const seen = new Set<string>();
  const unique: SkillMatchedJob[] = [];
  for (const job of ranked) {
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    unique.push(job);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function skillsBasedAnswer(count: number, skills: string[]): string {
  const skillLabel = skills.slice(0, 4).join(", ");
  if (count === 0) {
    return "I couldn't find any approved jobs matching those filters right now. You can try a broader location, another job type, or different skills. Would you like me to check nearby locations or remote opportunities?";
  }
  if (count === 1) {
    return `I found 1 approved HireHub job that matches your skills${skillLabel ? ` (${skillLabel})` : ""}. See the card below.`;
  }
  return `I found ${count} approved HireHub jobs that match your skills${skillLabel ? ` (${skillLabel})` : ""}. See the cards below.`;
}

export function resumeReadSuccessAnswer(skills: string[], jobCount: number): string {
  if (!skills.length) {
    return "I read your PDF, but could not detect known technical skills in the text. List skills like React, SQL, or Python in chat so I can match approved jobs.";
  }
  return skillsBasedAnswer(jobCount, skills);
}
