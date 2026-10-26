import { describe, expect, it } from "vitest";
import { classifyResendFailure, userMessageForResendFailure } from "@/lib/resend-errors";

describe("classifyResendFailure", () => {
  it("detects free-plan recipient restriction", () => {
    const kind = classifyResendFailure(403, {
      message:
        "You can only send testing emails to your own email address (hirehub@gmail.com). To send emails to other recipients, please verify a domain.",
    });
    expect(kind).toBe("testing_recipient_restricted");
    expect(userMessageForResendFailure(kind)).toMatch(/Gmail draft|limited/i);
    expect(userMessageForResendFailure(kind)).not.toMatch(/RESEND|CONTACT_TO|API key/i);
  });

  it("treats other auth failures as unauthorized", () => {
    expect(classifyResendFailure(401, { message: "Invalid API key" })).toBe("unauthorized");
    expect(userMessageForResendFailure("unauthorized")).not.toMatch(/RESEND_API_KEY/);
  });

  it("defaults other statuses to other", () => {
    expect(classifyResendFailure(500, { message: "Internal" })).toBe("other");
  });
});
