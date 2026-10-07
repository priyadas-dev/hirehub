<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Auth uses Lovable Cloud via `src/lib/auth.tsx` (`useAuth`/`readSession`); role is read only from `profiles.role`, and role areas (/seeker, /recruiter, /admin) guard themselves via `ROLE_HOME` so authorization never trusts browser input.
- Protected pages live under the `_app` pathless layout (sidebar + header shell); add new signed-in pages as `_app.*.tsx` so they inherit the guard.
- Application status visuals (labels, icons, colors) come only from `src/components/status/status.ts` so the journey stays consistent everywhere.
- Role-specific navigation is defined in `src/components/shell/nav.ts`; add pages there rather than hardcoding links in the sidebar.
