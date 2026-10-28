# Matiks Creator Hub

Your approved frontend (unchanged design: palette, notebook grid, Anton, Matiks icon,
"seros was here" sticker, desktop cursors, cards, chips, stepper) with a real backend under it.
The original frontend README is kept in `docs/original-frontend-README.md`.

- **Admins** (pranjali@matiks.com, meenal@matiks.com) sign in with an emailed one-time link.
- **Creators** never sign in. Each gets a private link `https://YOUR-SITE/c#…` showing only the
  bundles assigned to them and published. The link works like a key: anyone it's forwarded to
  can open it and act as that creator, so send it privately and rotate it if it leaks.

## What's real

| Area | How it works |
| --- | --- |
| Library (Weekly inspo, Winners, Learnings, Personas, sheet bundle archive) | The 705 sheet records you approved, imported once into the database, plus the 6 Week 19 design learnings. Editable in place (Edit on any card), with sheet / tab / row sources kept. 175 rows flagged "Check mapping" are listed under **Needs mapping review**. |
| Import link | Paste an Instagram, TikTok, YouTube or any link. It's saved straight away, then title/author/thumbnail are fetched from each platform's official oEmbed endpoint when they allow it. If not, the entry stays and you fill details in by hand. Same link again → "Already in the library", with **Attach** to add it to another week/persona instead of duplicating. |
| Ideation queue | Research dump → Developing → Approved, under Weekly inspo. Approved ideas appear in Bundles as "Add as brief". |
| Bundles | Draft briefs (format, inspo links, on-screen text, script, alternate hooks, note, caption, audio, posting notes, internal notes). **Publish** freezes an unchangeable version with who/when and a "what changed" list. Drafts never change what creators already have. |
| Creators | Test creators only until you approve real ones (Admin tab). Create / rotate / revoke links, see last opened, assign several creators to one bundle. |
| Creator page | Published briefs in the approved card layout, copy buttons with fallback, play-here for supported videos, "Updated to vN" notices, per-brief **Mark done** and comments, and the **Your progress** stepper. All saved online, separately per creator. Checks for new publishes every minute and when the tab is reopened. "Approved" can only be set by admins. No uploads. |
| Admin view → Creator view | Read-only preview of exactly what a chosen creator's link shows. |
| Admin tab | Add/remove admins, add weeks and set the current week, resolve re-import conflicts, approve real-creator sharing, activity log. |
| Winner metrics | Sheet STATS stay word-for-word labelled "as written, not re-checked". New numbers require a source and optional date seen. |

Week 20 starts with no bundles; nothing is copied in from older weeks.

## Security model

- Every table has row-level security forced on. Only signed-in emails in the `admins` table can
  read or write; nobody can add themselves. Sign-ups are off.
- Creators reach the database only through six token-checked functions (`creator_*`). Tokens are
  256-bit random, stored only as SHA-256, kept in the URL fragment so they never reach server
  logs or Referer headers. Revoking or deactivating takes effect immediately.
- Published versions can't be edited or deleted, even by the database owner. Creator-visible
  snapshots never include internal notes.
- The browser holds only the publishable key. No service key is used anywhere in the app.
- `/api/metadata` checks the caller is an admin and only talks to three fixed platform hosts:
  it never fetches the pasted URL, refuses redirects, times out, caps size and drops provider HTML.
- Comments are plain text (React escapes them), 1–2000 characters, max 10 per 10 minutes and 60
  per day per creator.

## Deploy (about 20 minutes, two free accounts)

**Costs:** Cloudflare Pages free plan (commercial use allowed). Supabase free plan works for
staging but pauses after 7 days without use and has no daily backups; switch to Supabase Pro
($25/month) before real creators rely on it.

1. **Supabase** → New project (region near you). Then:
   - SQL editor: run the three files in `supabase/migrations/` in order.
   - Authentication → Sign In / Providers → Email: keep enabled, turn **Allow new users to sign up** off.
   - Authentication → Users → **Invite user** for pranjali@matiks.com and meenal@matiks.com.
   - Authentication → URL Configuration: Site URL = your Cloudflare URL (step 2); add it to Redirect URLs too.
   - Project settings → API: copy the Project URL and the **publishable** key.
2. **Cloudflare** → Workers & Pages → Create → Pages → connect GitHub repo `upranjali/matiks_bundles`.
   Build command `npm run build`, output `dist`. Environment variables: `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (see `.env.example`).
3. **Import the sheets once** from your computer:
   `DATABASE_URL="<Supabase → Connect → Session pooler string>" npm run seed`
   (Add `-- --dry-run` first to preview. Safe to re-run: unchanged rows are skipped and rows you
   edited in the app are never overwritten.)
4. Open the site, sign in, add a test creator, publish a bundle to them, and open their link in a
   private window.

Backups and recovery: on Supabase Pro, daily backups are automatic (Database → Backups) and can be
restored from the dashboard. The full change history is in the Admin tab's activity log, and every
published version is kept permanently.

## Develop and test

    npm install
    npm run dev          # needs VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY in .env
    npm run typecheck
    npm test             # 33 tests: security rules, creator isolation, publishing, import, link details
    npm run e2e          # 26-step browser acceptance run (see tests/e2e/run-local.sh for setup)

`npm test` needs a throwaway Postgres in `TEST_DATABASE_URL` (default
`postgres://postgres@localhost:54329/postgres?host=/tmp/pgtest`).
