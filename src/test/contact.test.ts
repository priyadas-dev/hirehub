import { describe, expect, it } from "vitest";
import {
  buildContactGmailDraft,
  buildContactMailtoDraft,
  contactMessageSchema,
  SUPPORT_EMAIL,
  SUPPORT_GMAIL_COMPOSE_HREF,
  SUPPORT_MAILTO_HREF,
  SUPPORT_PHONE_TEL,
  SUPPORT_TEL_HREF,
} from "@/lib/contact";

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

  it("builds Gmail compose and mailto links to the support inbox", () => {
    expect(SUPPORT_MAILTO_HREF).toBe(`mailto:${SUPPORT_EMAIL}`);
    expect(SUPPORT_GMAIL_COMPOSE_HREF).toContain("mail.google.com/mail/");
    expect(SUPPORT_GMAIL_COMPOSE_HREF).toContain(encodeURIComponent(SUPPORT_EMAIL));
  });

  it("builds an international tel link for the dialer", () => {
    expect(SUPPORT_PHONE_TEL).toBe("+8801806085616");
    expect(SUPPORT_TEL_HREF).toBe("tel:+8801806085616");
  });

  it("builds draft links addressed to support", () => {
    const draft = {
      fullName: "Priya Das",
      email: "seeker@example.com",
      subject: "Help",
      message: "Need assistance with my application.",
    };
    expect(buildContactMailtoDraft(draft)).toContain(`mailto:${SUPPORT_EMAIL}`);
    expect(buildContactMailtoDraft(draft)).toContain(encodeURIComponent("[HireHub] Help"));
    expect(buildContactGmailDraft(draft)).toContain("mail.google.com/mail/");
    expect(buildContactGmailDraft(draft)).toContain(encodeURIComponent(SUPPORT_EMAIL));
  });
});
