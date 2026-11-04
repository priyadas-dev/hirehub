import { describe, expect, it, vi } from "vitest";
import {
  buildCampaignPreview,
  campaignSendIdempotencyKey,
  prepareCampaignSend,
  recipientSendIdempotencyKey,
} from "@/lib/crm/campaigns";
import { buildCampaignEmailPayload, sendCampaignEmailViaResend } from "@/lib/crm/campaign-mail";
import {
  filterContactsForRecruiter,
  normalizeContactEmail,
  upsertContactAvoidingDuplicate,
} from "@/lib/crm/contacts";
import { syncCrmContactToHubSpot } from "@/lib/crm/hubspot-contact-sync";
import {
  planApplicantImport,
  segmentKindFromApplicationStatus,
  summarizeApplicantImport,
} from "@/lib/crm/import-from-applicants";
import { createMemoryCrmStore } from "@/lib/crm/memory-store";
import { assertCanMutateCrm, canAccessCrmOwnedResource } from "@/lib/crm/ownership";
import { createSegmentRecord, resolveSegmentAudience } from "@/lib/crm/segments";
import { buildCrmContactSyncPayload } from "@/lib/crm/sync-from-application";
import { JOB_CATEGORIES, mergeJobCategories, parseJobCategory } from "@/lib/job-categories";
import { createMemoryEmailDeliveryStore } from "@/lib/integrations/email-delivery-store";
import { handleResendWebhookRequest } from "@/lib/integrations/resend-webhook";
import { createHmac } from "node:crypto";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";

describe("CRM ownership", () => {
  it("allows owning recruiter and admin; denies other recruiter", () => {
    expect(
      canAccessCrmOwnedResource({ ownerRecruiterId: R1, callerId: R1, callerRole: "recruiter" }),
    ).toBe(true);
    expect(
      canAccessCrmOwnedResource({ ownerRecruiterId: R1, callerId: R2, callerRole: "admin" }),
    ).toBe(true);
    expect(
      canAccessCrmOwnedResource({ ownerRecruiterId: R1, callerId: R2, callerRole: "recruiter" }),
    ).toBe(false);
    expect(
      assertCanMutateCrm({ ownerRecruiterId: R1, callerId: R2, callerRole: "recruiter" }).ok,
    ).toBe(false);
  });
});

describe("CRM contacts", () => {
  it("normalizes email and prevents duplicates per recruiter", () => {
    expect(normalizeContactEmail("  A@B.com ")).toBe("a@b.com");
    const first = upsertContactAvoidingDuplicate([], {
      recruiterId: R1,
      email: "a@b.com",
      fullName: "A",
    });
    expect(first.ok && first.created).toBe(true);
    const second = upsertContactAvoidingDuplicate(first.ok ? [first.contact] : [], {
      recruiterId: R1,
      email: "A@B.com",
      fullName: "A2",
    });
    expect(second.ok && !second.created && second.reason === "duplicate_email").toBe(true);
    const otherRecruiter = upsertContactAvoidingDuplicate(first.ok ? [first.contact] : [], {
      recruiterId: R2,
      email: "a@b.com",
    });
    expect(otherRecruiter.ok && otherRecruiter.created).toBe(true);
  });

  it("filters contacts by skills and status for owner only", () => {
    const store = createMemoryCrmStore();
    store.addContact({
      recruiterId: R1,
      email: "dev@ex.com",
      skills: ["React"],
      applicationStatus: "shortlisted",
      segmentKind: "active",
    });
    store.addContact({
      recruiterId: R1,
      email: "ops@ex.com",
      skills: ["Ops"],
      segmentKind: "new",
    });
    store.addContact({ recruiterId: R2, email: "other@ex.com", skills: ["React"] });

    const listed = store.listContacts(R1, { id: R1, role: "recruiter" }, { skills: ["React"] });
    expect(listed.ok && listed.contacts).toHaveLength(1);
    const forbidden = store.listContacts(R1, { id: R2, role: "recruiter" });
    expect(forbidden.ok).toBe(false);

    const filtered = filterContactsForRecruiter(store.contacts(), R1, {
      applicationStatuses: ["shortlisted"],
    });
    expect(filtered).toHaveLength(1);
  });
});

