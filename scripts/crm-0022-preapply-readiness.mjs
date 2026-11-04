/**
 * READ-ONLY pre-apply readiness for PROPOSED_0022.
 * SELECT only. Never prints secrets / connection strings / keys.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function projectRefFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    // https://<ref>.supabase.co
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return m ? m[1] : host;
  } catch {
    return null;
  }
}

function errInfo(error) {
  if (!error) return null;
  return { message: error.message, code: error.code ?? null };
}

const env = loadEnv(resolve(process.cwd(), ".env"));
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  env.DATABASE_URL ||
  env.SUPABASE_DB_URL ||
  env.POSTGRES_URL ||
  env.DIRECT_URL ||
  null;

if (!url || !key) {
  console.error("MISSING_ENV: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const expectedRef = "munqgybiuqpncxbgfvdp";
const liveRef = projectRefFromUrl(url);

const report = {
  mode: "SELECT_ONLY_PREAPPLY",
  timestamp: new Date().toISOString(),
  project: {
    config_toml_project_id: expectedRef,
    supabase_temp_project_ref: expectedRef,
    live_url_project_ref: liveRef,
    refs_match: liveRef === expectedRef,
  },
  postgres: null,
  fk_constraints: null,
  proposed_0022_already_present: null,
  table_counts: {},
  ownership_diagnostics: {},
  migration_history: null,
  backup_notes: {
    supabase_managed: true,
    options: [
      "Dashboard → Project Settings → Database → Backups (daily backups; PITR if Pro+)",
      "Before DDL: note current time UTC for point-in-time recovery window",
      "Rollback SQL is in PROPOSED_0022 footer (constraint swap only; not db reset)",
    ],
  },
};

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

for (const table of [
  "crm_contacts",
  "crm_segments",
  "crm_campaigns",
  "crm_campaign_recipients",
  "email_delivery_events",
]) {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
  report.table_counts[table] = error
    ? { ok: false, error: errInfo(error) }
    : { ok: true, count };
}

// Ownership diags via PostgREST loads (same as hardening plan §5)
{
  const { data: campaigns, error } = await admin
    .from("crm_campaigns")
    .select("id, recruiter_id, segment_id");
  if (error) {
    report.ownership_diagnostics.diag1 = { ok: false, error: errInfo(error) };
  } else {
    const rows = campaigns ?? [];
    const withSeg = rows.filter((c) => c.segment_id);
    let mismatch = 0;
    let orphan = 0;
    if (withSeg.length) {
      const ids = [...new Set(withSeg.map((c) => c.segment_id))];
      const { data: segs } = await admin.from("crm_segments").select("id, recruiter_id").in("id", ids);
      const byId = new Map((segs ?? []).map((s) => [s.id, s]));
      for (const c of withSeg) {
        const s = byId.get(c.segment_id);
        if (!s) orphan += 1;
        else if (s.recruiter_id !== c.recruiter_id) mismatch += 1;
      }
    }
    report.ownership_diagnostics.diag1_campaign_foreign_segment = {
      ok: true,
      campaigns_total: rows.length,
      affected_mismatch: mismatch,
      affected_orphan_segment: orphan,
    };
  }
}

{
  const { data: recipients, error } = await admin
    .from("crm_campaign_recipients")
    .select("id, recruiter_id, campaign_id, contact_id");
  if (error) {
    report.ownership_diagnostics.diag2_3 = { ok: false, error: errInfo(error) };
  } else {
    const rows = recipients ?? [];
    let campMismatch = 0;
    let campOrphan = 0;
    let contactMismatch = 0;
    let contactOrphan = 0;
    let inconsistentTriples = 0;
    const dupMap = new Map();
    if (rows.length) {
      const campIds = [...new Set(rows.map((r) => r.campaign_id))];
      const contactIds = [...new Set(rows.map((r) => r.contact_id))];
      const { data: camps } = await admin.from("crm_campaigns").select("id, recruiter_id").in("id", campIds);
      const { data: contacts } = await admin
        .from("crm_contacts")
        .select("id, recruiter_id")
        .in("id", contactIds);
      const campById = new Map((camps ?? []).map((c) => [c.id, c]));
      const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));
      for (const r of rows) {
        const camp = campById.get(r.campaign_id);
        const contact = contactById.get(r.contact_id);
        if (!camp) campOrphan += 1;
        else if (camp.recruiter_id !== r.recruiter_id) campMismatch += 1;
        if (!contact) contactOrphan += 1;
        else if (contact.recruiter_id !== r.recruiter_id) contactMismatch += 1;
        if (
          camp &&
          contact &&
          (r.recruiter_id !== camp.recruiter_id ||
            r.recruiter_id !== contact.recruiter_id ||
            camp.recruiter_id !== contact.recruiter_id)
        ) {
          inconsistentTriples += 1;
        }
        const k = `${r.campaign_id}|${r.contact_id}`;
        dupMap.set(k, (dupMap.get(k) ?? 0) + 1);
      }
    }
    const duplicate_pairs = [...dupMap.values()].filter((n) => n > 1).length;
    report.ownership_diagnostics.diag2_recipient_foreign_campaign = {
      ok: true,
      recipients_total: rows.length,
      affected_mismatch: campMismatch,
      affected_orphan_campaign: campOrphan,
    };
    report.ownership_diagnostics.diag3_recipient_foreign_contact = {
      ok: true,
      recipients_total: rows.length,
      affected_mismatch: contactMismatch,
      affected_orphan_contact: contactOrphan,
    };
    report.ownership_diagnostics.diag4_duplicates_inconsistent = {
      ok: true,
      duplicate_campaign_contact_pairs: duplicate_pairs,
      inconsistent_owner_triples: inconsistentTriples,
    };
  }
}

if (!dbUrl) {
  report.postgres = {
    ok: false,
    reason: "No DATABASE_URL / SUPABASE_DB_URL / POSTGRES_URL / DIRECT_URL in env — cannot SELECT version() or pg_constraint via SQL.",
  };
  report.fk_constraints = { ok: false, reason: "requires direct DB URL" };
  report.migration_history = { ok: false, reason: "requires direct DB URL" };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 15 });
try {
  const verRows = await sql`select current_setting('server_version') as server_version, version() as version_full`;
  const serverVersion = verRows[0]?.server_version ?? null;
  const major = serverVersion ? Number.parseInt(String(serverVersion).split(".")[0], 10) : null;
  report.postgres = {
    ok: true,
    server_version: serverVersion,
    major,
    compatible_with_set_null_column_list: major != null && major >= 15,
    version_full: verRows[0]?.version_full ?? null,
  };

  const fks = await sql`
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      con.conname AS constraint_name,
      pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
      AND c.relname IN ('crm_campaigns', 'crm_campaign_recipients')
    ORDER BY c.relname, con.conname
  `;
  const wanted = {
    crm_campaigns_segment_id_fkey: false,
    crm_campaign_recipients_campaign_id_fkey: false,
    crm_campaign_recipients_contact_id_fkey: false,
  };
  for (const row of fks) {
    if (row.constraint_name in wanted) wanted[row.constraint_name] = true;
  }
  report.fk_constraints = {
    ok: true,
    live_foreign_keys: fks,
    expected_single_column_fks_present: wanted,
    all_expected_drop_targets_present: Object.values(wanted).every(Boolean),
  };

  const named = await sql`
    SELECT conname
    FROM pg_constraint
    WHERE conname = ANY(${[
      "crm_segments_id_recruiter_unique",
      "crm_campaigns_id_recruiter_unique",
      "crm_contacts_id_recruiter_unique",
      "crm_campaigns_segment_same_recruiter_fkey",
      "crm_recipients_campaign_same_recruiter_fkey",
      "crm_recipients_contact_same_recruiter_fkey",
    ]})
    ORDER BY conname
  `;
  report.proposed_0022_already_present = {
    ok: true,
    existing_named_constraints: named.map((r) => r.conname),
    already_applied: named.length > 0,
  };

  // Migration history tables vary; probe common locations without writing.
  const history = { ok: true, sources: {} };
  try {
    const rows = await sql`
      SELECT version, name, inserted_at
      FROM supabase_migrations.schema_migrations
      ORDER BY version DESC
      LIMIT 30
    `;
    history.sources.supabase_migrations_schema_migrations = rows;
  } catch (e) {
    history.sources.supabase_migrations_schema_migrations = {
      error: e instanceof Error ? e.message : String(e),
    };
  }
  try {
    const rows = await sql`
      SELECT version
      FROM public.supabase_migrations
      ORDER BY version DESC
      LIMIT 30
    `;
    history.sources.public_supabase_migrations = rows;
  } catch (e) {
    history.sources.public_supabase_migrations = {
      error: e instanceof Error ? e.message : String(e),
    };
  }
  try {
    const rows = await sql`
      SELECT id, hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
      LIMIT 20
    `;
    history.sources.drizzle___drizzle_migrations = rows;
  } catch (e) {
    history.sources.drizzle___drizzle_migrations = {
      error: e instanceof Error ? e.message : String(e),
    };
  }
  report.migration_history = history;
} finally {
  await sql.end({ timeout: 5 });
}

console.log(JSON.stringify(report, null, 2));
