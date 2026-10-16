# HireHub AI Job Assistant (Track 3)

Seeker-only assistant at `/seeker/assistant`. It answers questions about skills, experience, and career direction using:

1. **Corpus RAG** — synthetic `job_corpus` documents (practice context only)
2. **Live approved jobs** — genuine HireHub `jobs` with `status = approved` via the signed-in user’s JWT (RLS)

Synthetic corpus rows are **never** recommended as real openings.

## Server-only secrets (never `VITE_`)

Set these in local `.env` and in your host’s secret store (Vercel/Lovable). **Do not commit real values.**

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Gemini embeddings + assistant text generation |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Browser/user JWT client (existing) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only corpus RAG (`match_job_corpus`) |

Never put service-role or Gemini keys in `VITE_*` variables or client bundles.

## Database setup (manual)

Do **not** auto-apply migrations from the app.

1. Review and apply `drizzle/migrations/PROPOSED_0009_ai_foundation.sql`
2. Review and apply `drizzle/migrations/PROPOSED_0010_rag_corpus.sql`
3. Seed corpus (job_corpus only): `npm run rag:seed`
4. Embed pending rows: `npm run rag:embed` (or `--provider=local` — see below)

Until this is done, the assistant still loads for seekers but corpus RAG shows as unavailable and answers may fall back to approved live jobs / insufficient-context messaging.

## Embedding providers (same space for embed + retrieve)

| Provider | Env / flag | Notes |
|----------|------------|--------|
| `gemini` (default) | `EMBEDDING_PROVIDER=gemini` + `GEMINI_API_KEY` | `gemini-embedding-001` @ 768 dims. Free tier ≈ 1k embeds/day. |
| `local` | `EMBEDDING_PROVIDER=local` | Free `Xenova/all-mpnet-base-v2` @ 768 dims on CPU (WASM ONNX). No Gemini embed quota. First run downloads the model once (~100MB). |

**Critical:** Corpus bulk embed and seeker query retrieve must use the **same** provider. Do not mix Gemini and local vectors in `job_corpus`. To switch:

```sh
npm run rag:reset-embeddings -- --yes
npm run rag:embed -- --provider=local --limit=5000 --batch-size=32
# Also set EMBEDDING_PROVIDER=local in `.env` (and restart `npm run dev`)
```

Track docs still describe Gemini as the primary cloud path; local is the free same-day option when quota is exhausted.

## How RAG works

1. Seeker submits a question from `/seeker/assistant`.
2. Server verifies JWT (`requireSupabaseAuth`) and `profiles.role` = job seeker.
3. Server embeds the question with the configured provider (`gemini-embedding-001` or local Xenova, both 768-dim) and calls `match_job_corpus` with the **service role**.
4. Server loads approved live jobs with the **user JWT** (never invents vacancies).
5. Server asks Gemini (`gemini-2.0-flash`) to answer only from that grounded context.
6. UI labels corpus citations as synthetic and live citations as real approved jobs.

## How to test

```sh
# Unit tests (no network / no DB required)
npx vitest run src/test/job-assistant.test.ts
npm test

# Manual UI (after env + optional migrations)
npm run dev
# Sign in as a job seeker → Sidebar → AI Job Assistant
```

Classifier / corpus eval (offline, Track 1–2):

```sh
npm run rag:seed:dry
npm run rag:classify
```

Free local embed of the full corpus (when Gemini free-tier RPD is exhausted):

```sh
npm run rag:reset-embeddings -- --yes
npm run rag:embed -- --provider=local --limit=5000 --batch-size=32
# Set EMBEDDING_PROVIDER=local in .env so /seeker/assistant query embed matches
```

## Security notes

- Route sits under `/_app/seeker` (role guard). Recruiters/admins are redirected away.
- Server handler rejects non-seeker profiles even if the URL were forced.
- Service-role client is imported only inside the server handler for corpus RPC.
- No inserts into `public.jobs`.
