/**
 * Helpers for the Recruiter Agent UI — normalize askRecruiterAgent responses for display.
 * No network calls; safe for unit tests.
 */

export type RecruiterAgentUiShortlistSuccess = {
  kind: "shortlist";
  applicationId: string;
  plannedStatus: string;
  message: string;
  needsConfirm: boolean;
};

export type RecruiterAgentUiOutreachSuccess = {
  kind: "outreach";
  message: string;
  subject: string;
  htmlBody: string;
  campaignName?: string;
};

export type RecruiterAgentUiFailure = {
  kind: "error";
  code: string;
  message: string;
};

export function parseShortlistAgentResult(result: unknown): RecruiterAgentUiShortlistSuccess | RecruiterAgentUiFailure {
  if (!result || typeof result !== "object") {
    return { kind: "error", code: "unknown", message: "Unexpected shortlist response." };
  }
  const r = result as Record<string, unknown>;
  if (r.ok === false) {
    return {
      kind: "error",
      code: typeof r.code === "string" ? r.code : "unknown",
      message: typeof r.message === "string" ? r.message : "Shortlist failed.",
    };
  }
  if (r.ok === true && r.status === "needs_confirm") {
    return {
      kind: "shortlist",
      applicationId: String(r.applicationId ?? ""),
      plannedStatus: String(r.plannedStatus ?? "shortlisted"),
      message: typeof r.message === "string" ? r.message : "Confirm to shortlist.",
      needsConfirm: true,
    };
  }
  if (r.ok === true && (r.status === "updated" || r.status === "authorized")) {
    return {
      kind: "shortlist",
      applicationId: String(r.applicationId ?? ""),
      plannedStatus: String(r.plannedStatus ?? "shortlisted"),
      message: typeof r.message === "string" ? r.message : "Application updated.",
      needsConfirm: false,
    };
  }
  return {
    kind: "error",
    code: "unknown",
    message: typeof r.message === "string" ? r.message : "Unexpected shortlist response.",
  };
}

export function parseOutreachAgentResult(result: unknown): RecruiterAgentUiOutreachSuccess | RecruiterAgentUiFailure {
  if (!result || typeof result !== "object") {
    return { kind: "error", code: "unknown", message: "Unexpected outreach response." };
  }
  const r = result as Record<string, unknown>;
  if (r.ok === false) {
    return {
      kind: "error",
      code: typeof r.code === "string" ? r.code : "unknown",
      message: typeof r.message === "string" ? r.message : "Outreach draft failed.",
    };
  }

  const campaign = r.campaign as Record<string, unknown> | undefined;
  const preview = r.preview as Record<string, unknown> | undefined;
  const subject =
    (typeof preview?.subject === "string" && preview.subject) ||
    (typeof campaign?.subject === "string" && campaign.subject) ||
    "";
  const htmlBody =
    (typeof preview?.html === "string" && preview.html) ||
    (typeof campaign?.htmlBody === "string" && campaign.htmlBody) ||
    "";

  if (r.ok === true && (subject || htmlBody)) {
    return {
      kind: "outreach",
      message: typeof r.message === "string" ? r.message : "Draft ready.",
      subject,
      htmlBody,
      campaignName: typeof campaign?.name === "string" ? campaign.name : undefined,
    };
  }

  return {
    kind: "error",
    code: "unknown",
    message: typeof r.message === "string" ? r.message : "Outreach draft had no content.",
  };
}

/** Strip simple HTML tags for a plain editable draft body. */
export function htmlToEditablePlain(html: string): string {
  return html
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
