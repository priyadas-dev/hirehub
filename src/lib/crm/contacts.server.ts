import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildManualContactUpdate,
  listCrmContactsPage,
  type CrmContactListQuery,
  type CrmContactSortDir,
  type CrmContactSortField,
} from "@/lib/crm/contacts-list";
import { assertCanMutateCrm } from "@/lib/crm/ownership";
import {
  getCrmContactById,
  listCrmContacts,
  updateCrmContactFields,
} from "@/lib/crm/supabase-crm";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrmSegmentKind } from "@/lib/crm/types";
import { CRM_SEGMENT_KINDS } from "@/lib/crm/types";

const listQuerySchema = z.object({
  query: z.string().optional(),
  skills: z.array(z.string()).optional(),
  jobCategories: z.array(z.string()).optional(),
  applicationStatuses: z.array(z.string()).optional(),
  segmentKinds: z.array(z.enum(CRM_SEGMENT_KINDS)).optional(),
  sortBy: z.enum(["name", "email", "createdAt", "segmentKind", "applicationStatus"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

const updateSchema = z.object({
  contactId: z.string().uuid(),
  fullName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  jobInterests: z.array(z.string()).optional(),
  segmentKind: z.enum(CRM_SEGMENT_KINDS).optional(),
  skills: z.array(z.string()).optional(),
});

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

function toListQuery(data: z.infer<typeof listQuerySchema>): CrmContactListQuery {
  return {
    query: data.query,
    skills: data.skills,
    jobCategories: data.jobCategories,
    applicationStatuses: data.applicationStatuses,
    segmentKinds: data.segmentKinds as CrmSegmentKind[] | undefined,
    sortBy: data.sortBy as CrmContactSortField | undefined,
    sortDir: data.sortDir as CrmContactSortDir | undefined,
    page: data.page,
    pageSize: data.pageSize,
  };
}

export const fetchCrmContactsPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => listQuerySchema.parse(data))
  .handler(async ({ data, context }) => {
    const profile = await loadCallerProfile(context);
    if (!profile) throw new Error("Profile not found");
    if (profile.role !== "recruiter" && profile.role !== "admin") {
      throw new Error("Only recruiters or admins may view CRM contacts");
    }

    const recruiterId = context.userId;
    const sb = context.supabase as SupabaseClient;
    const all = await listCrmContacts(recruiterId, sb as never);
    const page = listCrmContactsPage(all, recruiterId, toListQuery(data));
    return { ok: true as const, ...page };
  });

export const fetchCrmContactDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ contactId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const profile = await loadCallerProfile(context);
    if (!profile) throw new Error("Profile not found");

    const sb = context.supabase as SupabaseClient;
    const contact = await getCrmContactById(data.contactId, sb as never);
    if (!contact) throw new Error("Contact not found");

    const access = assertCanMutateCrm({
      ownerRecruiterId: contact.recruiterId,
      callerId: context.userId,
      callerRole: profile.role,
    });
    if (!access.ok) throw new Error(access.error);

    return { ok: true as const, contact };
  });

export const updateCrmContactManualFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const profile = await loadCallerProfile(context);
    if (!profile) throw new Error("Profile not found");

    const sb = context.supabase as SupabaseClient;
    const contact = await getCrmContactById(data.contactId, sb as never);
    if (!contact) throw new Error("Contact not found");

    const access = assertCanMutateCrm({
      ownerRecruiterId: contact.recruiterId,
      callerId: context.userId,
      callerRole: profile.role,
    });
    if (!access.ok) throw new Error(access.error);

    const built = buildManualContactUpdate(contact, {
      fullName: data.fullName,
      notes: data.notes,
      jobInterests: data.jobInterests,
      segmentKind: data.segmentKind,
      skills: data.skills,
    });
    if (!built.ok) throw new Error(built.error);

    const updated = await updateCrmContactFields(data.contactId, built.patch, sb as never);
    return { ok: true as const, contact: updated };
  });