describe("CRM segments", () => {
  it("resolves audience by kind + filter", () => {
    const store = createMemoryCrmStore();
    store.addContact({
      recruiterId: R1,
      email: "a@ex.com",
      segmentKind: "active",
      skills: ["TypeScript"],
      applicationStatus: "interview",
    });
    store.addContact({
      recruiterId: R1,
      email: "b@ex.com",
      segmentKind: "new",
      skills: ["TypeScript"],
    });
    const seg = createSegmentRecord({
      recruiterId: R1,
      name: "TS interviews",
      kind: "active",
      filter: {
        segmentKinds: ["active"],
        skills: ["TypeScript"],
        applicationStatuses: ["interview"],
      },
    });
    expect("error" in seg).toBe(false);
    if ("error" in seg) return;
    const audience = resolveSegmentAudience(store.contacts(), seg);
    expect(audience.map((c) => c.email)).toEqual(["a@ex.com"]);
  });
});

describe("CRM campaigns + send idempotency", () => {
  it("requires confirm and is idempotent on second send", async () => {
    const store = createMemoryCrmStore();
    store.addContact({
      recruiterId: R1,
      email: "c@ex.com",
      segmentKind: "new",
    });
    const seg = store.addSegment({ recruiterId: R1, name: "New", kind: "new" });
    expect(seg.ok).toBe(true);
    if (!seg.ok) return;
    const camp = store.addCampaign({
      recruiterId: R1,
      name: "Hello",
      segmentId: seg.segment.id,
      subject: "Hi",
      htmlBody: "<p>Hello</p>",
    });
    expect(camp.ok).toBe(true);
    if (!camp.ok) return;

    const denied = await store.sendCampaign({
      campaignId: camp.campaign.id,
      callerId: R2,
      callerRole: "recruiter",
      confirm: true,
    });
    expect(denied.ok).toBe(false);

    const noConfirm = prepareCampaignSend({
      campaign: camp.campaign,
      segment: seg.segment,
      contacts: store.contacts(),
      existingRecipients: store.recipients(),
      confirm: false,
    });
    expect(noConfirm.ok).toBe(false);

    const first = await store.sendCampaign({
      campaignId: camp.campaign.id,
      callerId: R1,
      callerRole: "recruiter",
      confirm: true,
    });
    expect(first.ok && !first.alreadySent).toBe(true);
    expect(campaignSendIdempotencyKey(camp.campaign.id)).toMatch(/^crm:campaign:send:/);
    expect(recipientSendIdempotencyKey(camp.campaign.id, "x")).toMatch(/recipient/);

    const second = await store.sendCampaign({
      campaignId: camp.campaign.id,
      callerId: R1,
      callerRole: "recruiter",
      confirm: true,
    });
    expect(second.ok && second.alreadySent).toBe(true);
  });

  it("builds preview blockers and campaign mail tags", () => {
    const preview = buildCampaignPreview({
      id: "c1",
      recruiterId: R1,
      segmentId: null,
      name: "X",
      subject: "",
      htmlBody: "",
      status: "draft",
      sendIdempotencyKey: null,
      confirmedAt: null,
      sentAt: null,
      createdAt: new Date().toISOString(),
    });
    expect(preview.ready).toBe(false);
    const payload = buildCampaignEmailPayload({
      from: "from@hirehub.test",
      to: "a@b.com",
      subject: "S",
      html: "<p>Hi</p>",
      campaignId: "camp",
      recipientId: "rec",
      contactId: "con",
    });
    expect(payload.tags).toContainEqual({ name: "campaign_recipient_id", value: "rec" });
  });

  it("skips Resend when not configured", async () => {
    const result = await sendCampaignEmailViaResend({
      to: "a@b.com",
      subject: "S",
      html: "<p>x</p>",
      campaignId: "c",
      recipientId: "r",
      contactId: "k",
      env: {},
    });
    expect(result).toMatchObject({ ok: true, skipped: true });
  });
});

