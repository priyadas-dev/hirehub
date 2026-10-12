import { describe, expect, it } from "vitest";
import { contactMessageSchema, SUPPORT_EMAIL } from "@/lib/contact";

describe("contactMessageSchema", () => {
  const valid = {
    fullName: "Priya Das",
    email: "seeker@example.com",
    subject: "Help with applications",
    message: "I need help tracking my application status.",
    companyWebsite: "",
  };

  it("accepts a valid payload", () => {
    expect(contactMessageSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid email", () => {
    const r = contactMessageSchema.safeParse({ ...valid, email: "not-an-email" });
    expect(r.success).toBe(false);
  });

  it("rejects short messages and empty name", () => {
    expect(contactMessageSchema.safeParse({ ...valid, message: "hi" }).success).toBe(false);
    expect(contactMessageSchema.safeParse({ ...valid, fullName: "A" }).success).toBe(false);
  });

  it("trims whitespace", () => {
    const r = contactMessageSchema.safeParse({
      ...valid,
      fullName: "  Priya Das  ",
      subject: "  Hello  ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.fullName).toBe("Priya Das");
      expect(r.data.subject).toBe("Hello");
    }
  });

  it("exposes the verified public support email", () => {
    expect(SUPPORT_EMAIL).toBe("priya.das@sjinnovation.com");
  });
});
