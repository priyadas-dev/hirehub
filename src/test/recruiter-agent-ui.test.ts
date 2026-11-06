import { describe, expect, it } from "vitest";
import {
  htmlToEditablePlain,
  parseOutreachAgentResult,
  parseShortlistAgentResult,
} from "@/lib/ai/recruiter-agent-ui";

describe("parseShortlistAgentResult", () => {
  it("parses needs_confirm proposal", () => {
    const parsed = parseShortlistAgentResult({
      ok: true,
      status: "needs_confirm",
      applicationId: "app-1",
      plannedStatus: "shortlisted",
      message: "Confirm to mark this applicant as shortlisted.",
    });
    expect(parsed).toEqual({
      kind: "shortlist",
      applicationId: "app-1",
      plannedStatus: "shortlisted",
      message: "Confirm to mark this applicant as shortlisted.",
      needsConfirm: true,
    });
  });

  it("parses updated success", () => {
    const parsed = parseShortlistAgentResult({
      ok: true,
      status: "updated",
      applicationId: "app-1",
      plannedStatus: "shortlisted",
      message: "Application shortlisted.",
    });
    expect(parsed.kind).toBe("shortlist");
    if (parsed.kind === "shortlist") {
      expect(parsed.needsConfirm).toBe(false);
      expect(parsed.plannedStatus).toBe("shortlisted");
    }
  });

  it("parses forbidden ownership errors", () => {
    const parsed = parseShortlistAgentResult({
      ok: false,
      code: "forbidden",
      message: "You can only shortlist applicants for jobs you own.",
    });
    expect(parsed).toEqual({
      kind: "error",
      code: "forbidden",
      message: "You can only shortlist applicants for jobs you own.",
    });
  });
});

describe("parseOutreachAgentResult", () => {
  it("extracts subject and html from campaign preview", () => {
    const parsed = parseOutreachAgentResult({
      ok: true,
      message: "Outreach draft created. Review in CRM before sending.",
      campaign: {
        name: "Outreach: Backend Engineer",
        subject: "Opportunity: Backend Engineer",
        htmlBody: "<p>Hi candidate,</p>",
      },
      preview: {
        subject: "Opportunity: Backend Engineer",
        html: "<p>Hi candidate,</p>",
        ready: false,
        blockers: ["Audience segment is required"],
      },
    });
    expect(parsed.kind).toBe("outreach");
    if (parsed.kind === "outreach") {
      expect(parsed.subject).toBe("Opportunity: Backend Engineer");
      expect(parsed.htmlBody).toContain("Hi candidate");
      expect(parsed.campaignName).toBe("Outreach: Backend Engineer");
    }
  });

  it("parses forbidden draft failures", () => {
    const parsed = parseOutreachAgentResult({
      ok: false,
      code: "forbidden",
      message: "You can only draft outreach for jobs you own.",
    });
    expect(parsed).toEqual({
      kind: "error",
      code: "forbidden",
      message: "You can only draft outreach for jobs you own.",
    });
  });
});

describe("htmlToEditablePlain", () => {
  it("strips simple tags for local edit", () => {
    expect(htmlToEditablePlain("<p>Hi <strong>Alex</strong>,</p><p>Join us.</p>")).toBe(
      "Hi Alex,\n\nJoin us.",
    );
  });
});
