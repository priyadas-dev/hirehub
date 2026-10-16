import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapDbRole } from "@/lib/auth";
import { retrieveCorpusMatches } from "@/lib/ai/corpus-retrieve";
import { fetchGeminiGeneratedText, readGeminiApiKey } from "@/lib/ai/gemini-generate";
import {
  askJobAssistantInputSchema,
  geminiApiKeyConfigured,
  runJobAssistant,
  type AskJobAssistantResult,
} from "@/lib/ai/job-assistant";
import { recommendApprovedLiveJobs } from "@/lib/ai/live-recommend";

/**
 * Authenticated seeker-only AI Job Assistant.
 * Gemini + service-role corpus access stay on the server. Live jobs use the caller's JWT (RLS).
 */
export const askJobAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => askJobAssistantInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<AskJobAssistantResult> => {
    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();

    if (profileError || !profile) {
      return {
        ok: false,
        code: "unauthorized",
        message: "Could not verify your HireHub profile. Sign in again and retry.",
      };
    }

    const role = mapDbRole(profile.role);

    return runJobAssistant(data, {
      role,
      geminiConfigured: geminiApiKeyConfigured(),
      retrieveCorpus: async (question) => {
        try {
          const { createRagAdminClient } = await import("@/lib/ai/rag-admin");
          const admin = createRagAdminClient();
          const result = await retrieveCorpusMatches(admin, { query: question, matchCount: 5 });
          if (!result.ok) {
            return {
              ok: false,
              unavailable: /not ready|not configured|Missing/i.test(result.message),
              message: result.message,
            };
          }
          return { ok: true, matches: result.matches };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Corpus RAG unavailable.";
          return { ok: false, unavailable: true, message };
        }
      },
      listLiveJobs: async (question) => {
        const result = await recommendApprovedLiveJobs(context.supabase as never, {
          query: question.slice(0, 200),
          limit: 5,
        });
        if (!result.ok) return { ok: false, message: result.message };
        return { ok: true, jobs: result.jobs };
      },
      generateAnswer: async (prompt) => {
        const generated = await fetchGeminiGeneratedText(prompt, readGeminiApiKey());
        if (!generated.ok) return { ok: false, message: generated.message };
        return { ok: true, text: generated.text };
      },
    });
  });
