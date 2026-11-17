import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapDbRole } from "@/lib/auth";
import { invokeRecruiterAgentViaSupervisor } from "@/lib/ai/recruiter-via-supervisor";

const shortlistSchema = z.object({
  action: z.literal("shortlist"),
  applicationId: z.string().uuid(),
  status: z.enum(["shortlisted", "interview", "rejected", "hired"]).optional(),
  confirm: z.boolean(),
});

const draftSchema = z.object({
  action: z.literal("draft_outreach"),
  jobId: z.string().uuid(),
  applicationId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  segmentId: z.string().uuid().optional(),
  confirmSend: z.boolean().optional(),
  draftKind: z.enum(["outreach", "offer"]).optional(),
});

const supervisedSchema = z.object({
  action: z.literal("supervised"),
  question: z.string().trim().min(3).max(1500),
  applicationId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  confirm: z.boolean().optional(),
});

const recruiterAgentSchema = z.discriminatedUnion("action", [
  shortlistSchema,
  draftSchema,
  supervisedSchema,
]);

/**
 * Recruiter-gated agent tools (Phase 7 + Track 3 supervisor orchestration).
 * All actions delegate through runSupervisor — ownership from JWT + DB, never body identity.
 */
export const askRecruiterAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => recruiterAgentSchema.parse(data))
  .handler(async ({ data, context }) => {
    try {
      const { data: profile, error: profileError } = await context.supabase
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();

      if (profileError || !profile) {
        return { ok: false as const, code: "unauthorized" as const, message: "Could not verify profile." };
      }

      const role = mapDbRole(profile.role);
      if (role !== "recruiter" && role !== "admin") {
        return {
          ok: false as const,
          code: "forbidden" as const,
          message: "Recruiter tools are only available to recruiters and admins.",
        };
      }

      return await invokeRecruiterAgentViaSupervisor(
        {
          supabase: context.supabase as never,
          userId: context.userId,
          role,
        },
        data,
      );
    } catch (err) {
      console.error(
        "[askRecruiterAgent] unhandled",
        err instanceof Error ? err.name : "unknown",
      );
      return {
        ok: false as const,
        code: "unknown" as const,
        message: "The recruiter agent hit an unexpected server error. Please try again.",
      };
    }
  });
