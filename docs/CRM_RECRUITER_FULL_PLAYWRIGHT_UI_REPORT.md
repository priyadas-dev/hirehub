# Recruiter CRM — Full Playwright UI test report

**Scope:** Entire `/recruiter/crm` area (Overview, Contacts, Segments, Campaigns + detail routes)  
**Date:** 2026-11-04  
**Environment:** `http://localhost:8080` (local `npm run dev`)  
**Account:** Recruiter (Miyra Das)  
**Method:** Playwright MCP (Chromium), signed-in session + clean context for auth gate  

**Screenshots**

- [`docs/crm-full-playwright-overview.png`](crm-full-playwright-overview.png)
- [`docs/crm-full-playwright-mobile-overview.png`](crm-full-playwright-mobile-overview.png)
- [`docs/crm-full-playwright-contacts.png`](crm-full-playwright-contacts.png)

**Related (Segments-only deep dive):** [`CRM_SEGMENTS_PLAYWRIGHT_FULL_UI_REPORT.md`](CRM_SEGMENTS_PLAYWRIGHT_FULL_UI_REPORT.md)

---

## Executive summary

| Area | Result |
|------|--------|
| **CRM Overview** | **PASS** — stats, email activity, recent campaigns, navigation |
| **Contacts** | **PASS** — add, search, detail sheet, import, filters/sort, manual-segment entry |
| **Segments** | **PASS** — filter create, not-found empty states (incl. E1/E2) |
| **Campaigns** | **PASS** — draft create, content save, preview, send guardrails, not-found |
| **Auth / tabs / mobile** | **PASS** |
| **Console errors (CRM flows)** | **None** |

**Intentionally not exercised in browser:** `Confirm & send` (live Resend outbound), `Set up Resend test contacts` (fixture mutates data). Buttons and pre-send UI were verified.

---

## Route map (user-facing)

| Route | Purpose |
|-------|---------|
| `/recruiter/crm` | Dashboard: counts, email activity, recent campaigns |
| `/recruiter/crm/contacts` | Contact CRUD, import, filters, manual segments |
| `/recruiter/crm/segments` | Filter segment create + list |
| `/recruiter/crm/segments/$segmentId` | Manual/filter detail, rename, membership |
| `/recruiter/crm/campaigns` | Campaign list + new draft |
| `/recruiter/crm/campaigns/$campaignId` | Content, preview, send, tracking |

Shared **CRM tab bar** on all sub-routes: Overview · Contacts · Segments · Campaigns.

---

## Test results

### Auth and shell

| ID | Case | Result | Notes |
|----|------|--------|-------|
| A1 | Logged-out visit `/recruiter/crm` | **PASS** | Redirect to `/auth?redirect=…` |
| A2 | Recruiter session loads CRM | **PASS** | Title `CRM — HireHub` on overview |
| TAB-Overview | Tab → overview | **PASS** | `/recruiter/crm` |
| TAB-Contacts | Tab → contacts | **PASS** | |
| TAB-Segments | Tab → segments | **PASS** | |
| TAB-Campaigns | Tab → campaigns | **PASS** | |
| MOB1 | Mobile 390×844 overview | **PASS** | After load; h1 + stat grid usable |

### Overview — `/recruiter/crm`

| ID | Case | Result | Notes |
|----|------|--------|-------|
| OV1 | “CRM overview” header + description | **PASS** | |
| OV-stat | Stat cards: Contacts, Segments, Campaigns, Opened | **PASS** | Numeric values shown |
| OV2 | Email activity section | **PASS** | Sent / Delivered / Opened / Bounced mini-stats |
| OV3 | Recent campaigns section | **PASS** | List or empty state |
| OV4 | Header **New campaign** | **PASS** | Links to campaigns index |
| OV5 | Stat card → Contacts | **PASS** | |
| OV6 | **New campaign** from overview | **PASS** | |
| OV7 | **View all** → campaigns | **PASS** | When recent list present |
| OV8 | **Open** on recent campaign row | **PASS** | Lands on campaign detail |

### Contacts — `/recruiter/crm/contacts`

| ID | Case | Result | Notes |
|----|------|--------|-------|
| CT1 | Page header | **PASS** | |
| CT2 | **Import from applicants** | **PASS** | Triggers server import + toast |
| CT3 | **Set up Resend test contacts** | **PASS (visible)** | Not clicked (creates fixture data) |
| CT4 | Resend free testing help block | **PASS** | Simulator addresses documented |
| CT5 | **Save contact** disabled without email | **PASS** | |
| CT6 | Add new contact | **PASS** | Toast **Contact saved** |
| CT7 | Search by name | **PASS** | |
| CT8 | Row click → detail sheet | **PASS** | Closes with Escape |
| CT9 | Select contact → **Create segment from selected contacts** | **PASS** | |
| CT10 | Import from applicants | **PASS** | Completes without error toast |
| CT11 | Filter comboboxes (skills, category, status, kind, add form) | **PASS** | 5+ comboboxes |
| CT12 | Column sort (Name) | **PASS** | Header control clickable |
| CT13 | Select all matching (multi-page bulk) | **NOT RUN** | Single page of contacts in test account |
| CT14 | Duplicate email on save | **NOT RUN** | Would need second save with same email |

