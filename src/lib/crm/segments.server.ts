import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { defaultManualSegmentName, dedupeContactIds, isCrmSegmentId } from "@/lib/crm/manual-segments";
import { assertCanMutateCrm } from "@/lib/crm/ownership";
import { resolveSegmentAudience } from "@/lib/crm/segments";
import {
  createCrmSegment,
  deleteCrmSegmentMembers,
  getCrmSegmentById,
  insertCrmSegmentMembers,
  listCrmContacts,
  listCrmSegmentMemberContactIds,
  updateCrmSegmentName,
} from "@/lib/crm/supabase-crm";
import type { CrmContact, CrmSegmentKind } from "@/lib/crm/types";
import { CRM_SEGMENT_KINDS } from "@/lib/crm/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const createManualSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1),
  name: z.string().optional(),
  kind: z.enum(CRM_SEGMENT_KINDS).optional(),
});

const segmentIdSchema = z.object({
  segmentId: z.string().uuid(),
});

const fetchSegmentIdSchema = z.object({
  segmentId: z.string().min(1),
});

const renameSchema = segmentIdSchema.extend({
  name: z.string().min(1).max(200),
});

const memberIdsSchema = segmentIdSchema.extend({
  contactIds: z.array(z.string().uuid()).min(1),
});

const emptySegmentDetail = {
  ok: true as const,
  segment: null,
  members: [] as CrmContact[],
  memberContactIds: [] as string[],
};

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

async function assertSegmentAccess(
  segmentId: string,
  context: { supabase: SupabaseClient; userId: string },
  profile: { role: string },
) {
  const segment = await getCrmSegmentById(segmentId, context.supabase as never);
  if (!segment) throw new Error("Segment not found");
  const access = assertCanMutateCrm({
    ownerRecruiterId: segment.recruiterId,
    callerId: context.userId,
    callerRole: profile.role,
  });
  if (!access.ok) throw new Error(access.error);
  return segment;
}

async function loadOwnedContactsForIds(
  recruiterId: string,
  contactIds: string[],
  client: SupabaseClient,
): Promise<CrmContact[]> {
  const unique = dedupeContactIds(contactIds);
  const all = await listCrmContacts(recruiterId, client as never);
  const byId = new Map(all.map((c) => [c.id, c]));
  const resolved: CrmContact[] = [];
  for (const id of unique) {
    const c = byId.get(id);
    if (!c) throw new Error("One or more selected contacts were not found");
    if (c.recruiterId !== recruiterId) throw new Error("Cannot add another recruiter's contacts");
    resolved.push(c);
  }
  return resolved;
}

export const createManualSegmentFromContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => createManualSchema.parse(data))
  .handler(async ({ data, context }) => {
    const profile = await loadCallerProfile(context);
    if (!profile) throw new Error("Profile not found");
    if (profile.role !== "recruiter" && profile.role !== "admin") {
      throw new Error("Only recruiters or admins may create CRM segments");
    }
    if (profile.role !== "recruiter") {
      throw new Error("Manual segments must be created by the owning recruiter account");
    }

    const sb = context.supabase as SupabaseClient;
    const recruiterId = context.userId;
    const contactIds = dedupeContactIds(data.contactIds);
    const contacts = await loadOwnedContactsForIds(recruiterId, contactIds, sb);
    const name = data.name?.trim() || defaultManualSegmentName(contacts);
    const kind: CrmSegmentKind = data.kind ?? "new";

    const segment = await createCrmSegment(
      {
        recruiterId,
        name,
        kind,
        filter: {},
        segmentType: "manual",
      },
      sb as never,
    );

    try {
      await insertCrmSegmentMembers(segment.id, recruiterId, contacts.map((c) => c.id), sb as never);
    } catch (e) {
      throw e instanceof Error ? e : new Error("Could not save segment members");
    }

    return { ok: true as const, segment, memberCount: contacts.length };
  });

export const fetchManualSegmentDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => fetchSegmentIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const profile = await loadCallerProfile(context);
    if (!profile) throw new Error("Profile not found");
    if (!isCrmSegmentId(data.segmentId)) return emptySegmentDetail;
    const sb = context.supabase as SupabaseClient;
    const segment = await getCrmSegmentById(data.segmentId, sb as never);
    if (!segment) return emptySegmentDetail;
    const access = assertCanMutateCrm({
      ownerRecruiterId: segment.recruiterId,
      callerId: context.userId,
      callerRole: profile.role,
    });
    if (!access.ok) throw new Error(access.error);
    const contacts = await listCrmContacts(segment.recruiterId, sb as never);
    if (segment.segmentType === "manual") {
      const memberContactIds = await listCrmSegmentMemberContactIds(segment.id, sb as never);
      const members = contacts.filter((c) => memberContactIds.includes(c.id));
      return { ok: true as const, segment, members, memberContactIds };
    }
    const members = resolveSegmentAudience(contacts, segment);
    return {
      ok: true as const,
      segment,
      members,
      memberContactIds: members.map((c) => c.id),
    };
  });

export const renameCrmSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => renameSchema.parse(data))
  .handler(async ({ data, context }) => {
    const profile = await loadCallerProfile(context);
    if (!profile) throw new Error("Profile not found");
    const sb = context.supabase as SupabaseClient;
    await assertSegmentAccess(data.segmentId, { supabase: sb, userId: context.userId }, profile);
    const segment = await updateCrmSegmentName(data.segmentId, data.name, sb as never);
    return { ok: true as const, segment };
  });

export const addContactsToManualSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => memberIdsSchema.parse(data))
  .handler(async ({ data, context }) => {
    const profile = await loadCallerProfile(context);
    if (!profile) throw new Error("Profile not found");
    const sb = context.supabase as SupabaseClient;
    const segment = await assertSegmentAccess(data.segmentId, { supabase: sb, userId: context.userId }, profile);
    if (segment.segmentType !== "manual") {
      throw new Error("Only manual segments support adding contacts this way");
    }

    const contacts = await loadOwnedContactsForIds(segment.recruiterId, data.contactIds, sb);
    const existing = new Set(await listCrmSegmentMemberContactIds(segment.id, sb as never));
    const toAdd = contacts.map((c) => c.id).filter((id) => !existing.has(id));
    if (toAdd.length === 0) {
      return { ok: true as const, added: 0 };
    }
    await insertCrmSegmentMembers(segment.id, segment.recruiterId, toAdd, sb as never);
    return { ok: true as const, added: toAdd.length };
  });

export const removeContactsFromManualSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => memberIdsSchema.parse(data))
  .handler(async ({ data, context }) => {
    const profile = await loadCallerProfile(context);
    if (!profile) throw new Error("Profile not found");
    const sb = context.supabase as SupabaseClient;
    const segment = await assertSegmentAccess(data.segmentId, { supabase: sb, userId: context.userId }, profile);
    if (segment.segmentType !== "manual") {
      throw new Error("Only manual segments support removing contacts this way");
    }
    const unique = dedupeContactIds(data.contactIds);
    await deleteCrmSegmentMembers(segment.id, unique, sb as never);
    return { ok: true as const, removed: unique.length };
  });
