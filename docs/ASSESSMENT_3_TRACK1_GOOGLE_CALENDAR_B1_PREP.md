# Assessment 3 — Track 1 Google Calendar B1 prep

**Status:** B1 checklist only (Console prep). No secrets in this file. No `.env` edits in B1.  
**Code sources:** `src/lib/integrations/google-calendar.ts`, `src/lib/integrations/env.ts`  
**Prerequisite:** A5 PASS — `interview_schedules` visible to PostgREST / schema probe.

---

## What HireHub needs from Google

| Need | How this repo uses it |
|------|------------------------|
| **Google Calendar API** | REST `https://www.googleapis.com/calendar/v3` — create / get / patch / delete events |
| **Google Meet** | Via Calendar only: `conferenceData.createRequest` + `conferenceSolutionKey.type = hangoutsMeet` + `conferenceDataVersion=1`. App never invents Meet URLs; it waits for Google’s `hangoutLink` (`https://meet.google.com/…`) |
| **Separate Meet API product** | Not required for this design |
| **Credential model** | Server refresh-token: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REFRESH_TOKEN` (+ optional `GOOGLE_CALENDAR_ID`, default `primary`) |
| **Organizer account** | One Google account whose calendar hosts interview events (server acts as that account after refresh) |

Invite-after-link (already implemented in code / PROPOSED_0025 comments): create event **without** attendees → wait for real Meet link → then PATCH attendees (`sendUpdates=all`).

---

## Two different “Google” setups (do not conflate)

| | HireHub **Sign in with Google** | Server **Calendar integration** |
|--|----------------------------------|----------------------------------|
| Purpose | User signup / login | Create Calendar events + Meet for interviews |
| Where configured | Supabase / Lovable Auth Google provider | Server-only `GOOGLE_*` env (`env.ts`) |
| Code path | `signInWithOAuth({ provider: "google" })` in auth routes | `resolveGoogleCalendarConfig` → `refreshGoogleAccessToken` → Calendar REST |
| Scopes | Auth identity (openid / email / profile-style) | Calendar events (see below) |
| B1 action | **Leave alone** | Prep a **dedicated** Cloud project and/or OAuth client for Calendar |

Prefer a dedicated Calendar OAuth client (and ideally a non-prod GCP project). Sharing the signup client is unnecessary and mixes user-login credentials with long-lived calendar refresh tokens.

---

## OAuth scopes the code needs

The app does **not** hardcode scope strings; scopes are chosen when you obtain the refresh token (B2). Match API usage:

| Scope | Why |
|-------|-----|
| `https://www.googleapis.com/auth/calendar.events` | **Required minimum** — insert / get / patch / delete events; Meet via `conferenceData` |
| `https://www.googleapis.com/auth/calendar` | Broader fallback only if Meet/`conferenceData` fails under `.events` (prefer `.events` first) |

Do **not** request Drive, Gmail, or unrelated scopes.

---

## OAuth client type (for refresh-token server use)

HireHub never runs an in-app Google login for Calendar. It only POSTs to `https://oauth2.googleapis.com/token` with `grant_type=refresh_token`.

| Client type | Fit for HireHub |
|-------------|-----------------|
| **Desktop app** | **Preferred for B2 token obtain** — offline refresh for a single organizer account; loopback redirect handled by Google’s desktop flow |
| **Web application** | Also OK if you use a registered redirect (e.g. OAuth Playground or a one-time local callback) |
| **iOS / Android / Chrome extension** | Not appropriate |

**Consent screen:** External is typical for personal Gmail organizers. If Publishing status is **Testing**, add the organizer Google account under **Test users**. Note: Testing refresh tokens can expire ~7 days (`invalid_grant` → `google_auth_revoked` in code) until the app is published or you re-issue the token.

---

## Redirect URI names (for B2 — no secrets here)

Register only what your B2 obtain method will use. Common options:

1. **Desktop client** — Google loopback (`http://127.0.0.1:<port>/` style); often no manual URI list beyond creating a Desktop client  
2. **Web + [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)** — redirect: `https://developers.google.com/oauthplayground`  
3. **Web + local one-shot helper** — e.g. `http://localhost` or `http://localhost:<port>/oauth2callback` (exact URI must match Console)

Do **not** paste `client_secret` or refresh tokens into chat, git, or this doc.

---

## Phase map (B1 vs later)

| Step | You do | Agent / repo |
|------|--------|--------------|
| **B1 (this doc)** | Console: project, enable Calendar API, consent notes, decide client type | Checklist only — no `.env`, no live Calendar calls |
| **B2** | Create OAuth client; run consent once; obtain refresh token | Guide only when started — still no secrets in git |
| **B3** | Manually put values into local `.env` / host secrets | Agent tells **names** only; never edits `.env` |
| **B4** | First live schedule smoke in app | Expect real Meet only after Google returns `hangoutLink` |

---

## Priya — Console click-list (B1)

Do these in [Google Cloud Console](https://console.cloud.google.com/). Stop when Calendar API is enabled and you know which project + client type you will use in B2.

1. **Pick or create a GCP project**  
   Prefer a non-production / sandbox project named clearly (e.g. `hirehub-calendar-dev`). Note the project name/id for yourself (not in git).

2. **Enable Google Calendar API**  
   APIs & Services → Library → search **Google Calendar API** → Enable.  
   (Meet is created through Calendar `conferenceData`; you do not need a separate “Meet API” enable for this codebase.)

3. **Configure OAuth consent screen**  
   - User type: **External** (unless you have a Workspace org and choose Internal)  
   - App name / support email: your values  
   - Scopes: you can add `calendar.events` on the consent screen now, or ensure it is requested at token obtain in B2  
   - If status is **Testing**: add the **organizer** Gmail/Workspace account under **Test users**  
   - Do not publish to Production unless you intend to (Testing is fine for early smoke; remember ~7-day refresh token lifetime)

4. **Decide OAuth client type for B2**  
   Prefer **Desktop app** for one-time organizer refresh token. Alternatively **Web application** if you plan OAuth Playground / localhost redirect.  
   *Creating the client credentials can wait for B2 if you only want API+consent done in B1.*

5. **Plan redirect URI(s) for B2** (write privately; do not commit)  
   Match the obtain method: Desktop loopback, Playground URI, or localhost callback — see section above.

6. **Confirm separation from signup OAuth**  
   Do not change Supabase/Lovable “Sign in with Google” client settings as part of Calendar prep. Calendar uses server `GOOGLE_*` only.

7. **Security habits**  
   - Never paste client secret / refresh token into Cursor chat or commit them  
   - Never put these behind `VITE_`  
   - Store secrets only in local `.env` / host secret store later (B3)

**B1 done when:** Calendar API is **Enabled** on the chosen project, consent screen is configured (with test user if Testing), and you know Desktop vs Web for B2.

---

## Env names needed later (B3) — names only

Required:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

Optional:

- `GOOGLE_CALENDAR_ID` — omit to use `"primary"` (organizer’s primary calendar)

Defined in `src/lib/integrations/env.ts`. Missing any of the three required vars → `resolveGoogleCalendarConfig` returns `null` → `google_not_configured` (expected until B3).

---

## Explicitly out of B1

- Editing `.env` / `.env.local` / `.env.production`
- Obtaining or storing a refresh token
- Live `events.insert` / schedule smokes against Google
- SQL / RLS / PROPOSED_0025 changes
- Git commit of secrets or credential JSON

**Next step (name only):** B2 — OAuth client + refresh token obtain guide
