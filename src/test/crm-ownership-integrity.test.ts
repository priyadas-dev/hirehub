import { describe, expect, it } from "vitest";
import { createMemoryCrmStore } from "@/lib/crm/memory-store";
import {
  assertCampaignSegmentSameOwner,
  assertRecipientOwnershipCohesion,
  CRM_FK_VIOLATION,
  evaluateCrossRecruiterRecipientInsert,
} from "@/lib/crm/ownership-integrity";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";

describe("CRM ownership integrity (PROPOSED_0022 composite FK mirror)", () => {
  it("T1: same-owner campaign + segment succeeds", () => {
    const store = createMemoryCrmStore();
    const seg = store.addSegment({ recruiterId: R1, name: "Mine", kind: "new" });
    expect(seg.ok).toBe(true);
    if (!seg.ok) return;
    const camp = store.addCampaign({
      recruiterId: R1,
      name: "Hello",
      segmentId: seg.segment.id,
      subject: "Hi",
      htmlBody: "<p>x</p>",
    });
    expect(camp.ok).toBe(true);
  });

  it("T2: campaign with foreign segment_id is rejected (FK 23503)", () => {
    const store = createMemoryCrmStore();
    const foreign = store.addSegment({ recruiterId: R2, name: "B seg", kind: "new" });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    const camp = store.addCampaign({
      recruiterId: R1,
      name: "Steal",
      segmentId: foreign.segment.id,
    });
    expect(camp.ok).toBe(false);
    if (camp.ok) return;
    expect(camp.code).toBe(CRM_FK_VIOLATION);
    expect(camp.constraint).toBe("crm_campaigns_segment_same_recruiter_fkey");
  });

  it("T3: update own campaign segment_id → foreign segment rejected", () => {
    const store = createMemoryCrmStore();
    const own = store.addSegment({ recruiterId: R1, name: "A", kind: "new" });
    const foreign = store.addSegment({ recruiterId: R2, name: "B", kind: "new" });
    expect(own.ok && foreign.ok).toBe(true);
    if (!own.ok || !foreign.ok) return;
    const camp = store.addCampaign({
      recruiterId: R1,
      name: "C",
      segmentId: own.segment.id,
    });
    expect(camp.ok).toBe(true);
    if (!camp.ok) return;
    const updated = store.updateCampaignSegment({
      campaignId: camp.campaign.id,
      segmentId: foreign.segment.id,
    });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.code).toBe(CRM_FK_VIOLATION);
  });

  it("allows null segment_id (MATCH SIMPLE)", () => {
    const check = assertCampaignSegmentSameOwner({
      campaignRecruiterId: R1,
      segmentId: null,
      segment: null,
    });
    expect(check.ok).toBe(true);
    const store = createMemoryCrmStore();
    const camp = store.addCampaign({ recruiterId: R1, name: "Draft" });
    expect(camp.ok).toBe(true);
  });

  it("T4: recipient for own campaign + contact succeeds", () => {
    const store = createMemoryCrmStore();
    const contact = store.addContact({ recruiterId: R1, email: "a@ex.com" });
    expect(contact.ok && contact.created).toBe(true);
    if (!contact.ok || !contact.created) return;
    const camp = store.addCampaign({ recruiterId: R1, name: "C" });
    expect(camp.ok).toBe(true);
    if (!camp.ok) return;
    const recipient = store.insertRecipient({
      recruiterId: R1,
      campaignId: camp.campaign.id,
      contactId: contact.contact.id,
    });
    expect(recipient.ok).toBe(true);
  });

  it("T5: attacker stamps own recruiter_id on victim campaign/contact — FK reject (F09/F10)", () => {
    const store = createMemoryCrmStore();
    const victimContact = store.addContact({ recruiterId: R2, email: "b@ex.com" });
    const victimCamp = store.addCampaign({ recruiterId: R2, name: "B camp" });
    expect(victimContact.ok && victimContact.created && victimCamp.ok).toBe(true);
    if (!victimContact.ok || !victimContact.created || !victimCamp.ok) return;

    const poisoned = evaluateCrossRecruiterRecipientInsert({
      attackerRecruiterId: R1,
      victimCampaign: {
        id: victimCamp.campaign.id,
        recruiterId: victimCamp.campaign.recruiterId,
      },
      victimContact: {
        id: victimContact.contact.id,
        recruiterId: victimContact.contact.recruiterId,
      },
    });
    expect(poisoned.ok).toBe(false);
    if (poisoned.ok) return;
    expect(poisoned.code).toBe(CRM_FK_VIOLATION);

    const direct = store.insertRecipient({
      recruiterId: R1,
      campaignId: victimCamp.campaign.id,
      contactId: victimContact.contact.id,
    });
    expect(direct.ok).toBe(false);
    if (direct.ok) return;
    expect(direct.code).toBe(CRM_FK_VIOLATION);
  });

  it("T7: after failed poison, owner can still enroll same campaign/contact pair", () => {
    const store = createMemoryCrmStore();
    const contact = store.addContact({ recruiterId: R2, email: "owner@ex.com" });
    const camp = store.addCampaign({ recruiterId: R2, name: "Owner camp" });
    expect(contact.ok && contact.created && camp.ok).toBe(true);
    if (!contact.ok || !contact.created || !camp.ok) return;

    const attack = store.insertRecipient({
      recruiterId: R1,
      campaignId: camp.campaign.id,
      contactId: contact.contact.id,
    });
    expect(attack.ok).toBe(false);

    const legitimate = store.insertRecipient({
      recruiterId: R2,
      campaignId: camp.campaign.id,
      contactId: contact.contact.id,
    });
    expect(legitimate.ok).toBe(true);
  });

  it("rejects mismatched contact owner even when campaign matches", () => {
    const store = createMemoryCrmStore();
    const aContact = store.addContact({ recruiterId: R1, email: "a@ex.com" });
    const bContact = store.addContact({ recruiterId: R2, email: "b@ex.com" });
    const camp = store.addCampaign({ recruiterId: R1, name: "A camp" });
    expect(aContact.ok && bContact.ok && camp.ok).toBe(true);
    if (!aContact.ok || !bContact.ok || !camp.ok) return;
    void aContact;

    const bad = store.insertRecipient({
      recruiterId: R1,
      campaignId: camp.campaign.id,
      contactId: bContact.ok && bContact.created ? bContact.contact.id : "",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.constraint).toBe("crm_recipients_contact_same_recruiter_fkey");
  });

  it("T11: service-role tracking-only patch succeeds", () => {
    const store = createMemoryCrmStore();
    const contact = store.addContact({ recruiterId: R1, email: "t@ex.com" });
    const camp = store.addCampaign({ recruiterId: R1, name: "C" });
    if (!contact.ok || !contact.created || !camp.ok) return;
    const inserted = store.insertRecipient({
      recruiterId: R1,
      campaignId: camp.campaign.id,
      contactId: contact.contact.id,
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const patched = store.patchRecipientTracking({
      recipientId: inserted.recipient.id,
      trackingStatus: "opened",
      resendEmailId: "re_1",
    });
    expect(patched.ok).toBe(true);
  });

  it("T12: service-role retarget to other tenant campaign/contact with wrong recruiter rejected", () => {
    const store = createMemoryCrmStore();
    const aContact = store.addContact({ recruiterId: R1, email: "a@ex.com" });
    const bContact = store.addContact({ recruiterId: R2, email: "b@ex.com" });
    const aCamp = store.addCampaign({ recruiterId: R1, name: "A" });
    const bCamp = store.addCampaign({ recruiterId: R2, name: "B" });
    expect(aContact.ok && bContact.ok && aCamp.ok && bCamp.ok).toBe(true);
    if (!aContact.ok || !aContact.created || !bContact.ok || !bContact.created || !aCamp.ok || !bCamp.ok) {
      return;
    }
    const inserted = store.insertRecipient({
      recruiterId: R1,
      campaignId: aCamp.campaign.id,
      contactId: aContact.contact.id,
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    const retarget = store.retargetRecipient({
      recipientId: inserted.recipient.id,
      campaignId: bCamp.campaign.id,
      contactId: bContact.contact.id,
      recruiterId: R1,
    });
    expect(retarget.ok).toBe(false);
    if (retarget.ok) return;
    expect(retarget.code).toBe(CRM_FK_VIOLATION);
  });

  it("pure helper rejects foreign segment and mismatched triples", () => {
    const segCheck = assertCampaignSegmentSameOwner({
      campaignRecruiterId: R1,
      segmentId: "seg-b",
      segment: { id: "seg-b", recruiterId: R2 },
    });
    expect(segCheck.ok).toBe(false);

    const recip = assertRecipientOwnershipCohesion({
      rowRecruiterId: R1,
      campaignId: "c-b",
      contactId: "k-b",
      campaign: { id: "c-b", recruiterId: R2 },
      contact: { id: "k-b", recruiterId: R2 },
    });
    expect(recip.ok).toBe(false);
    if (!recip.ok) expect(recip.code).toBe(CRM_FK_VIOLATION);
  });
});
