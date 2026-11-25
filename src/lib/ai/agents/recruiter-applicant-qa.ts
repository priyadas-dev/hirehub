/**
 * Authorization-gated recruiter applicant Q&A.
 * Loads only owned applications; optional ephemeral resume text (never persisted).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authorizeRecruiterApplicationAccess,
  forbiddenApplicantReply,
  looksLikeCrossRecruiterAccessProbe,
  looksLikeResumeAccessQuestion,
  type OwnedApplicationFacts,
} from "@/lib/ai/agents/recruiter-applicant-access";
import { fetchGeminiGeneratedText } from "@/lib/ai/gemini-generate";
import { extractResumePdfText } from "@/lib/ai/resume-pdf";
import { evaluateResumeStorageSelectAccess } from "@/lib/resume-access";
import { RESUMES_BUCKET, storageFirstFolder } from "@/lib/hirehub-storage";

const RESUME_CONTEXT_MAX_CHARS = 6000;

export type RecruiterApplicantQaDeps = {
  supabase: SupabaseClient;
  callerId: string;
  callerRole: string | null | undefined;
  /** Injected for tests — defaults to Gemini. */
  generateText?: (prompt: string) => Promise<{ ok: true; text: string } | { ok: false; message: string }>;
  /** Injected for tests — download resume bytes after authz. */
  downloadResumeBytes?: (path: string) => Promise<Uint8Array | null>;
};

export type RecruiterApplicantQaInput = {
  question: string;
  applicationId?: string | null;
  jobId?: string | null;
};

export type RecruiterApplicantQaResult =
  | { ok: true; message: string; model: string; applicantsUsed: number }
  | { ok: false; code: "forbidden" | "validation" | "unavailable"; message: string };

type AppRow = {
  id: string;
  job_id: string;
  seeker_id: string;
  status: string;
  cover_note: string | null;
  resume_storage_path: string | null;
  resume_file_name: string | null;
  profiles: { full_name?: string | null; email?: string | null; skills?: string[] | null } | null;
  jobs: { id: string; recruiter_id: string; title?: string | null } | null;
};

function mapApplicationRow(row: AppRow): OwnedApplicationFacts {
  const jobs = row.jobs;
  const profile = row.profiles;
  return {
    applicationId: row.id,
    jobId: row.job_id,
    seekerId: row.seeker_id,
    jobRecruiterId: jobs?.recruiter_id ?? "",
    status: row.status,
    seekerName: profile?.full_name?.trim() || null,
    seekerEmail: profile?.email?.trim() || null,
    coverNote: row.cover_note,
    resumeStoragePath: row.resume_storage_path,
    resumeFileName: row.resume_file_name,
    skills: Array.isArray(profile?.skills) ? profile!.skills : null,
  };
}

async function loadOwnedApplications(
  deps: RecruiterApplicantQaDeps,
  input: RecruiterApplicantQaInput,
): Promise<OwnedApplicationFacts[]> {
  let query = deps.supabase
    .from("applications")
    .select(
      "id,job_id,seeker_id,status,cover_note,resume_storage_path,resume_file_name,profiles(full_name,email,skills),jobs!inner(id,recruiter_id,title)",
    )
    .order("created_at", { ascending: false })
    .limit(40);

  // Non-admin recruiters only see applications on jobs they own (JWT callerId).
  if (deps.callerRole !== "admin") {
    query = query.eq("jobs.recruiter_id", deps.callerId);
  }

  if (input.applicationId?.trim()) {
    query = query.eq("id", input.applicationId.trim());
  } else if (input.jobId?.trim()) {
    query = query.eq("job_id", input.jobId.trim());
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as unknown as AppRow[])
    .map(mapApplicationRow)
    .filter((a) => Boolean(a.jobRecruiterId));
}

