# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Inferred from the app and from the request to redesign the job seeker page. The earlier product interview was not answered.

Job seekers are the primary audience of the seeker workspace. They are people looking for work: they browse approved openings, save roles, apply, and follow each application. Recruiters post jobs and move candidates. Admins approve posts and moderate the marketplace. Which audience wins when needs conflict outside the seeker workspace is still open.

## Product Purpose

Inferred. HireHub is a hiring workspace where a seeker can see what happens next on an application. Success on the seeker page is that the person can tell where they stand and can still reach browse, save, profile, and application actions without hunting.

## Positioning

Inferred, not a market claim the user confirmed. The mechanism in the product is a visible application journey (applied, shortlisted, interview, hired, or not selected) on jobs that go live only after admin approval. Do not invent customers, pricing, press, or testimonials around that claim.

## Operating Context

Inferred from the signed-in seeker routes. The seeker uses a web app with a sidebar: dashboard, browse jobs, my applications, saved jobs, profile and resume, and settings. Deadlines use the Asia/Dhaka calendar. Sample companies and locations in the interface, including Acme Labs in Dhaka, are fictional demonstration content.

## Capabilities and Constraints

Confirmed by the redesign request: every existing button, link, and action on the job seeker page stays present and keeps working. Labels and destinations do not change.

Inferred from the code, and required to stay true:

- Seeker home shows a greeting, shortcuts to Saved, Profile, and Browse jobs, counts for applications, shortlisted, interviews, and saved jobs, the latest application journey, recent applications, and latest approved jobs.
- Counts and recent rows link to the existing application, saved, and job routes.
- Empty, loading, and error states stay, including retry.
- Role is read only from the profile. The seeker area redirects other roles away.
- English only. Responsive web, not a native app.

Open: no extra accessibility standard was set beyond the controls that already exist.

## Brand Commitments

The product name is HireHub. No visual world, palette, or type was made binding. The previous seeker screen is not a commitment; it is the surface being replaced.

## Evidence on Hand

Live seeker data comes from the signed-in user's applications, saved jobs, and approved jobs. There are no real testimonials, customer logos, case studies, or pricing. Do not fabricate them. Demonstration job titles and companies already in the database may be shown as the user's own data.

## Product Principles

Inferred from the request and the existing seeker job:

- The next step of an application is visible without opening a separate explanation.
- Every control that exists today still does the same job after a visual change.
- Seeker, recruiter, and admin stay separate; seeker design does not grant another role's actions.
- Demonstration copy stays fictional. Do not add commercial proof.
