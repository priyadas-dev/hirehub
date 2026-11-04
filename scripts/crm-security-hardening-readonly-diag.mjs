/**
 * READ-ONLY CRM hardening diagnostics (SELECT via PostgREST only).
 * Never prints secrets. No INSERT/UPDATE/DELETE/DDL.
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

function errInfo(error) {
  if (!error) return null;
  return { message: error.message, code: error.code ?? null };
}

const env = loadEnv(resolve(process.cwd(), ".env"));
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("MISSING_ENV: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const report = {
  mode: "SELECT_ONLY",
  timestamp: new Date().toISOString(),
  table_counts: {},
  diagnostics: [],
  constraint_catalog: null,
};

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

// --- Diag 1: campaigns → foreign segments ---
{
  const name = "diag1_campaign_foreign_segment";
  const sql = `SELECT c.id AS campaign_id, c.recruiter_id AS campaign_recruiter,
  c.segment_id, s.recruiter_id AS segment_recruiter
FROM public.crm_campaigns c
JOIN public.crm_segments s ON s.id = c.segment_id
WHERE c.segment_id IS NOT NULL
  AND c.recruiter_id IS DISTINCT FROM s.recruiter_id`;
  const { data, error } = await admin.from("crm_campaigns").select("id, recruiter_id, segment_id");
  if (error) {
    report.diagnostics.push({ name, sql, ok: false, error: errInfo(error) });
  } else {
    const campaigns = data ?? [];
    const withSeg = campaigns.filter((c) => c.segment_id);
    const segIds = [...new Set(withSeg.map((c) => c.segment_id))];
    let segments = [];
    if (segIds.length) {
      const sres = await admin.from("crm_segments").select("id, recruiter_id").in("id", segIds);
      if (sres.error) {
        report.diagnostics.push({ name, sql, ok: false, error: errInfo(sres.error) });
      } else {
        segments = sres.data ?? [];
      }
    }
    if (!report.diagnostics.find((d) => d.name === name)) {
      const byId = new Map(segments.map((s) => [s.id, s]));
      const mismatch = [];
      const orphanSegment = [];
      for (const c of withSeg) {
        const s = byId.get(c.segment_id);
        if (!s) orphanSegment.push({ campaign_id: c.id, segment_id: c.segment_id });
        else if (c.recruiter_id !== s.recruiter_id) {
          mismatch.push({
            campaign_id: c.id,
            campaign_recruiter: c.recruiter_id,
            segment_id: c.segment_id,
            segment_recruiter: s.recruiter_id,
          });
        }
      }
      report.diagnostics.push({
        name,
        sql,
        ok: true,
        campaigns_total: campaigns.length,
        campaigns_with_segment: withSeg.length,
        affected_mismatch: mismatch.length,
        affected_orphan_segment: orphanSegment.length,
        sample_mismatch: mismatch.slice(0, 10),
        sample_orphan_segment: orphanSegment.slice(0, 10),
      });
    }
  }
}

// --- Diag 2 & 3 & 4: recipients ---
{
  const { data, error } = await admin
    .from("crm_campaign_recipients")
    .select("id, recruiter_id, campaign_id, contact_id");
  if (error) {
    report.diagnostics.push({
      name: "diag2_3_4_recipients_load",
      ok: false,
      error: errInfo(error),
    });
  } else {
    const rows = data ?? [];
    const campIds = [...new Set(rows.map((r) => r.campaign_id))];
    const contactIds = [...new Set(rows.map((r) => r.contact_id))];

    let camps = [];
    let contacts = [];
    if (campIds.length) {
      const cres = await admin.from("crm_campaigns").select("id, recruiter_id").in("id", campIds);
      if (cres.error) {
        report.diagnostics.push({
          name: "diag2_campaigns_load",
          ok: false,
          error: errInfo(cres.error),
        });
      } else camps = cres.data ?? [];
    }
    if (contactIds.length) {
      const tres = await admin.from("crm_contacts").select("id, recruiter_id").in("id", contactIds);
      if (tres.error) {
        report.diagnostics.push({
          name: "diag3_contacts_load",
          ok: false,
          error: errInfo(tres.error),
        });
      } else contacts = tres.data ?? [];
    }

    const byCamp = new Map(camps.map((c) => [c.id, c]));
    const byContact = new Map(contacts.map((c) => [c.id, c]));

    const sql2 = `SELECT r.id, r.recruiter_id AS row_recruiter,
  r.campaign_id, camp.recruiter_id AS campaign_recruiter
FROM public.crm_campaign_recipients r
JOIN public.crm_campaigns camp ON camp.id = r.campaign_id
WHERE r.recruiter_id IS DISTINCT FROM camp.recruiter_id`;

    const badCamp = [];
    const orphanCamp = [];
    for (const r of rows) {
      const c = byCamp.get(r.campaign_id);
      if (!c) orphanCamp.push({ recipient_id: r.id, campaign_id: r.campaign_id });
      else if (r.recruiter_id !== c.recruiter_id) {
        badCamp.push({
          recipient_id: r.id,
          row_recruiter: r.recruiter_id,
          campaign_id: r.campaign_id,
          campaign_recruiter: c.recruiter_id,
        });
      }
    }
    report.diagnostics.push({
      name: "diag2_recipient_foreign_campaign",
      sql: sql2,
      ok: true,
      recipients_total: rows.length,
      affected_mismatch: badCamp.length,
      affected_orphan_campaign: orphanCamp.length,
      sample_mismatch: badCamp.slice(0, 10),
      sample_orphan_campaign: orphanCamp.slice(0, 10),
    });

    const sql3 = `SELECT r.id, r.recruiter_id AS row_recruiter,
  r.contact_id, ct.recruiter_id AS contact_recruiter
FROM public.crm_campaign_recipients r
JOIN public.crm_contacts ct ON ct.id = r.contact_id
WHERE r.recruiter_id IS DISTINCT FROM ct.recruiter_id`;

    const badContact = [];
    const orphanContact = [];
    for (const r of rows) {
      const ct = byContact.get(r.contact_id);
      if (!ct) orphanContact.push({ recipient_id: r.id, contact_id: r.contact_id });
      else if (r.recruiter_id !== ct.recruiter_id) {
        badContact.push({
          recipient_id: r.id,
          row_recruiter: r.recruiter_id,
          contact_id: r.contact_id,
          contact_recruiter: ct.recruiter_id,
        });
      }
    }
    report.diagnostics.push({
      name: "diag3_recipient_foreign_contact",
      sql: sql3,
      ok: true,
      recipients_total: rows.length,
      affected_mismatch: badContact.length,
      affected_orphan_contact: orphanContact.length,
      sample_mismatch: badContact.slice(0, 10),
      sample_orphan_contact: orphanContact.slice(0, 10),
    });

    const pairMap = new Map();
    const dups = [];
    for (const r of rows) {
      const k = `${r.campaign_id}|${r.contact_id}`;
      if (pairMap.has(k)) {
        dups.push({
          campaign_id: r.campaign_id,
          contact_id: r.contact_id,
          recipient_ids: [pairMap.get(k), r.id],
        });
      } else pairMap.set(k, r.id);
    }

    const inconsistentTriple = [];
    for (const r of rows) {
      const camp = byCamp.get(r.campaign_id);
      const ct = byContact.get(r.contact_id);
      if (camp && ct) {
        if (
          camp.recruiter_id !== ct.recruiter_id ||
          r.recruiter_id !== camp.recruiter_id ||
          r.recruiter_id !== ct.recruiter_id
        ) {
          inconsistentTriple.push({
            recipient_id: r.id,
            row_recruiter: r.recruiter_id,
            campaign_recruiter: camp.recruiter_id,
            contact_recruiter: ct.recruiter_id,
          });
        }
      }
    }

    report.diagnostics.push({
      name: "diag4_duplicates_and_inconsistent_relationships",
      sql_notes: [
        "duplicate pairs: repeated (campaign_id, contact_id) among loaded recipients",
        "inconsistent triples: row/campaign/contact recruiter_id not all equal",
      ],
      ok: true,
      recipients_total: rows.length,
      duplicate_campaign_contact_pairs: dups.length,
      sample_duplicates: dups.slice(0, 10),
      inconsistent_owner_triples: inconsistentTriple.length,
      sample_inconsistent_triples: inconsistentTriple.slice(0, 10),
    });
  }
}

// --- Diag 5: unique constraints via optional direct Postgres URL (SELECT only) ---
const dbUrl =
  env.DATABASE_URL ||
  env.SUPABASE_DB_URL ||
  env.POSTGRES_URL ||
  env.DIRECT_URL ||
  "";

if (dbUrl) {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const rows = await sql`
      SELECT
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name IN ('crm_contacts', 'crm_segments', 'crm_campaigns', 'crm_campaign_recipients')
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
      GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
      ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name
    `;
    const needed = {
      "crm_segments (id,recruiter_id) UNIQUE or PK+unique": false,
      "crm_campaigns (id,recruiter_id) UNIQUE or PK+unique": false,
      "crm_contacts (id,recruiter_id) UNIQUE or PK+unique": false,
    };
    for (const r of rows) {
      const cols = String(r.columns)
        .split(",")
        .map((c) => c.trim());
      const key = `${r.table_name}|${cols.join(",")}`;
      if (
        (r.constraint_type === "UNIQUE" || r.constraint_type === "PRIMARY KEY") &&
        cols.includes("id") &&
        cols.includes("recruiter_id") &&
        cols.length === 2
      ) {
        if (r.table_name === "crm_segments") needed["crm_segments (id,recruiter_id) UNIQUE or PK+unique"] = true;
        if (r.table_name === "crm_campaigns") needed["crm_campaigns (id,recruiter_id) UNIQUE or PK+unique"] = true;
        if (r.table_name === "crm_contacts") needed["crm_contacts (id,recruiter_id) UNIQUE or PK+unique"] = true;
      }
      void key;
    }
    // PK on id alone does NOT satisfy UNIQUE(id, recruiter_id) for composite FK reference in PostgreSQL
    // — referenced columns of a composite FK must match a unique constraint on exactly those columns.
    report.constraint_catalog = {
      ok: true,
      source: "information_schema via DATABASE_URL/DIRECT_URL (SELECT)",
      constraints: rows,
      composite_unique_id_recruiter_present: needed,
      note: "PRIMARY KEY (id) alone is NOT a UNIQUE (id, recruiter_id). Composite FKs require adding UNIQUE (id, recruiter_id).",
    };
  } catch (e) {
    report.constraint_catalog = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
} else {
  // Fallback: OpenAPI does not expose constraint catalog; state from PROPOSED_0021 + PK presence via select.
  report.constraint_catalog = {
    ok: true,
    source: "inferred_from_PROPOSED_0021_and_live_table_access (no DATABASE_URL in env)",
    live_tables_selectable: true,
    expected_from_0021: {
      crm_contacts_pk_id: true,
      crm_segments_pk_id: true,
      crm_campaigns_pk_id: true,
      crm_campaign_recipients_unique_campaign_id_contact_id: true,
      composite_unique_id_recruiter_id_on_parents: false,
      composite_fk_segment_recruiter: false,
      composite_fk_recipient_campaign_recruiter: false,
      composite_fk_recipient_contact_recruiter: false,
    },
    compatibility_for_proposed_composite_fks:
      "BLOCKED until UNIQUE (id, recruiter_id) is added on crm_segments, crm_campaigns, crm_contacts (part of proposed PROPOSED_0022, not present in 0021).",
  };
}

console.log(JSON.stringify(report, null, 2));
