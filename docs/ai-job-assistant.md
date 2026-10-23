# HireHub AI Job Assistant (Track 3)

Assessment verification checklist (manual demos, automations, metrics): [`assessment-2-verification.md`](./assessment-2-verification.md).

Deploy / proposed migrations: [`deploy-assessment-2.md`](./deploy-assessment-2.md).

Project overview and measured results: root [`README.md`](../README.md).

Seeker-only assistant at `/seeker/assistant`. It answers questions about skills, experience, and career direction using:

1. **Corpus RAG** — synthetic `job_corpus` documents (practice context only)
2. **Live approved jobs** — genuine HireHub `jobs` with `status = approved` via the signed-in user’s JWT (RLS)

Synthetic corpus rows are **never** recommended as real openings.

## Server-only secrets (never `VITE_`)

Set these in local `.env` and in your host’s secret store (Vercel/Lovable). **Do not commit real values.**

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Assistant **text** generation (`gemini-3.8-flash`). Also used when `EMBEDDING_PROVIDER=gemini` for embeddings. |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Browser/user JWT client (existing) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only corpus RAG RPCs |
| `EMBEDDING_PROVIDER` | `gemini` \| `local` \| `gte` (must match embed CLI + query retrieve) |

Never put service-role or Gemini keys in `VITE_*` variables or client bundles.

## Database setup (manual)

Do **not** auto-apply migrations from the app.

1. Review and apply `drizzle/migrations/PROPOSED_0009_ai_foundation.sql`
2. Review and apply `drizzle/migrations/PROPOSED_0010_rag_corpus.sql`
3. (Recommended for free local RAG) Review and apply `drizzle/migrations/PROPOSED_0011_gte_small_embeddings.sql`
4. Seed corpus if needed (`job_corpus` only): `npm run rag:seed`
5. Embed with the chosen provider (see below)

Until this is done, the assistant still loads for seekers but corpus RAG shows as unavailable and answers may fall back to approved live jobs / insufficient-context messaging.

## Embedding providers (same space for embed + retrieve)

| Provider | Env / flag | Storage | RPC | Notes |
|----------|------------|---------|-----|--------|
| `gemini` (default) | `EMBEDDING_PROVIDER=gemini` + `GEMINI_API_KEY` | `embedding` vector(768) | `match_job_corpus` | Cloud; quota-limited. |
| `local` | `EMBEDDING_PROVIDER=local` | `embedding` vector(768) | `match_job_corpus` | `Xenova/all-mpnet-base-v2` @ 768. Do not mix with Gemini in this column without reset. |
| `gte` | `EMBEDDING_PROVIDER=gte` | `embedding_gte` vector(384) | `match_job_corpus_gte` | `Xenova/gte-small` @ 384. **Never** writes `embedding`. Requires PROPOSED_0011. |

**Critical:** Never mix models in one column. Never pad/truncate 384↔768. `gte` is isolated from the 768 path so existing 768 vectors stay untouched.

### Recommended: switch assistant RAG to gte-small (384)

After PROPOSED_0011 is applied (manual SQL Editor):

```sh
# Small smoke (safe default limit=200)
npm run rag:embed -- --provider=gte --limit=200 --batch-size=16

# Full 5,000 corpus (explicit confirm required when limit>200)
npm run rag:embed -- --provider=gte --limit=5000 --confirm-gte-bulk --batch-size=16

# Set app retrieve to the same space, keep Gemini for answers
# EMBEDDING_PROVIDER=gte
# GEMINI_API_KEY=...   (still required for gemini-3.8-flash answers)

npm run rag:eval -- --provider=gte
npm run dev
```

Verify in Supabase (SQL Editor):

```sql
SELECT
  count(*) AS total,
  count(embedding) AS has_768,
  count(embedding_gte) AS has_gte
FROM public.job_corpus
WHERE job_id IS NULL;
```

### Rollback to 768 path (no data deletion)

1. Set `EMBEDDING_PROVIDER=gemini` or `local` (matching whatever filled `embedding`).
2. Restart the app.
3. Leave `embedding_gte` in place for later comparison; optional cleanup is a separate approved migration.

`npm run rag:reset-embeddings` clears **`embedding` only** (768). It does not clear `embedding_gte`.

## How RAG works

1. Seeker submits a question from `/seeker/assistant`.
2. Server verifies JWT (`requireSupabaseAuth`) and `profiles.role` = job seeker.
3. Server embeds the question with `EMBEDDING_PROVIDER` and calls the matching RPC (`match_job_corpus` or `match_job_corpus_gte`) with the **service role**.
4. Server loads approved live jobs with the **user JWT** (never invents vacancies).
5. Server asks Gemini (`gemini-3.8-flash`) to answer only from that grounded context.
6. UI labels corpus citations as synthetic and live citations as real approved jobs.

## How to test

```sh
# Unit tests (no network / no DB required)
npx vitest run src/test/job-assistant.test.ts src/test/embed-provider.test.ts src/test/corpus-rag.test.ts src/test/gte-embed.test.ts
npm test
npm run build

# Manual UI (after env + migrations)
npm run dev
# Sign in as a job seeker → Sidebar → AI Job Assistant
```

Classifier / corpus eval (does **not** reseed or overwrite embeddings):

```sh
npm run rag:seed:dry
npm run rag:classify
npm run rag:eval -- --provider=gte
# → scripts/rag/out/eval-report.json
# → scripts/rag/out/clean-vs-noisy.md  (with vs without noise)
```

## Security notes

- Route sits under `/_app/seeker` (role guard). Recruiters/admins are redirected away.
- Server handler rejects non-seeker profiles even if the URL were forced.
- Service-role client is imported only inside the server handler for corpus RPC.
- `job_corpus` remains deny-by-default for `anon` / `authenticated`; RPCs are `service_role` execute only.
- No inserts into `public.jobs`.
- PROPOSED_0011 must not change existing RLS policies beyond re-asserting the same revokes/grants.
