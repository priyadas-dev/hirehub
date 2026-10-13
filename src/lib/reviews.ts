import { z } from "zod";

export const reviewDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    reason: z.string().optional(),
  }),
  z.object({
    decision: z.literal("reject"),
    reason: z.string().trim().min(3, "Rejection reason is required (at least 3 characters)"),
  }),
]);

export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

/** Normalize / validate admin review input. Reject always requires a reason. */
export function parseReviewDecision(input: unknown): ReviewDecision {
  return reviewDecisionSchema.parse(input);
}

export function requireRejectionReason(decision: "approve" | "reject", reason: string | null | undefined): string | null {
  if (decision === "approve") return null;
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 3) {
    throw new Error("Rejection reason is required (at least 3 characters)");
  }
  return trimmed;
}

/** Stale concurrent review: row is no longer pending. */
export function isStaleReviewStatus(status: string | null | undefined): boolean {
  return status !== "pending";
}

export function assertPendingForReview(status: string | null | undefined, entityLabel: string) {
  if (isStaleReviewStatus(status)) {
    throw new Error(`${entityLabel} is no longer pending review (status: ${status ?? "unknown"}). Refresh and try again.`);
  }
}
