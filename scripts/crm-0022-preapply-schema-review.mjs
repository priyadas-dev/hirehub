/**
 * READ-ONLY: schema_migrations shape + PROPOSED_0022 static atomicity/review checks.
 * No DDL. Never prints secrets.
 */
import { createHash } from "crypto";
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

function extractExec(sql) {
  const body = sql.split(/-- -+\s*\n-- Rollback/)[0] ?? sql;
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("--"))
    .join("\n");
}

const drizzlePath = "drizzle/migrations/PROPOSED_0022_crm_ownership_integrity.sql";
const mirrorPath = "supabase/migrations/20261102140000_proposed_0022_crm_ownership_integrity.sql";
const drizzle = readFileSync(resolve(drizzlePath), "utf8");
const mirror = readFileSync(resolve(mirrorPath), "utf8");
const drizzleExec = extractExec(drizzle);
const mirrorExec = extractExec(mirror);
const drizzleBody = drizzle.split(/-- -+\s*\n-- Rollback/)[0] ?? drizzle;

const connameChecks = [...drizzle.matchAll(/FROM pg_constraint\s+WHERE conname = '([^']+)'/g)].map(
  (m) => m[1],
);
const tableScopedChecks = [...drizzle.matchAll(/conrelid\s*=/gi)];

const report = {
  mode: "SELECT_ONLY_STATIC_AND_OPTIONAL_SQL",
  timestamp: new Date().toISOString(),
  file_compare: {
    drizzle_path: drizzlePath,
    mirror_path: mirrorPath,
    drizzle_sha256_12: createHash("sha256").update(drizzle).digest("hex").slice(0, 12),
    mirror_sha256_12: createHash("sha256").update(mirror).digest("hex").slice(0, 12),
    executable_bodies_equal: drizzleExec === mirrorExec,
    has_set_null_segment_id_only: {
      drizzle: drizzle.includes("ON DELETE SET NULL (segment_id)"),
      mirror: mirror.includes("ON DELETE SET NULL (segment_id)"),
    },
    bare_set_null: {
      drizzle: /ON DELETE SET NULL\s*;/.test(drizzle),
      mirror: /ON DELETE SET NULL\s*;/.test(mirror),
    },
  },
  transaction_atomicity: {
    explicit_begin_commit_in_file: {
      begin: /^\s*BEGIN\s*;/im.test(drizzleBody) || /\nBEGIN\s*;/i.test(drizzleBody),
      commit: /\bCOMMIT\s*;/i.test(drizzleBody),
    },
    postgres_ddl_is_transactional_when_wrapped: true,
    concurrent_index_or_nontransactional_ops: false,
    risk_without_explicit_transaction:
      "SQL Editor / psql default is autocommit per statement. UNIQUEs + DROP old FKs can commit before a later ADD composite FK fails, leaving campaigns/recipients without the replaced FKs.",
    required_wrapper: "BEGIN; <full 0022 body>; COMMIT;",
    rollback_on_error_inside_explicit_txn: "Yes — entire DDL including dropped FKs rolls back on failure/ROLLBACK.",
  },
  constraint_existence_checks: {
    connames: connameChecks,
    scoped_via_conrelid_or_table: tableScopedChecks.length > 0,
    assessment:
      "Checks are by global constraint name only (conname). Names are CRM-specific and unique in practice, but not explicitly scoped to the target table. Safer form joins pg_class/pg_namespace or uses conrelid = 'public.<table>'::regclass.",
  },
  drop_targets: [
    "crm_campaigns_segment_id_fkey",
    "crm_campaign_recipients_campaign_id_fkey",
    "crm_campaign_recipients_contact_id_fkey",
  ],
  schema_migrations: null,
};

if (drizzleExec !== mirrorExec) {
  const da = drizzleExec.split("\n");
  const ma = mirrorExec.split("\n");
  for (let i = 0; i < Math.max(da.length, ma.length); i++) {
    if (da[i] !== ma[i]) {
      report.file_compare.first_diff = { line: i + 1, drizzle: da[i] ?? null, mirror: ma[i] ?? null };
      break;
    }
  }
}

const env = loadEnv(resolve(process.cwd(), ".env"));
const dbUrl =
  env.DATABASE_URL || env.SUPABASE_DB_URL || env.POSTGRES_URL || env.DIRECT_URL || null;

if (!dbUrl) {
  report.schema_migrations = {
    ok: false,
    reason: "No direct DB URL in env — cannot introspect live columns. Inferring from repo register scripts.",
    inferred_from_repo: {
      source: "scripts/_register_migration_history.sql",
      columns_used: ["version", "name", "statements", "created_by", "idempotency_key", "rollback"],
      note: "inserted_at is NOT used in repo scripts — matches your failed query.",
    },
    correct_readonly_query_candidates: [
      `SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'supabase_migrations'
  AND table_name = 'schema_migrations'
ORDER BY ordinal_position;`,
      `SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 30;`,
    ],
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 15 });
try {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations'
      AND table_name = 'schema_migrations'
    ORDER BY ordinal_position
  `;
  let sample = null;
  let sampleError = null;
  try {
    const rows = await sql`
      SELECT *
      FROM supabase_migrations.schema_migrations
      ORDER BY version DESC
      LIMIT 5
    `;
    sample = {
      row_keys: rows[0] ? Object.keys(rows[0]) : [],
      latest: rows.map((r) => ({
        version: r.version,
        name: r.name ?? null,
      })),
    };
  } catch (e) {
    sampleError = e instanceof Error ? e.message : String(e);
  }
  report.schema_migrations = {
    ok: true,
    columns: cols,
    sample,
    sampleError,
    correct_readonly_query: cols.some((c) => c.column_name === "name")
      ? "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 30;"
      : "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 30;",
    has_inserted_at: cols.some((c) => c.column_name === "inserted_at"),
  };
} catch (e) {
  report.schema_migrations = {
    ok: false,
    error: e instanceof Error ? e.message : String(e),
  };
} finally {
  await sql.end({ timeout: 5 });
}

console.log(JSON.stringify(report, null, 2));
