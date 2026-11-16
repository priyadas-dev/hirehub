# Google Calendar signed inbound webhook — Track 1 runbook

**Status:** Code complete (watch API + token-verified webhook + renew cron + RSVP reuse).  
**Primary inbound:** Google Calendar `events.watch` push → `/api/webhooks/google-calendar`.  
**Fallback:** RSVP poller (`/api/cron/sync-interview-rsvp`) every 5–15 min.

Google push is **not** Svix/HMAC. Auth = HTTPS + timing-safe check of `X-Goog-Channel-Token` (secret you set at watch time) + known `channel_id` in DB.

---

## Secret NAMES (you set values; agent does not edit `.env`)

| Name | Purpose |
|------|---------|
| `GOOGLE_CALENDAR_WEBHOOK_TOKEN` | Random ≥32-char secret; watch `token`; verified on each push |
| `GOOGLE_CALENDAR_WEBHOOK_URL` | Full public HTTPS URL, e.g. `https://<host>/api/webhooks/google-calendar` |
| Existing | `GOOGLE_CLIENT_ID` / `SECRET` / `REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, `CRON_SECRET`, Supabase admin |

Never commit values. Never put behind `VITE_`.

---

## Schema (SQL Editor — your approval)

Apply **`PROPOSED_0028_google_calendar_watch_channels.sql`** (not 0027 — that number is `agent_sessions`).

- Table: `google_calendar_watch_channels` (`channel_id`, `resource_id`, `calendar_id`, `expiration_ms`, …)
- Service-role only; no authenticated INSERT/UPDATE; does **not** store the webhook token
- Prereq: PROPOSED_0025 (+ 0026 event-id CHECK). Do **not** re-apply 0025.

---

## Deploy checklist

1. Apply PROPOSED_0028 in SQL Editor.
2. Set host secrets (table above). Webhook URL must be **public HTTPS** (localhost alone cannot receive Calendar push).
3. Deploy app so `/api/webhooks/google-calendar` is live.
4. Bootstrap watch once:

```bash
curl -sS -X POST \
  "$HIREHUB_APP_URL/api/cron/renew-google-calendar-watch" \
  -H "Content-Type: application/json" \
  -H "x-hirehub-cron-secret: $CRON_SECRET" \
  -d '{"force":true}'
```

Expected shape (ids only — no token):

```json
{ "ok": true, "action": "created", "channelId": "…", "resourceId": "…", "expirationMs": 1893456000000 }
```

5. First Google message is often `X-Goog-Resource-State: sync` → handler returns `{ ok: true, state: "sync" }`.

### Renew schedule

Call the same renew path daily (or before expiry) with `CRON_SECRET`. Without `force`, renew skips when expiration is >24h away.

---

## Smoke evidence

### Automated (agent — unit)

```text
PASS  handleGoogleCalendarPush > returns 401 for wrong channel token and does not sync
PASS  handleGoogleCalendarPush > on exists triggers sync with extracted event id
PASS  syncInterviewScheduleByGoogleEventId > syncs the matching scheduled row when found
PASS  watchInterviewCalendar never returns channel token / OAuth secrets
PASS  renew cron wrong CRON_SECRET → 401
```

Command: `npx vitest run src/test/google-calendar-webhook.test.ts src/test/google-calendar-watch-renew.test.ts src/test/google-calendar.test.ts`

Live Google accept/decline against a hosted URL requires you to apply PROPOSED_0028 + set webhook secrets + bootstrap renew (checklist above).

### Negative (wrong token → 401, hosted)

```bash
curl -sS -o /dev/null -w "%{http_code}" -X POST \
  "$HIREHUB_APP_URL/api/webhooks/google-calendar" \
  -H "X-Goog-Channel-ID: any" \
  -H "X-Goog-Channel-Token: wrong-token" \
  -H "X-Goog-Resource-State: exists"
```

Expect **401**. DB unchanged.

### Positive (accept / decline / cancel)

1. Recruiter schedules interview with Meet (outbound B4 path).
2. In Google Calendar, accept/decline as seeker (or cancel the event).
3. Push → HireHub updates `recruiter_response` / `seeker_response` (or `status = cancelled`) without waiting for the long poll.
4. Poller remains as backup if a push is missed.

---

## Assignment wording (safe after smoke)

- **Outbound:** create/update/cancel Calendar events + Meet + invites.
- **Inbound:** Google Calendar **push webhook** with **channel-token verification**, applying attendee RSVP/cancel into HireHub (poller retained as fallback).

---

## Risks

- Public HTTPS required; local demos need a tunnel or hosted URL.
- Channels expire — renew cron is mandatory.
- Push is a ping (often empty body) — apply still uses `getInterviewEvent`.
- OAuth Testing refresh tokens still expire ~7 days.