describe("CRM webhook tracking idempotency", () => {
  const secret = "whsec_" + Buffer.from("crm-phase5-secret-bytes!!").toString("base64");

  function sign(body: string, id: string, ts: string) {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`, "utf8").digest("base64");
    return `v1,${expected}`;
  }

  it("updates campaign recipient tracking and ignores replay", async () => {
    const store = createMemoryCrmStore();
    store.addContact({ recruiterId: R1, email: "c@ex.com", segmentKind: "new" });
    const seg = store.addSegment({ recruiterId: R1, name: "New", kind: "new" });
    if (!seg.ok) return;
    const camp = store.addCampaign({
      recruiterId: R1,
      name: "Hello",
      segmentId: seg.segment.id,
      subject: "Hi",
      htmlBody: "<p>Hi</p>",
    });
    if (!camp.ok) return;
    await store.sendCampaign({
      campaignId: camp.campaign.id,
      callerId: R1,
      callerRole: "recruiter",
      confirm: true,
    });
    const recipient = store.recipients()[0]!;
    const first = store.applyWebhook({
      eventId: "evt_1",
      recipientId: recipient.id,
      event: "opened",
    });
    expect(first.ok && !first.duplicate && first.recipient?.trackingStatus === "opened").toBe(true);
    const replay = store.applyWebhook({
      eventId: "evt_1",
      recipientId: recipient.id,
      event: "opened",
    });
    expect(replay.ok && replay.duplicate).toBe(true);

    const deliveryStore = createMemoryEmailDeliveryStore();
    const body = JSON.stringify({
      type: "email.opened",
      data: {
        email_id: "re_1",
        tags: [{ name: "campaign_recipient_id", value: recipient.id }],
      },
    });
    const id = "msg_crm_1";
    const ts = "1700000000";
    const result = await handleResendWebhookRequest({
      secret,
      headers: {
        "svix-id": id,
        "svix-timestamp": ts,
        "svix-signature": sign(body, id, ts),
      },
      rawBody: body,
      store: deliveryStore,
      nowSec: 1700000000,
    });
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.campaignRecipientId).toBe(recipient.id);
      expect(result.body.trackingStatus).toBe("opened");
    }
  });
});

describe("CRM import from applicants (secure planner)", () => {
  const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("imports eligible applicants for owning recruiter", () => {
    const profiles = new Map([
      [S1, { email: "seeker1@ex.com", fullName: "Seeker One" }],
      [S2, { email: "seeker2@ex.com", fullName: "Seeker Two" }],
    ]);
    const plan = planApplicantImport({
      callerId: R1,
      callerRole: "recruiter",
      applications: [
        { seekerId: S1, status: "applied", jobRecruiterId: R1 },
        { seekerId: S2, status: "hired", jobRecruiterId: R1 },
      ],
      profilesBySeekerId: profiles,
      existingEmailsByRecruiterId: new Map([[R1, new Set()]]),
    });
    expect(plan.imported).toBe(2);
    expect(plan.skippedMissingEmail).toBe(0);
    expect(plan.skippedDuplicate).toBe(0);
    expect(plan.skippedUnauthorizedJob).toBe(0);
    expect(plan.toInsert[0]?.segmentKind).toBe("new");
    expect(plan.toInsert[1]?.segmentKind).toBe("placed");
    expect(summarizeApplicantImport(plan)).toEqual({ imported: 2, updated: 0, skipped: 0 });
  });

  it("updates existing emails and skips same-batch repeats", () => {
    const profiles = new Map([[S1, { email: "dup@ex.com", fullName: "Dup", skillsText: "React, Python" }]]);
    const plan = planApplicantImport({
      callerId: R1,
      callerRole: "recruiter",
      applications: [
        { seekerId: S1, status: "applied", jobRecruiterId: R1, jobCategory: "IT" },
        { seekerId: S1, status: "shortlisted", jobRecruiterId: R1, jobCategory: "IT" },
      ],
      profilesBySeekerId: profiles,
      existingEmailsByRecruiterId: new Map([[R1, new Set(["dup@ex.com"])]]),
    });
    // existing → update once; second app in batch skipped as duplicate
    expect(plan.imported).toBe(0);
    expect(plan.updated).toBe(1);
    expect(plan.skippedDuplicate).toBe(1);
    expect(plan.toUpdate[0]?.skills).toEqual(expect.arrayContaining(["React", "Python"]));
    expect(plan.toUpdate[0]?.jobCategories).toContain("IT");

    const fresh = planApplicantImport({
      callerId: R1,
      callerRole: "recruiter",
      applications: [
        { seekerId: S1, status: "applied", jobRecruiterId: R1, jobCategory: "Marketing" },
        { seekerId: S1, status: "rejected", jobRecruiterId: R1, jobCategory: "Marketing" },
      ],
      profilesBySeekerId: profiles,
      existingEmailsByRecruiterId: new Map([[R1, new Set()]]),
    });
    expect(fresh.imported).toBe(1);
    expect(fresh.skippedDuplicate).toBe(1);
    expect(fresh.toInsert[0]?.jobCategories).toContain("Marketing");
  });

  it("skips applicants with missing or invalid emails", () => {
    const profiles = new Map([
      [S1, { email: null, fullName: "No Email" }],
      [S2, { email: "not-an-email", fullName: "Bad" }],
    ]);
    const plan = planApplicantImport({
      callerId: R1,
      callerRole: "recruiter",
      applications: [
        { seekerId: S1, status: "applied", jobRecruiterId: R1 },
        { seekerId: S2, status: "applied", jobRecruiterId: R1 },
      ],
      profilesBySeekerId: profiles,
      existingEmailsByRecruiterId: new Map([[R1, new Set()]]),
    });
    expect(plan.imported).toBe(0);
    expect(plan.skippedMissingEmail).toBe(2);
  });

  it("denies seeker role (unauthorized)", () => {
    const profiles = new Map([[S1, { email: "a@ex.com", fullName: "A" }]]);
    const plan = planApplicantImport({
      callerId: R1,
      callerRole: "job_seeker",
      applications: [{ seekerId: S1, status: "applied", jobRecruiterId: R1 }],
      profilesBySeekerId: profiles,
      existingEmailsByRecruiterId: new Map([[R1, new Set()]]),
    });
    expect(plan.imported).toBe(0);
    expect(plan.skippedUnauthorizedJob).toBe(1);
  });

  it("blocks cross-recruiter job access", () => {
    const profiles = new Map([
      [S1, { email: "mine@ex.com", fullName: "Mine" }],
      [S2, { email: "theirs@ex.com", fullName: "Theirs" }],
    ]);
    const plan = planApplicantImport({
      callerId: R1,
      callerRole: "recruiter",
      applications: [
        { seekerId: S1, status: "applied", jobRecruiterId: R1 },
        { seekerId: S2, status: "applied", jobRecruiterId: R2 },
      ],
      profilesBySeekerId: profiles,
      existingEmailsByRecruiterId: new Map([
        [R1, new Set()],
        [R2, new Set()],
      ]),
    });
    expect(plan.imported).toBe(1);
    expect(plan.toInsert[0]?.email).toBe("mine@ex.com");
    expect(plan.skippedUnauthorizedJob).toBe(1);
  });

  it("maps application status to segment kinds", () => {
    expect(segmentKindFromApplicationStatus("applied")).toBe("new");
    expect(segmentKindFromApplicationStatus("hired")).toBe("placed");
    expect(segmentKindFromApplicationStatus("rejected")).toBe("active");
    expect(segmentKindFromApplicationStatus("interview")).toBe("active");
  });

  it("feeds imported segment_kind into resolveSegmentAudience without changing import AuthZ", () => {
    const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const S3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const plan = planApplicantImport({
      callerId: R1,
      callerRole: "recruiter",
      applications: [
        { seekerId: S1, status: "applied", jobRecruiterId: R1 },
        { seekerId: S2, status: "hired", jobRecruiterId: R1 },
        { seekerId: S3, status: "interview", jobRecruiterId: R1 },
        { seekerId: S1, status: "applied", jobRecruiterId: R2 }, // cross-recruiter ignored
      ],
      profilesBySeekerId: new Map([
        [S1, { email: "new@ex.com", fullName: "New" }],
        [S2, { email: "placed@ex.com", fullName: "Placed" }],
        [S3, { email: "active@ex.com", fullName: "Active" }],
      ]),
      existingEmailsByRecruiterId: new Map([
        [R1, new Set()],
        [R2, new Set()],
      ]),
    });
    expect(plan.skippedUnauthorizedJob).toBe(1);
    expect(plan.imported).toBe(3);

    const contacts = plan.toInsert.map((row, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      recruiterId: row.recruiterId,
      companyId: null,
      seekerProfileId: row.seekerProfileId,
      email: row.email,
      emailNormalized: row.emailNormalized,
      fullName: row.fullName,
      skills: row.skills,
      jobInterests: [] as string[],
      jobCategories: row.jobCategories,
      applicationStatus: row.applicationStatus,
      segmentKind: row.segmentKind,
      hubspotContactId: null,
      notes: null,
      createdAt: new Date().toISOString(),
    }));

    const newSeg = createSegmentRecord({ recruiterId: R1, name: "New pool", kind: "new" });
    const placedSeg = createSegmentRecord({ recruiterId: R1, name: "Placed", kind: "placed" });
    const activeSeg = createSegmentRecord({ recruiterId: R1, name: "Active", kind: "active" });
    expect("error" in newSeg || "error" in placedSeg || "error" in activeSeg).toBe(false);
    if ("error" in newSeg || "error" in placedSeg || "error" in activeSeg) return;

    expect(resolveSegmentAudience(contacts, newSeg).map((c) => c.email)).toEqual(["new@ex.com"]);
    expect(resolveSegmentAudience(contacts, placedSeg).map((c) => c.email)).toEqual(["placed@ex.com"]);
    expect(resolveSegmentAudience(contacts, activeSeg).map((c) => c.email)).toEqual(["active@ex.com"]);
  });
});

describe("Phase A job category + CRM sync payload", () => {
  it("parses default labels and merges custom category names without duplicates", () => {
    expect(JOB_CATEGORIES).toContain("IT");
    expect(parseJobCategory("Marketing")).toBe("Marketing");
    expect(parseJobCategory("nope")).toBe("Other");
    expect(mergeJobCategories(["IT"], "IT")).toEqual(["IT"]);
    expect(mergeJobCategories(["IT"], "HR")).toEqual(["IT", "HR"]);
    expect(mergeJobCategories(["Legal Tech"], "legal tech")).toEqual(["Legal Tech"]);
  });

  it("builds CRM sync payload with skills status and category", () => {
    const payload = buildCrmContactSyncPayload({
      recruiterId: R1,
      seekerProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "dev@ex.com",
      fullName: "Dev",
      skillsText: "React TypeScript Python",
      applicationStatus: "shortlisted",
      jobCategory: "IT",
    });
    expect("error" in payload).toBe(false);
    if ("error" in payload) return;
    expect(payload.segmentKind).toBe("active");
    expect(payload.jobCategories).toContain("IT");
    expect(payload.skills).toEqual(expect.arrayContaining(["React", "TypeScript", "Python"]));
  });
});

describe("HubSpot CRM sync soft-fail", () => {
  it("skips when token missing and fails without breaking caller", async () => {
    const skipped = await syncCrmContactToHubSpot({
      email: "a@b.com",
      fullName: "A B",
      contactId: "11111111-1111-4111-8111-111111111111",
      env: {},
    });
    expect(skipped).toMatchObject({ ok: true, skipped: true });

    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    const failed = await syncCrmContactToHubSpot({
      email: "a@b.com",
      fullName: "A B",
      contactId: "11111111-1111-4111-8111-111111111111",
      env: { HUBSPOT_ACCESS_TOKEN: "pat" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(failed.ok).toBe(false);
  });
});
