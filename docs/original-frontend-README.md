# Matiks Creator Hub - approved frontend source

This is the exact frontend source behind the approved 28 Oct 2026 private
preview, packaged as an ordinary standalone Vite + React + TypeScript project.
The goal for the next build step: PRESERVE this UI exactly and put a real
backend underneath it. Do not redesign.

## Run it

    npm install
    npm run dev      # local dev
    npm run build    # static production build in dist/ (deployable to Cloudflare Pages)

## What is real (keep)

- The full neobrutalist design: palette #FF4502 / #C2FF01 / #0044FF / #DCB8FF
  on black borders with hard offset shadows, warm notebook square-grid
  background, bundled Anton display font, Matiks app icon, "seros was here"
  sticker, custom desktop cursors (src/cursors), all in src/style.css.
- Every interaction: week selector (20 current, 19, 18, 17), archive search,
  format/category/bundle/persona filters, expandable source details with
  sheet/tab/row provenance and source URLs, winner library, learnings,
  bundle archive (week 20 intentionally empty), personas section
  (Unhinged / Hot girl / Gameplays; Gameplays maps to source tab "gamer guy"),
  creator preview with per-creator brief cards and progress stepper.
- src/data/archive.json: the one-time imported snapshot - 705 source-derived
  records from 13 spreadsheets / 56 tabs (week 17: 189, week 18: 273,
  week 19: 177, week 20: 9 non-bundle notes, pages library: 57), imported
  28 Oct 2026. Each record keeps sources[] with sheet/tab/row and the source
  sheet URL. This file is the seed for the one-time database import; after
  that the website (not the Sheets) is the editing home.
- Original Instagram/TikTok links open externally with placeholder posters.
  No inline playback or rehosted video.

## What is a demo (this is what the backend replaces)

- The Admin/Creator role switch is a preview toggle, not authentication.
  Target: admin-only Google sign-in with an explicit allowlist.
- "Creator demo" assignment groups and the colored progress dots are
  illustrative, not real submission statuses.
- The creator progress stepper saves nothing. Comments and done-status do
  not exist yet (both optional in v1, saved per creator).
- There are no creator access links. Target: no-login, per-creator unique
  bearer links that return only that creator's assigned published briefs.
  Never expose the full library or the roster to creator viewers.
- Publishing does not exist: bundle cards show historical sheet snapshots,
  not app-published versions.
- Direct social-URL input (paste an IG/TikTok link, fetch metadata, embed
  with open-original fallback) is not built yet. Video file uploads are
  deferred.

## Data caveats to carry into the import

- Rows flagged needsReview have ambiguous column mappings - show them to the
  owner before publishing briefs from them.
- extras[] holds unmapped source cells preserved without relabeling.
- Exact duplicates within a matching classification were combined; differing
  source copies were retained. Master and creator-facing bundle copies stay
  separate when their text differs.
- Source metrics and claims are sheet notes, not independently rechecked.

## Notes

- The preview was rendered with a hosted brand body font; this standalone
  version falls back to the system sans. Swap in any readable body font in
  style.css ("layout shell" section) if you want a different one.
- ui.tsx contains small layout primitives (FileCard, Header, Callout, Group,
  Caption, Closing, TextLink, CloseButton) measured from the approved preview
  so the look is preserved without any external component library.
