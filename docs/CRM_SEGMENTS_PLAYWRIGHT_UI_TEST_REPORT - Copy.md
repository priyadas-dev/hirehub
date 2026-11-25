# CRM Segments — Playwright UI test report

**Route under test:** `/recruiter/crm/segments` (+ detail + Contacts → manual create)  
**Date:** 2026-11-04  
**Environment:** Local `npm run dev` at `http://localhost:8080`  
**Account:** Recruiter (Miyra Das)  
**Method:** Playwright MCP browser (Chromium), signed-in session, desktop + mobile viewport  

Screenshots captured during the run (repo root):

- `crm-segments-index.png`
- `crm-segments-after-create-filter.png`
- `crm-segment-filter-detail.png`
- `crm-segment-manual-detail.png`
- `crm-segment-manual-created.png`
- `crm-segments-mobile.png`

---

## Verdict

Core happy paths work: list, create filter segment, rename, open detail, create manual segment from Contacts, add/remove members, CRM tab nav, and mobile layout.

**Main functional bug:** missing or invalid segment IDs show a generic **“Something went wrong”** error instead of the intended **“Segment not found”** empty state. Retry cannot recover.

---

## Scope covered

| Area | Covered |
|------|---------|
| Auth gate → redirect to `/auth?redirect=/recruiter/crm/segments` | Yes |
| Segments index load, header, CRM tabs | Yes |
| Empty-name / whitespace-only Save disabled | Yes |
| Kind select (`new` / `active` / `placed`) | Yes |
| Create filter segment + toast + list refresh + form clear | Yes |
| Filter detail (badge, criteria, matching count, rename, All segments) | Yes |
| Manual detail (members list, Add contacts, Add selected, Remove) | Yes |
| Contacts → select → Create segment dialog → Cancel preserves selection | Yes |
| Contacts → create with custom name → navigate to detail | Yes |
| Contacts → create with empty name → default name applied | Yes |
| Missing UUID detail | Yes |
| Invalid non-UUID detail | Yes |
| Mobile 390×844 layout | Yes |
| Console errors on Segments flows | Yes (none attributable to Segments) |

---

## Test results

### Auth & shell

| ID | Case | Result | Notes |
|----|------|--------|-------|
| A1 | Unauthenticated visit to `/recruiter/crm/segments` | **PASS** | Redirects to Sign in with redirect preserved |
| A2 | Sign in as recruiter lands on Segments | **PASS** | Title `CRM segments — HireHub`; role Recruiter |
| A3 | CRM tabs: Overview / Contacts / Segments / Campaigns | **PASS** | Links present; Segments highlighted on index |
| A4 | Global search placeholder on CRM | **PASS (UX note)** | Still says “Search your job posts…” on CRM pages |

### Segments index (`/recruiter/crm/segments`)

| ID | Case | Result | Notes |
|----|------|--------|-------|
| I1 | Page header + description | **PASS** | Points users to Contacts for manual segments |
| I2 | Create form fields | **PASS** | Name, Kind, Skills, Application statuses |
| I3 | Save disabled when name empty | **PASS** | |
| I4 | Save disabled for whitespace-only name | **PASS** | `!name.trim()` |
| I5 | Kind options | **PASS** | `new`, `active`, `placed` |
| I6 | Create filter segment | **PASS** | Created “E2E Active Filter”; toast **Filter segment created**; list updated with **Filter** badge |
| I7 | Form reset after create | **PARTIAL** | Name / skills / statuses clear; **Kind stays on last value** until remount |
| I8 | List badges + counts | **PASS** | Manual / Filter badges; contact counts shown |
| I9 | Open segment from list | **PASS** | Navigates to `/recruiter/crm/segments/$segmentId` |
| I10 | Mobile layout | **PASS** | Usable stacked form + list; CRM tabs wrap |

### Filter segment detail

| ID | Case | Result | Notes |
|----|------|--------|-------|
| F1 | Type badge + meta | **PASS** | Filter · N contacts · kind |
| F2 | Filter criteria display | **PASS (UX)** | Shows saved JSON (skills, statuses, segmentKinds) — raw JSON is hard for recruiters |
| F3 | Rename | **PASS** | Heading + list name update; toast **Segment renamed** |
| F4 | All segments back link | **PASS** | Returns to index |
| F5 | Page description copy | **FAIL (UX)** | Always “Manage segment membership and name” even though filter segments have no membership UI |

### Manual segment detail

| ID | Case | Result | Notes |
|----|------|--------|-------|
| M1 | Members list | **PASS** | Name + email + Remove |
| M2 | Add contacts panel | **PASS** | Candidates exclude current members; Add selected disabled until pick |
| M3 | Add selected contact | **PASS** | Count 2 → 3; panel closed; member appeared |
| M4 | Remove contact | **PASS** | Count decreased; member removed |
| M5 | Rename | **PASS** | Same control as filter (verified on filter; UI identical) |

