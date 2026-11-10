import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCanMutateCrm } from "@/lib/crm/ownership";
import {
  RESEND_TEST_RECIPIENTS,
  RESEND_TEST_SEGMENT_NAME,
} from "@/lib/crm/resend-test-fixtures";
import {
  createCrmContact,
  createCrmSegment,
  insertCrmSegmentMembers,
  listCrmContacts,
  listCrmSegmentMemberContactIds,
  listCrmSegments,
} from "@/lib/crm/supabase-crm";
import type { CrmContact, CrmSegment } from "@/lib/crm/types";
import type { SupabaseClient } from "@supabase/supabase-js";

async function loadCallerProfile(context: { supabase: { from: (t: string) => unknown }; userId: string }) {
  const sb = context.supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { id: string; role: string } | null; error: Error | null }>;
        };
      };
    };
  };
  const { data: profile, error } = await sb
    .from("profiles")
    .select("id,role")
    .eq("id", context.userId)
    .maybeSingle();
  if (error) throw error;
  return profile;
}

export type SetupResendTestFixtureResult = {
  ok: true;
  contacts: CrmContact[];
  segment: CrmSegment;
  segmentCreated: boolean;
  contactsCreated: number;
};

/**
 * Ensures the three official Resend test contacts and a manual segment exist for the signed-in recruiter.
 * Safe to run repeatedly (idempotent).
 */
export const setupResendTestFixture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SetupResendTestFixtureResult> => {
    const profile = await loadCallerProfile(context);
    if (!profile) throw new Error("Profile not found");
    if (profile.role !== "recruiter") {
      throw new Error("Only recruiters may set up Resend test fixtures");
    }

    const sb = context.supabase as SupabaseClient;
    const recruiterId = context.userId;
    const access = assertCanMutateCrm({
      ownerRecruiterId: recruiterId,
      callerId: recruiterId,
      callerRole: profile.role,
    });
    if (!access.ok) throw new Error(access.error);

    const contacts: CrmContact[] = [];
    let contactsCreated = 0;
    for (const fixture of RESEND_TEST_RECIPIENTS) {
      const result = await createCrmContact(
        {
          recruiterId,
          email: fixture.email,
          fullName: fixture.fullName,
          notes: fixture.notes,
          segmentKind: "new",
        },
        sb as never,
      );
      if (result.created) contactsCreated += 1;
      contacts.push(result.contact);
    }

    const segments = await listCrmSegments(recruiterId, sb as never);
    let segment = segments.find(
      (s) => s.segmentType === "manual" && s.name === RESEND_TEST_SEGMENT_NAME,
    );
    let segmentCreated = false;
    if (!segment) {
      segment = await createCrmSegment(
        {
          recruiterId,
          name: RESEND_TEST_SEGMENT_NAME,
          kind: "new",
          filter: {},
          segmentType: "manual",
        },
        sb as never,
      );
      segmentCreated = true;
    }

    const existingMemberIds = await listCrmSegmentMemberContactIds(segment.id, sb as never);
    const contactIds = contacts.map((c) => c.id);
    const missing = contactIds.filter((id) => !existingMemberIds.includes(id));
    if (missing.length > 0) {
      await insertCrmSegmentMembers(segment.id, recruiterId, missing, sb as never);
    }

    const allContacts = await listCrmContacts(recruiterId, sb as never);
    const resolvedContacts = contactIds
      .map((id) => allContacts.find((c) => c.id === id))
      .filter((c): c is CrmContact => !!c);

    return {
      ok: true,
      contacts: resolvedContacts,
      segment,
      segmentCreated,
      contactsCreated,
    };
  });
