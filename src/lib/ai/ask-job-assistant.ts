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
import {
  buildLiveJobFilterQuery,
  filterLiveJobsByQuery,
  recommendApprovedLiveJobs,
} from "@/lib/ai/live-recommend";
import { decodeResumePdfBase64, extractResumePdfText } from "@/lib/ai/resume-pdf";
import { decodeDocxBase64, extractDocxText } from "@/lib/ai/assistant-docx";
import { analyzeImageWithGemini } from "@/lib/ai/assistant-image";

/**
 * Authenticated seeker-only AI Job Assistant.
 * Gemini + service-role corpus access stay on the server. Live jobs use the caller's JWT (RLS).
 * Attachment bytes are parsed only on the server and never logged.
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
      extractResumePdf: async (base64) => {
        const bytes = decodeResumePdfBase64(base64);
        if (!bytes) {
          return {
            ok: false,
            code: "unsupported",
            message:
              "That PDF could not be decoded. Re-attach a valid PDF under 2 MB, or type your question.",
          };
        }
        const extracted = await extractResumePdfText(bytes);
        if (!extracted.ok) {
          return { ok: false, code: extracted.code, message: extracted.message };
        }
        return { ok: true, text: extracted.text };
      },
      extractDocx: async (base64) => {
        const bytes = decodeDocxBase64(base64);
        if (!bytes) {
          return {
            ok: false,
            code: "unsupported",
            message: "That DOCX could not be decoded. Re-attach a valid DOCX under 2 MB.",
          };
        }
        const extracted = await extractDocxText(bytes);
        if (!extracted.ok) {
          return { ok: false, code: extracted.code, message: extracted.message };
        }
        return { ok: true, text: extracted.text };
      },
      analyzeImage: async ({ question, base64, mime }) => {
        if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
          return { ok: false, message: "Only JPG, PNG, and WEBP images are supported." };
        }
        return analyzeImageWithGemini({ question, base64, mime });
      },
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
      listLiveJobs: async (question, options) => {
        const skills = options?.skillTerms ?? [];
        const limit = options?.limit ?? 8;
        const filterQuery = buildLiveJobFilterQuery(question);

        const primary = await recommendApprovedLiveJobs(context.supabase as never, {
          query: question.slice(0, 200),
          limit,
        });
        if (!primary.ok) return { ok: false, message: primary.message };

        if (!skills.length) return { ok: true, jobs: primary.jobs };

        const skillPass = await recommendApprovedLiveJobs(context.supabase as never, {
          query: `${question.slice(0, 120)} ${skills.join(" ")}`.slice(0, 200),
          limit: Math.max(limit, 30),
        });

        const byId = new Map<string, (typeof primary.jobs)[number]>();
        for (const job of primary.jobs) byId.set(job.id, job);
        if (skillPass.ok) {
          for (const job of skillPass.jobs) byId.set(job.id, job);
        }

        if (byId.size < 5) {
          const broad = await recommendApprovedLiveJobs(context.supabase as never, {
            query: filterQuery,
            limit: 30,
          });
          if (broad.ok) {
            for (const job of broad.jobs) byId.set(job.id, job);
          }
        }

        const merged = filterLiveJobsByQuery([...byId.values()], question);
        return { ok: true, jobs: merged };
      },
      generateAnswer: async (prompt) => {
        const generated = await fetchGeminiGeneratedText(prompt, readGeminiApiKey());
        if (!generated.ok) return { ok: false, message: generated.message };
        return { ok: true, text: generated.text };
      },
    });
  });
