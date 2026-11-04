import { describe, expect, it } from "vitest";
import {
  buildCampaignPreview,
  mergeCampaignDraft,
  prepareCampaignSend,
} from "@/lib/crm/campaigns";
import { createSegmentRecord } from "@/lib/crm/segments";
import type { CrmCampaign, CrmContact } from "@/lib/crm/types";

const R1 = "11111111-1111-4111-8111-111111111111";
const SEG = "22222222-2222-4222-8222-222222222222";
const CAMP = "33333333-3333-4333-8333-333333333333";

function emptyDraftCampaign(): CrmCampaign {
  return {
    id: CAMP,
    recruiterId: R1,
    segmentId: SEG,
    name: "Test",
    subject: "",
    htmlBody: "",
    status: "draft",
    sendIdempotencyKey: null,
    confirmedAt: null,
    sentAt: null,
    createdAt: new Date().toISOString(),
  };
}

describe("CRM campaign content draft merge", () => {
  it("validates preview using in-form subject and htmlBody over empty persisted row", () => {
    const merged = mergeCampaignDraft(emptyDraftCampaign(), {
      subject: "new job are coming",
      htmlBody: "hello everyone, this is a message for everyone new job are coming",
    });
    const preview = buildCampaignPreview(merged);
    expect(preview.ready).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.subject).toBe("new job are coming");
  });

  it("prepareCampaignSend accepts campaign row after draft merge (manual segment audience)", () => {
    const seg = createSegmentRecord({
      id: SEG,
      recruiterId: R1,
      name: "IT Candi",
      segmentType: "manual",
    });
    expect("error" in seg).toBe(false);
    if ("error" in seg) return;

    const contact: CrmContact = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      recruiterId: R1,
      companyId: null,
      seekerProfileId: null,
      email: "a@example.com",
      emailNormalized: "a@example.com",
      fullName: "A",
      skills: [],
      jobInterests: [],
      jobCategories: [],
      applicationStatus: null,
      segmentKind: "new",
      hubspotContactId: null,
      notes: null,
      createdAt: new Date().toISOString(),
    };

    const campaign = mergeCampaignDraft(emptyDraftCampaign(), {
      subject: "Subject line",
      htmlBody: "<p>Body</p>",
    });

    const prepared = prepareCampaignSend({
      campaign,
      segment: seg,
      contacts: [contact],
      existingRecipients: [],
      confirm: true,
      manualMemberContactIds: [contact.id],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.recipients).toHaveLength(1);
  });

  it("still blocks send when draft subject and body are empty", () => {
    const preview = buildCampaignPreview(emptyDraftCampaign());
    expect(preview.ready).toBe(false);
    expect(preview.blockers).toContain("Subject is required");
    expect(preview.blockers).toContain("Email body is required");
  });
});
