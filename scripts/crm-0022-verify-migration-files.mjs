/**
 * Static verification of PROPOSED_0022 drizzle + CLI mirror (no DB, no DDL).
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const drizzle = readFileSync(
  resolve("drizzle/migrations/PROPOSED_0022_crm_ownership_integrity.sql"),
  "utf8",
);
const mirror = readFileSync(
  resolve("supabase/migrations/20261102140000_proposed_0022_crm_ownership_integrity.sql"),
  "utf8",
);

function comments(sql) {
  return [...sql.matchAll(/COMMENT ON CONSTRAINT [\s\S]*?;/g)].map((m) =>
    m[0].replace(/\s+/g, " ").trim(),
  );
}

function existenceChecks(sql) {
  return [
    ...sql.matchAll(
      /WHERE conname = '([^']+)'\s+AND conrelid = '(public\.[a-z_]+)'::regclass/g,
    ),
  ].map((m) => ({ conname: m[1], table: m[2] }));
}

function bareConnameOnlyChecks(sql) {
  // Flags WHERE conname = 'x' not followed by AND conrelid in the same predicate
  const blocks = [...sql.matchAll(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint\s+WHERE([\s\S]*?)\)\s*THEN/g)];
  return blocks
    .map((m) => m[1].replace(/\s+/g, " ").trim())
    .filter((pred) => !pred.includes("conrelid"));
}

const expected = [
  { conname: "crm_segments_id_recruiter_unique", table: "public.crm_segments" },
  { conname: "crm_campaigns_id_recruiter_unique", table: "public.crm_campaigns" },
  { conname: "crm_contacts_id_recruiter_unique", table: "public.crm_contacts" },
  { conname: "crm_campaigns_segment_same_recruiter_fkey", table: "public.crm_campaigns" },
  { conname: "crm_recipients_campaign_same_recruiter_fkey", table: "public.crm_campaign_recipients" },
  { conname: "crm_recipients_contact_same_recruiter_fkey", table: "public.crm_campaign_recipients" },
];

const drizzleComments = comments(drizzle);
const mirrorComments = comments(mirror);
const drizzleChecks = existenceChecks(drizzle);
const mirrorChecks = existenceChecks(mirror);

const rollback = drizzle.split(/-- Rollback \(DO NOT RUN/)[1] ?? "";
const rollbackOk =
  rollback.includes("DROP CONSTRAINT IF EXISTS crm_recipients_contact_same_recruiter_fkey") &&
  rollback.includes("DROP CONSTRAINT IF EXISTS crm_recipients_campaign_same_recruiter_fkey") &&
  rollback.includes("DROP CONSTRAINT IF EXISTS crm_campaigns_segment_same_recruiter_fkey") &&
  rollback.includes("ADD CONSTRAINT crm_campaigns_segment_id_fkey") &&
  /ON DELETE SET NULL;/.test(rollback) &&
  !rollback.includes("ON DELETE SET NULL (segment_id)") && // single-column restore uses bare SET NULL
  rollback.includes("crm_campaign_recipients_campaign_id_fkey") &&
  rollback.includes("crm_campaign_recipients_contact_id_fkey") &&
  rollback.includes("DROP CONSTRAINT IF EXISTS crm_contacts_id_recruiter_unique") &&
  rollback.includes("DROP CONSTRAINT IF EXISTS crm_campaigns_id_recruiter_unique") &&
  rollback.includes("DROP CONSTRAINT IF EXISTS crm_segments_id_recruiter_unique") &&
  rollback.includes("BEGIN;") &&
  rollback.includes("COMMIT;");

const report = {
  comments_exact_match: JSON.stringify(drizzleComments) === JSON.stringify(mirrorComments),
  drizzle_comments: drizzleComments,
  mirror_comments: mirrorComments,
  drizzle_checks: drizzleChecks,
  mirror_checks: mirrorChecks,
  checks_match_expected:
    JSON.stringify(drizzleChecks) === JSON.stringify(expected) &&
    JSON.stringify(mirrorChecks) === JSON.stringify(expected),
  bare_conname_only_checks: {
    drizzle: bareConnameOnlyChecks(drizzle),
    mirror: bareConnameOnlyChecks(mirror),
  },
  set_null_column_list_both:
    drizzle.includes("ON DELETE SET NULL (segment_id)") &&
    mirror.includes("ON DELETE SET NULL (segment_id)"),
  transactional: {
    // Body itself is not wrapped; apply must use explicit BEGIN/COMMIT (documented).
    file_body_wrapped_in_begin_commit: false,
    apply_note_requires_explicit_txn:
      drizzle.includes("autocommit is unsafe") && drizzle.includes("BEGIN;"),
    ddl_compatible_with_explicit_txn: true,
    no_concurrent_ops: !/CONCURRENTLY/i.test(drizzle),
  },
  rollback_sql_correct: rollbackOk,
};

const ok =
  report.comments_exact_match &&
  report.checks_match_expected &&
  report.bare_conname_only_checks.drizzle.length === 0 &&
  report.bare_conname_only_checks.mirror.length === 0 &&
  report.set_null_column_list_both &&
  report.rollback_sql_correct &&
  report.transactional.apply_note_requires_explicit_txn &&
  report.transactional.ddl_compatible_with_explicit_txn &&
  report.transactional.no_concurrent_ops;

console.log(JSON.stringify({ ok, ...report }, null, 2));
process.exit(ok ? 0 : 1);
