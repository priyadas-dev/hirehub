# Interview RSVP sync — Phase D1/D2 runbook

**Status:** D1 core + D2 Edge wired (polling / server-delegate).  
**Not done here:** D3 secrets paste, D4 live Google accept/decline smoke, D5 UI refetch.  
**Architecture:** Edge cron → `HIREHUB_APP_URL/api/cron/sync-interview-rsvp` → D1 `runInterviewRsvpSyncBatch` + existing `getInterviewEvent`. **No `events.watch`.**

---

## What this does

| | |
|--|--|
| Selects | `status = 'scheduled'` AND `invited_at IS NOT NULL` AND `google_event_id` present (batch ≤ 50, default 25), order `last_synced_at ASC NULLS FIRST` |
| Reads | Google Calendar event via **same** `getInterviewEvent` as outbound |
| Writes | Service-role only: RSVP responses, optional `html_link`/`etag`, `last_synced_at`; Google `cancelled` → HireHub `cancelled` |
| Skips forever | `cancelled` / `pending` / `failed` rows (not in selection) |
| Unchanged RSVP | Still bumps `last_synced_at` (queue rotation) |
| Soft errors (429 / unavailable) | Count as `errors`; **no** response/status mutation; **no** `last_synced_at` bump |
| Auth failure | Batch `ok: false` + stable `code` (`google_auth_revoked` / `google_not_configured` / …) — not a silent success |

---

## Secret NAMES (no values — you set in D3)

### Edge Function `sync-interview-rsvp`

| Name | Purpose |
|------|---------|
| `CRON_SECRET` | Shared cron header (≥16 chars); must match app |
| `HIREHUB_APP_URL` | Public app origin, **no trailing slash** (e.g. `https://hirehub.example.com`) |

Also available automatically on Supabase Edge: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (not required for delegate path).

### App host (Vercel / local server — already used for outbound Calendar)

| Name | Purpose |
|------|---------|
| `CRON_SECRET` | Same value as Edge |
| `GOOGLE_CLIENT_ID` | Calendar OAuth client |
| `GOOGLE_CLIENT_SECRET` | Calendar OAuth secret |
| `GOOGLE_REFRESH_TOKEN` | Organizer refresh token |
| `GOOGLE_CALENDAR_ID` | Optional; defaults to `primary` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Service-role writes |

**Never** put `GOOGLE_*` or service-role behind `VITE_`. **Never** commit values. Agent does not edit `.env`.

> Why Google secrets stay on the **app**, not Edge: one Calendar codepath (`getInterviewEvent`) — avoids forking RSVP rules in Deno.

---

## Deploy / schedule (after D3)

```bash
npx supabase functions deploy sync-interview-rsvp --project-ref <your-ref>
```

Dashboard → Edge Functions → `sync-interview-rsvp` → Schedules:

- Method: **POST**
- Cron: every **5–15** minutes (e.g. `*/10 * * * *`)
- Header: `x-hirehub-cron-secret: <CRON_SECRET>`
- Body: `{}`

### Manual smoke (counts only — no tokens in output)

```bash
curl -sS -X POST \
  "$SUPABASE_URL/functions/v1/sync-interview-rsvp" \
  -H "Content-Type: application/json" \
  -H "x-hirehub-cron-secret: $CRON_SECRET" \
  -d '{}'
```

Expected shape:

```json
{ "ok": true, "scanned": 0, "updated": 0, "cancelled": 0, "unchanged": 0, "errors": 0 }
```

Direct app probe (same secret):

```bash
curl -sS -X POST \
  "$HIREHUB_APP_URL/api/cron/sync-interview-rsvp" \
  -H "Content-Type: application/json" \
  -H "x-hirehub-cron-secret: $CRON_SECRET" \
  -d '{}'
```

---

## Refresh-token runbook (auth failures)

If sync returns `code: "google_auth_revoked"` or `"google_auth_failed"`:

1. Prefer a **Production** OAuth consent app — **Testing** refresh tokens often die after ~7 days (`invalid_grant`).
2. Re-issue refresh token for the organizer account (Calendar scope `calendar.events`) — same process as Track 1 B2.
3. Update **app host** secret `GOOGLE_REFRESH_TOKEN` only (not Edge, not `VITE_`).
4. Re-run the curl smoke above; expect `ok: true` (or `scanned` > 0 with updates).

Do not paste token values into chat, git, or this doc.

---

## Schema note

`PROPOSED_0025` already has `recruiter_response`, `seeker_response`, `last_synced_at`, and `interview_schedules_active_sync_idx`.  
`PROPOSED_0026` fixes event-id CHECK. **Do not re-apply 0025.** No new migration in D1–D2.

---

## D3 checklist (human — secrets + schedule)

Do these yourself. Do not paste secret **values** into chat/git.

1. **Confirm app host already has** `CRON_SECRET` (≥16), `GOOGLE_*`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (outbound Calendar path).
2. **Set Edge secrets** for function `sync-interview-rsvp`:
   - `CRON_SECRET` = same as app
   - `HIREHUB_APP_URL` = live app origin, no trailing slash (Vercel/Lovable URL)
3. **Deploy** function (includes `verify_jwt = false` from `supabase/config.toml`):
   ```bash
   npx supabase functions deploy sync-interview-rsvp --project-ref munqgybiuqpncxbgfvdp
   ```
4. **Schedule** in Dashboard: POST every 5–15 min; header `x-hirehub-cron-secret`; body `{}`.
5. **Manual curl smoke** (counts-only). If `hirehub_app_url_missing` / `401` / `google_auth_revoked`, fix secrets/token — do not claim D4 yet.
6. Reply when smoke returns counts JSON → then **D4 live Google accept/decline smoke**.

---

## Next after D3

**D4 — live Google accept/decline smoke** (human + optional agent observe)  
Then optional **D5 UI refetch** for scheduled rows.