### Segments — `/recruiter/crm/segments` + detail

| ID | Case | Result | Notes |
|----|------|--------|-------|
| SG1 | Segments index | **PASS** | |
| SG2 | Save filter disabled without name | **PASS** | |
| SG3 | Create filter segment + toast | **PASS** | e.g. PW CRM Quick Filter |
| SG-E1 | Unknown UUID detail | **PASS** | **Segment not found** + **All segments** (allow ~2s load) |
| SG-E2 | Invalid id `not-a-uuid` | **PASS** | Same empty state |
| SG-* | Manual detail rename / add / remove | **PASS** | Covered in prior segments report; spot-checked in this CRM pass |

See [`CRM_SEGMENTS_PLAYWRIGHT_FULL_UI_REPORT.md`](CRM_SEGMENTS_PLAYWRIGHT_FULL_UI_REPORT.md) for exhaustive segment-only cases.

### Campaigns — `/recruiter/crm/campaigns` + detail

| ID | Case | Result | Notes |
|----|------|--------|-------|
| CP1 | Campaigns index | **PASS** | |
| CP2 | **Create draft** disabled without name | **PASS** | |
| CP3 | Create draft + navigate to detail | **PASS** | Segment audience selectable |
| CP4 | **Save draft** (subject + HTML) | **PASS** | Toast **Campaign saved** |
| CP5 | Preview shows subject | **PASS** | |
| CP6 | Preview renders HTML body | **PASS** | |
| CP7 | **Confirm & send** disabled without checkbox | **PASS** | |
| CP8 | Checkbox enables send when preview ready | **PASS** | Send **not** clicked |
| CP9 | Tracking section (aggregates + recipient list when present) | **PASS** | |
| CP10 | **All campaigns** back link on detail | **PASS** | |
| CP-E1 | Unknown campaign UUID | **PASS** | **Campaign not found** + **Back** |
| CP-SEND | Live Resend send | **NOT RUN** | Avoid unintended outbound mail in automated pass |

### Cross-cutting

| ID | Case | Result |
|----|------|--------|
| E3 | Console `error` during CRM navigation | **PASS** (none) |
| UX1 | Global search placeholder on CRM | **PASS (note)** — still “Search your job posts…” |

---

## Issues and gaps (non-blocking)

1. **Campaign send** — UI and guards work; live send requires recruiter confirmation and valid Resend config (not executed here).
2. **Resend test fixture** — Button present; running it creates contacts + segment (skipped in automation).
3. **Filter segment UX** — Raw JSON criteria, membership copy on filter detail (see segments report).
4. **No delete** for campaigns, segments, or contacts from these list UIs.
5. **Contacts bulk select** — “Select all matching filters” not stress-tested with paginated data.
6. **HubSpot sync** — Soft sync on contact create is server-side; no dedicated UI indicator tested.

---

## Test data touched this run

| Artifact | Notes |
|----------|--------|
| Contact `pw-crm-*@example.com` / PW CRM Contact | Created via Save contact |
| Segment **PW CRM Quick Filter** | Filter segment |
| Campaign **PW CRM Campaign Draft** | Draft with subject/body saved |

Pre-existing CRM data (segments, campaigns, imports) remained in the recruiter account.

---

## How to reproduce

1. Start app: `npm run dev` (port **8080**).
2. Sign in as a **recruiter** with CRM migrations applied (incl. manual segments if testing Contacts → segment).
3. Walk tabs: Overview → Contacts → Segments → Campaigns.
4. Edge URLs:
   - `/recruiter/crm/segments/00000000-0000-4000-8000-000000000000`
   - `/recruiter/crm/segments/not-a-uuid`
   - `/recruiter/crm/campaigns/00000000-0000-4000-8000-000000000000`

---

## Verdict

From a **recruiter user perspective**, the full **CRM module** is **functionally coherent**: dashboard metrics and email activity, contact management and import, segments (filter + manual paths), and campaign draft/preview/send workflow with not-found handling on bad IDs.

Recommended follow-ups: optional `e2e/crm-recruiter.spec.ts` for CI (with local `E2E_RECRUITER_*` env vars, never committed), and UX polish items above.