### Contacts → manual segment (entry path for Manual)

| ID | Case | Result | Notes |
|----|------|--------|-------|
| C1 | Select contacts → action appears | **PASS** | “N selected” + **Create segment from selected contacts** |
| C2 | Dialog open | **PASS** | Optional name + default-name hint |
| C3 | Cancel | **PASS** | Dialog closes; selection kept |
| C4 | Create with custom name | **PASS** | Navigates to new detail; Manual badge; exact members |
| C5 | Create with empty name | **PASS** | Default e.g. `Rajon Dey · 2026-11-04` applied |

### Error / edge routes

| ID | Case | Result | Notes |
|----|------|--------|-------|
| E1 | Unknown UUID `/segments/00000000-0000-4000-8000-000000000000` | **FAIL** | Shows **Something went wrong** + Try again — not **Segment not found** |
| E2 | Invalid id `/segments/not-a-uuid` | **FAIL** | Same generic error (Zod/server throw → query error) |
| E3 | Console errors during Segments flows | **PASS** | No Segments-specific console errors (only unrelated admin route code-split warning) |

---

## Issues found

### 1. Missing segment shows generic error (functional bug — high)

**What the user sees:** Alert “Something went wrong / We couldn't load this right now” with **Try again**.

**What should happen:** Empty state **Segment not found** (“This segment may have been removed.”) already exists in `_app.recruiter.crm.segments.$segmentId.tsx` but is never reached.

**Why:** `fetchManualSegmentDetail` always goes through `assertSegmentAccess`, which **throws** `Segment not found` when the row is missing. React Query marks the query as **error**, so the UI hits `detail.isError` → `ErrorState` before `!detail.data?.segment`.

**Impact:** Confusing error for bad links / deleted segments; Retry loops the same failure.

**Suggested fix (product):** Return `{ segment: null }` (or equivalent) for not-found instead of throwing; keep throws for auth/permission failures. Or map “Segment not found” message to the EmptyState in the page.

### 2. Filter detail copy claims membership management (UX — medium)

Detail `PageHeader` description is always “Manage segment membership and name.” Filter segments only support rename + read-only criteria — no Add/Remove.

### 3. Filter criteria shown as raw JSON (UX — medium)

Recruiters see a `<pre>` dump of the filter object. Fine for debugging; weak for day-to-day CRM use. Prefer labeled chips/lists for skills, statuses, and kind.

### 4. Kind not reset after filter create (UX — low)

On success, name/skills/statuses clear but Kind remains (e.g. `active`) until the page remounts. Inconsistent with the other fields.

### 5. Kind labels are raw enums (UX — low)

UI shows `kind: new|active|placed` rather than human labels (e.g. New / Active / Placed).

### 6. No delete segment (feature gap)

No UI to delete a filter or manual segment after create. E2E-created segments remain in the list.

### 7. No edit of filter rules after create (feature gap)

Filter segments can be renamed but skills/statuses/kind cannot be edited from detail.

### 8. Application statuses are free text (UX / data quality — low)

Statuses field accepts any comma-separated string with no validation against known application statuses. Typos yield silent 0-match audiences.

### 9. Credential setup in `.env` (local ops — note)

Recruiter login was stored as freeform lines (typo “recuiter”), not as proper env vars such as `E2E_RECRUITER_EMAIL` / `E2E_RECRUITER_PASSWORD`. Prefer named vars, keep out of git, and do not paste passwords into docs or chat.

---

## What worked well

- Auth redirect and post-login landing on Segments  
- Manual vs Filter badges and list counts  
- Filter create + toast + list update  
- Rename persistence across detail ↔ list  
- Manual create from Contacts (custom + default names) with redirect to detail  
- Add/remove members with correct candidate filtering  
- Cancel on create dialog preserves selection  
- Mobile layout remains usable  
- No Segments-related console errors during the pass  

---

## Data created during this run (cleanup optional)

| Name | Type |
|------|------|
| E2E Active Filter Renamed | Filter |
| Toast Check Filter | Filter |
| E2E Manual Jia+Koushik | Manual |
| Rajon Dey · 2026-11-04 | Manual |

Pre-existing: **IT Candi** (Manual). Member add/remove on IT Candi was exercised then removed back to 2 contacts.

---

## Recommended next fixes (priority)

1. Fix not-found handling so missing/invalid segment IDs show **Segment not found**, not generic ErrorState.  
2. Adjust filter detail copy (and optionally hide membership language).  
3. Replace raw JSON criteria with readable summary.  
4. Reset Kind with the rest of the create form.  
5. (Optional) Delete segment + edit filter rules.

---

## Repro for the highest bug

1. Sign in as recruiter.  
2. Open `/recruiter/crm/segments/00000000-0000-4000-8000-000000000000`.  
3. Observe **Something went wrong** instead of **Segment not found**.  
4. Click **Try again** — same error returns.
