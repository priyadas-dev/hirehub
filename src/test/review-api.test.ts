import { describe, expect, it } from "vitest";
import { isReviewSchemaUnavailable, REVIEW_MIGRATION_ORDER } from "@/lib/review-api";
import { isNotificationsUnavailableError } from "@/lib/notifications";

describe("schema availability guards", () => {
  it("detects missing review RPC / tables", () => {
    expect(isReviewSchemaUnavailable({ code: "PGRST202", message: "Could not find the function" })).toBe(
      true,
    );
    expect(isReviewSchemaUnavailable({ message: 'relation "job_revisions" does not exist' })).toBe(true);
    expect(isReviewSchemaUnavailable({ message: "permission denied" })).toBe(false);
  });

  it("documents the split migration order (0006a before 0006b)", () => {
    expect(REVIEW_MIGRATION_ORDER).toEqual([
      "PROPOSED_0004_companies_owner_cannot_self_approve.sql",
      "PROPOSED_0005_notifications.sql",
      "PROPOSED_0006a_add_rejected_enum_values.sql",
      "PROPOSED_0006b_reviews_and_revisions.sql",
    ]);
    expect(REVIEW_MIGRATION_ORDER.some((f) => f === "PROPOSED_0006_reviews_and_revisions.sql")).toBe(false);
  });

  it("keeps notification ownership errors distinct from missing-table", () => {
    expect(isNotificationsUnavailableError({ code: "PGRST205", message: "Could not find the table" })).toBe(
      true,
    );
    expect(isNotificationsUnavailableError({ message: "permission denied for table notifications" })).toBe(
      false,
    );
  });
});
