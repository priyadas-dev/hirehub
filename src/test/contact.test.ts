import { describe, expect, it } from "vitest";
import {
  buildContactGmailDraft,
  buildContactMailtoDraft,
  buildResendContactPayload,
  contactMessageSchema,
  sanitizeContactLine,
  sanitizeContactMessage,
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

  it("trims and sanitizes whitespace / control characters", () => {
    const r = contactMessageSchema.safeParse({
      ...valid,
      fullName: "  Priya\u0000 Das  ",
      subject: "  Hello\tthere  ",
      email: "  Seeker@Example.COM ",
      message: "Line one.\n\n\nLine two with enough length.",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.fullName).toBe("Priya Das");
      expect(r.data.subject).toBe("Hello there");
      expect(r.data.email).toBe("seeker@example.com");
      expect(r.data.message).toBe("Line one.\n\nLine two with enough length.");
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
    expect(SUPPORT_PHONE_TEL).toBe("+12025550100");
    expect(SUPPORT_TEL_HREF).toBe("tel:+12025550100");
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

describe("sanitize helpers", () => {
  it("collapses single-line whitespace", () => {
    expect(sanitizeContactLine("  A\tB  ")).toBe("A B");
  });

  it("keeps message newlines but collapses runs", () => {
    expect(sanitizeContactMessage("Hello.\n\n\nWorld.")).toBe("Hello.\n\nWorld.");
  });
});

describe("buildResendContactPayload", () => {
  it("uses configured From, CONTACT_TO as To, and visitor as reply_to only", () => {
    const payload = buildResendContactPayload({
      from: "HireHub <onboarding@resend.dev>",
      to: "priya.das@sjinnovation.com",
      visitorName: "Visitor Name",
      visitorEmail: "visitor@example.com",
      subject: "Need help",
      message: "Please help with my account.",
    });
    expect(payload.from).toBe("HireHub <onboarding@resend.dev>");
    expect(payload.to).toEqual(["priya.das@sjinnovation.com"]);
    expect(payload.reply_to).toBe("visitor@example.com");
    expect(payload.subject).toBe("[HireHub] Need help");
    expect(payload.text).toContain("visitor@example.com");
    expect(payload.from.toLowerCase()).not.toContain("visitor@example.com");
  });

  it("rejects using the visitor email as From", () => {
    expect(() =>
      buildResendContactPayload({
        from: "visitor@example.com",
        to: "priya.das@sjinnovation.com",
        visitorName: "Visitor",
        visitorEmail: "visitor@example.com",
        subject: "Help",
        message: "Please help with my account.",
      }),
    ).toThrow(/must not be used as From/i);
  });
});