async function loadApplicationByIdAnyOwner(
  deps: RecruiterApplicantQaDeps,
  applicationId: string,
): Promise<OwnedApplicationFacts | null> {
  const { data } = await deps.supabase
    .from("applications")
    .select(
      "id,job_id,seeker_id,status,cover_note,resume_storage_path,resume_file_name,profiles(full_name,email,skills),jobs!inner(id,recruiter_id,title)",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (!data) return null;
  return mapApplicationRow(data as unknown as AppRow);
}

async function ephemeralResumeExcerpt(
  deps: RecruiterApplicantQaDeps,
  app: OwnedApplicationFacts,
): Promise<string | null> {
  const path = app.resumeStoragePath?.trim();
  if (!path) return null;

  const decision = evaluateResumeStorageSelectAccess({
    authUserId: deps.callerId,
    role: deps.callerRole,
    objectName: path,
    applicationLinks: [
      {
        seekerId: app.seekerId,
        resumeStoragePath: path,
        jobRecruiterId: app.jobRecruiterId,
      },
    ],
  });
  if (!decision.allowed) return null;

  const folder = storageFirstFolder(path);
  if (folder !== app.seekerId && deps.callerRole !== "admin") return null;

  let bytes: Uint8Array | null = null;
  if (deps.downloadResumeBytes) {
    bytes = await deps.downloadResumeBytes(path);
  } else {
    const { data, error } = await deps.supabase.storage.from(RESUMES_BUCKET).download(path);
    if (error || !data) return null;
    bytes = new Uint8Array(await data.arrayBuffer());
  }
  if (!bytes?.byteLength) return null;

  const extracted = await extractResumePdfText(bytes);
  if (!extracted.ok) return null;
  return extracted.text.slice(0, RESUME_CONTEXT_MAX_CHARS);
}

function buildApplicantContextBlock(
  apps: OwnedApplicationFacts[],
  resumeExcerpts: Map<string, string | null>,
): string {
  return apps
    .map((a, i) => {
      const skills =
        a.skills?.length ? a.skills.join(", ") : "unavailable in profile";
      const resumeText = resumeExcerpts.get(a.applicationId);
      const resumeSection =
        resumeText && resumeText.trim()
          ? `Resume excerpt:\n${resumeText}`
          : a.resumeStoragePath
            ? "Resume: on file (text unavailable or unreadable)."
            : "Resume: unavailable.";
      return [
        `Applicant ${i + 1}:`,
        `Name: ${a.seekerName || "unavailable"}`,
        `Status: ${a.status || "unknown"}`,
        `Job id: ${a.jobId}`,
        `Application id: ${a.applicationId}`,
        `Skills (profile): ${skills}`,
        `Cover note: ${(a.coverNote || "unavailable").slice(0, 800)}`,
        resumeSection,
      ].join("\n");
    })
    .join("\n\n");
}

function heuristicAnswer(
  question: string,
  apps: OwnedApplicationFacts[],
  resumeExcerpts: Map<string, string | null>,
): string {
  const q = question.toLowerCase();
  if (!apps.length) {
    return "I don't have any applicants for jobs you own that match this request. Post or select an owned job with applications, then ask again.";
  }

  if (/\bcompare\b/i.test(question)) {
    const lines = apps.slice(0, 5).map((a) => {
      const skills = a.skills?.length ? a.skills.join(", ") : "skills unavailable";
      return `- ${a.seekerName || "Applicant"} (${a.status}): ${skills}`;
    });
    return `Comparison of applicants you are authorized to access:\n${lines.join("\n")}`;
  }

  if (/\bskill/i.test(q) || /\breact|node|python|typescript|machine\s+learning/i.test(q)) {
    const needle = q.match(
      /\b(react|node\.?js|python|typescript|machine\s+learning|aws|sql|java|\.net)\b/i,
    )?.[0];
    const hits = apps.filter((a) => {
      const hay = [
        ...(a.skills ?? []),
        a.coverNote ?? "",
        resumeExcerpts.get(a.applicationId) ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return needle ? hay.includes(needle.toLowerCase().replace("node.js", "node")) : Boolean(a.skills?.length);
    });
    if (!hits.length) {
      return needle
        ? `None of your authorized applicants clearly show “${needle}” in profile, cover note, or readable resume text. That skill may be unavailable in the stored data.`
        : "Skills details are limited for your authorized applicants. Profile skills or readable resume text were not available.";
    }
    return hits
      .slice(0, 8)
      .map((a) => {
        const skills = a.skills?.length ? a.skills.join(", ") : "see cover note / resume excerpt";
        return `- ${a.seekerName || "Applicant"}: ${skills}`;
      })
      .join("\n");
  }

  if (/\bexperience|years?\b/i.test(q)) {
    const lines = apps.slice(0, 8).map((a) => {
      const excerpt = resumeExcerpts.get(a.applicationId);
      const note = a.coverNote?.trim();
      if (excerpt || note) {
        return `- ${a.seekerName || "Applicant"}: ${(excerpt || note || "").slice(0, 280)}`;
      }
      return `- ${a.seekerName || "Applicant"}: experience details unavailable in stored data.`;
    });
    return `Experience signals from applicants you own:\n${lines.join("\n")}`;
  }

  if (/\bsummarize|summary\b/i.test(q) && apps[0]) {
    const a = apps[0]!;
    const excerpt = resumeExcerpts.get(a.applicationId);
    return [
      `Summary for ${a.seekerName || "this applicant"} (authorized):`,
      `Status: ${a.status}`,
      `Skills: ${a.skills?.length ? a.skills.join(", ") : "unavailable"}`,
      `Cover note: ${a.coverNote?.trim() || "unavailable"}`,
      excerpt ? `Resume: ${excerpt.slice(0, 500)}` : "Resume text: unavailable",
    ].join("\n");
  }

  const list = apps
    .slice(0, 8)
    .map(
      (a, i) =>
        `${i + 1}. ${a.seekerName || "Applicant"} — ${a.status}${
          a.resumeStoragePath ? " — resume on file" : ""
        }`,
    )
    .join("\n");
  return `Here are applicants for jobs you own that I can use for this question:\n${list}`;
}

/**
 * Answer a recruiter question using only JWT-owned applicants.
 * Unauthorized application ids return Access Denied without leaking PII.
 */
export async function answerRecruiterApplicantQuestion(
  deps: RecruiterApplicantQaDeps,
  input: RecruiterApplicantQaInput,
): Promise<RecruiterApplicantQaResult> {
  const question = input.question.trim();
  if (question.length < 3) {
    return { ok: false, code: "validation", message: "Ask a longer question about your applicants." };
  }

  if (looksLikeCrossRecruiterAccessProbe(question)) {
    return forbiddenApplicantReply(looksLikeResumeAccessQuestion(question));
  }

  // Explicit application id: verify ownership before any PII.
  if (input.applicationId?.trim()) {
    const row = await loadApplicationByIdAnyOwner(deps, input.applicationId.trim());
    const decision = authorizeRecruiterApplicationAccess({
      callerId: deps.callerId,
      callerRole: deps.callerRole,
      application: row,
      resumeContext: looksLikeResumeAccessQuestion(question),
    });
    if (!decision.allowed) {
      return {
        ok: false,
        code: "forbidden",
        message: decision.message,
      };
    }
  }

  let apps = await loadOwnedApplications(deps, input);

  // Name-ish filter from question against owned pool only (no cross-tenant search).
  const nameMatch = question.match(
    /\b(?:applicant|candidate|resume(?:\s+for)?|about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
  );
  if (nameMatch?.[1] && apps.length > 1) {
    const needle = nameMatch[1].toLowerCase();
    const filtered = apps.filter((a) => (a.seekerName || "").toLowerCase().includes(needle));
    if (filtered.length) apps = filtered;
  }

  if (!apps.length) {
    // If they asked about a specific application that RLS hid, still deny without leaking.
    if (input.applicationId?.trim()) {
      return forbiddenApplicantReply(looksLikeResumeAccessQuestion(question));
    }
    return {
      ok: true,
      message:
        "I don't have applicant data for jobs you own yet. Once candidates apply to your jobs, I can summarize skills, experience, and resumes you are authorized to access.",
      model: "recruiter-applicant-qa",
      applicantsUsed: 0,
    };
  }

  // Re-authorize every row (defense in depth).
  const authorized: OwnedApplicationFacts[] = [];
  for (const app of apps) {
    const decision = authorizeRecruiterApplicationAccess({
      callerId: deps.callerId,
      callerRole: deps.callerRole,
      application: app,
      resumeContext: looksLikeResumeAccessQuestion(question),
    });
    if (decision.allowed) authorized.push(decision.application);
  }

  if (!authorized.length) {
    return forbiddenApplicantReply(looksLikeResumeAccessQuestion(question));
  }

  const resumeExcerpts = new Map<string, string | null>();
  const needResume =
    looksLikeResumeAccessQuestion(question) ||
    /\b(skill|experience|summarize|compare|years?|machine\s+learning|react|node)/i.test(question);

  if (needResume) {
    for (const app of authorized.slice(0, 5)) {
      try {
        const excerpt = await ephemeralResumeExcerpt(deps, app);
        resumeExcerpts.set(app.applicationId, excerpt);
      } catch {
        resumeExcerpts.set(app.applicationId, null);
      }
    }
  }

  const contextBlock = buildApplicantContextBlock(authorized.slice(0, 8), resumeExcerpts);
  const prompt = [
    "You are the HireHub Recruiter Agent. Answer ONLY from the authorized applicant context below.",
    "If a detail is missing, say it is unavailable. Never invent skills or employers.",
    "Never mention applicants outside this context. Never reveal emails unless already in context and asked.",
    "",
    `Recruiter question: ${question}`,
    "",
    "Authorized applicant context:",
    contextBlock,
  ].join("\n");

  const generate =
    deps.generateText ??
    (async (p: string) => {
      const result = await fetchGeminiGeneratedText(p, { maxOutputTokens: 700 });
      if (!result.ok) return { ok: false as const, message: result.message };
      return { ok: true as const, text: result.text };
    });

  try {
    const generated = await generate(prompt);
    if (generated.ok && generated.text.trim()) {
      return {
        ok: true,
        message: generated.text.trim(),
        model: "recruiter-applicant-qa+gemini",
        applicantsUsed: authorized.length,
      };
    }
  } catch {
    // Fall through to heuristic
  }

  return {
    ok: true,
    message: heuristicAnswer(question, authorized, resumeExcerpts),
    model: "recruiter-applicant-qa",
    applicantsUsed: authorized.length,
  };
}
