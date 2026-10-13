import { describe, expect, it } from "vitest";
import {
  assertPendingForReview,
  isStaleReviewStatus,
  parseReviewDecision,
  requireRejectionReason,
} from "@/lib/reviews";

describe("review decisions", () => {
  it("requires a rejection reason", () => {
    expect(() => requireRejectionReason("reject", "  ")).toThrow(/required/i);
    expect(requireRejectionReason("reject", "Incomplete website")).toBe("Incomplete website");
    expect(requireRejectionReason("approve", undefined)).toBeNull();
  });

  it("parses approve without reason and reject with reason", () => {
    expect(parseReviewDecision({ decision: "approve" }).decision).toBe("approve");
    expect(parseReviewDecision({ decision: "reject", reason: "Missing industry" }).reason).toBe(
      "Missing industry",
    );
    expect(() => parseReviewDecision({ decision: "reject", reason: "no" })).toThrow();
  });

  it("detects stale concurrent reviews", () => {
    expect(isStaleReviewStatus("pending")).toBe(false);
    expect(isStaleReviewStatus("approved")).toBe(true);
    expect(() => assertPendingForReview("rejected", "Revision")).toThrow(/no longer pending/i);
  });
});
