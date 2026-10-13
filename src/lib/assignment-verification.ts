/**
 * Assignment demo verification notes (code-side helpers + documented checks).
 * Live Google/Vercel smoke must still be run manually on the production URL.
 */

/** Local app Supabase project reference (hostname of VITE_SUPABASE_URL) — not a secret. */
export const CONFIGURED_SUPABASE_PROJECT_REF = "munqgybiuqpncxbgfvdp" as const;

/**
 * How to verify deadline migrations on the live project (run in Dashboard SQL Editor).
 * Do not treat one query as proof of the other.
 */
export const DEADLINE_MIGRATION_VERIFY_SQL = {
  /** Proves migration 0002 (column) — not an RLS policy. */
  column0002: `
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'jobs'
  and column_name = 'application_deadline';
`.trim(),
  /** Proves migration 0003 (applications INSERT policy text) — there is no jobs deadline RLS policy. */
  policy0003: `
select pol.polname as policy_name,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
from pg_policy pol
join pg_class cls on cls.oid = pol.polrelid
join pg_namespace nsp on nsp.oid = cls.relnamespace
where nsp.nspname = 'public'
  and cls.relname = 'applications'
  and pol.polcmd = 'a'
  and pol.polname = 'seeker applies to approved job';
`.trim(),
} as const;

/** Notification Edge Function stance for the internship demo. */
export const NOTIFY_EDGE_FUNCTION_DECISION = {
  functionName: "notify-application-status",
  assignmentMandatory: false,
  keepLocalImplementation: true,
  expandNotifyFunctionsBeforeDemo: false,
  deliveryStatus: "delivered" as const,
  rationale:
    "Deploy notify-application-status only. It authorizes via JWT and writes an idempotent in-app notification; no extra notify EFs or email provider.",
} as const;

/** Optional AI after core demo is green. */
export const OPTIONAL_AI_DECISION = {
  buildBeforeCoreDemoGreen: false,
  preferredFirstFunction: "ai-job-match" as const,
  requiresLlmSecretApproval: true,
} as const;

/** Post-demo AI-agent roadmap (do not implement during internship P0). */
export const NEXT_WEEK_AI_AGENT_ROADMAP = [
  {
    week: "+1",
    functionName: "ai-job-match",
    goal: "JWT seeker; rank approved jobs; LLM secret server-side only",
  },
  {
    week: "+2",
    functionName: "ai-resume-assistant",
    goal: "Critique pasted resume/summary text; no client secrets",
  },
  {
    week: "+3",
    functionName: "ai-match-agent",
    goal: "Tool loop over jobs + explanations; rate limits; admin kill switch",
  },
] as const;

/**
 * Supabase Dashboard → Authentication → URL configuration
 * (Site URL + Additional Redirect URLs). Also enable Google under Auth → Providers.
 * Replace the Vercel host with your real deployment hostname.
 */
export const GOOGLE_OAUTH_REDIRECT_URLS = [
  "http://localhost:8080/auth",
  "http://localhost:8081/auth",
  "http://localhost:8082/auth",
  "http://localhost:8083/auth",
  "http://localhost:8084/auth",
  "http://localhost:8085/auth",
  "https://YOUR_VERCEL_PROJECT.vercel.app/auth",
] as const;

/**
 * Supabase Auth → URL Configuration → Additional Redirect URLs
 * for password recovery (`resetPasswordForEmail` → `/reset-password`).
 * App uses `${window.location.origin}/reset-password` so localhost and the
 * deployed HireHub host both work when allowlisted here.
 */
export const PASSWORD_RESET_REDIRECT_URLS = [
  "http://localhost:8080/reset-password",
  "http://localhost:8081/reset-password",
  "http://localhost:8082/reset-password",
  "http://localhost:8083/reset-password",
  "http://localhost:8084/reset-password",
  "http://localhost:8085/reset-password",
  "https://YOUR_VERCEL_PROJECT.vercel.app/reset-password",
] as const;

/**
 * Bootstrap the first admin (Dashboard → SQL Editor) after
 * PROPOSED_0007_bootstrap_admin_role_guard.sql is applied — or with the trigger
 * temporarily disabled if 0007 is not applied yet.
 * Replace the email with your admin account. Signup never creates admins.
 */
export const ADMIN_BOOTSTRAP_SQL = `
-- Prefer applying PROPOSED_0007 first, then:
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'YOUR_ADMIN_EMAIL@example.com';

-- If UPDATE fails with "Only admins can change roles" before 0007:
-- ALTER TABLE public.profiles DISABLE TRIGGER profiles_protect_role;
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'YOUR_ADMIN_EMAIL@example.com';
-- ALTER TABLE public.profiles ENABLE TRIGGER profiles_protect_role;
`.trim();

/**
 * Live demo checklist (manual on Vercel URL — not automated here).
 * Import repo to Vercel; framework tanstack-start (see vercel.json); set VITE_SUPABASE_* env;
 * add Google OAuth redirect URLs from GOOGLE_OAUTH_REDIRECT_URLS and password
 * reset URLs from PASSWORD_RESET_REDIRECT_URLS.
 */
export const LIVE_DEMO_CHECKLIST = [
  "Email/password signup + login on Vercel origin",
  "Google login via supabase.auth.signInWithOAuth on localhost and Vercel",
  "Forgot password email → /reset-password on the same HireHub origin",
  "Seeker / recruiter / admin sidebars and cross-role redirect",
  "Company stays pending until admin approves",
  "Job pending → admin approve → seeker apply",
  "Status tracker + saved jobs",
  "Seeker A cannot read Seeker B applications",
] as const;
