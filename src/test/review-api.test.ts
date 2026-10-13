import { describe, expect, it } from "vitest";
import { isReviewSchemaUnavailable } from "@/lib/review-api";
import { isNotificationsUnavailableError } from "@/lib/notifications";

describe("schema availability guards", () => {
  it("detects missing review RPC / tables", () => {
    expect(isReviewSchemaUnavailable({ code: "PGRST202", message: "Could not find the function" })).toBe(
      true,
    );
    expect(isReviewSchemaUnavailable({ message: 'relation "job_revisions" does not exist' })).toBe(true);
    expect(isReviewSchemaUnavailable({ message: "permission denied" })).toBe(false);
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
