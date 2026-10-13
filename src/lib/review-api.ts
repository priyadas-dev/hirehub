import { supabase } from "@/integrations/supabase/client";
import { requireRejectionReason } from "@/lib/reviews";
import type { JobType } from "@/lib/hirehub";

/** True when PostgREST reports missing RPC / schema (migrations not applied). */
export function isReviewSchemaUnavailable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    error.code === "42883" ||
    error.code === "42703" ||
    msg.includes("could not find the function") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("rejection_reason") ||
    msg.includes("job_revisions")
  );
}

function unavailableMessage(feature: string): Error {
  return new Error(
    `${feature} requires proposed database migrations (0004→0005→0006) that are not applied on this project yet.`,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> {
  return (supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> }).rpc(
    name,
    args,
  );
}

export async function adminReviewCompany(input: {
  companyId: string;
  decision: "approve" | "reject";
  reason?: string;
}) {
  const reason = requireRejectionReason(input.decision, input.reason);
  const { data, error } = await rpc("admin_review_company", {
    _company_id: input.companyId,
    _decision: input.decision,
    _reason: reason,
  });
  if (error) {
    if (isReviewSchemaUnavailable(error)) throw unavailableMessage("Company review");
    throw error;
  }
  return data;
}

export async function adminReviewJob(input: {
  jobId: string;
  decision: "approve" | "reject";
  reason?: string;
}) {
  const reason = requireRejectionReason(input.decision, input.reason);
  const { data, error } = await rpc("admin_review_job", {
    _job_id: input.jobId,
    _decision: input.decision,
    _reason: reason,
  });
  if (error) {
    if (isReviewSchemaUnavailable(error)) throw unavailableMessage("Job review");
    throw error;
  }
  return data;
}

export async function submitJobRevision(input: {
  jobId: string;
  title: string;
  description: string | null;
  location: string | null;
  job_type: JobType;
  salary_range: string | null;
  application_deadline: string | null;
}) {
  const { data, error } = await rpc("submit_job_revision", {
    _job_id: input.jobId,
    _title: input.title,
    _description: input.description,
    _location: input.location,
    _job_type: input.job_type,
    _salary_range: input.salary_range,
    _application_deadline: input.application_deadline,
  });
  if (error) {
    if (isReviewSchemaUnavailable(error)) throw unavailableMessage("Job revision submit");
    throw error;
  }
  return data;
}

export async function adminReviewJobRevision(input: {
  revisionId: string;
  decision: "approve" | "reject";
  reason?: string;
}) {
  const reason = requireRejectionReason(input.decision, input.reason);
  const { data, error } = await rpc("admin_review_job_revision", {
    _revision_id: input.revisionId,
    _decision: input.decision,
    _reason: reason,
  });
  if (error) {
    if (isReviewSchemaUnavailable(error)) throw unavailableMessage("Job revision review");
    throw error;
  }
  return data;
}
