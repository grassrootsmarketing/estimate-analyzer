# Codex handoff — Estimate Analyzer

## TL;DR
- Repo: `github.com/grassrootsmarketing/estimate-analyzer` (public). Live: https://estimate-analyzer-atb.vercel.app
- Vercel auto-deploys the `main` branch. Push to `main` and the site updates in about a minute.
- The full operating guide is in **AGENTS.md** at the repo root. Codex loads it automatically. Read it before changing anything.
- Codex works on the cloud repo. It cannot see changes that live only in a local working copy. Anything not pushed is invisible to Codex.

## How to ship any change (the whole loop)
1. Run the pricing test (no dependencies, required before every push):
   ```
   node test/math.test.js
   ```
   It must print that all invariants passed. A nonzero exit means the pricing math broke. Do not push.
2. Commit and push to `main`:
   ```
   git add -A
   git commit -m "clear message"
   git push
   ```
3. Vercel auto-deploys `main`. There is no manual deploy step.

## Pending work that is DONE locally but NOT yet pushed
As of this handoff, two items are edited in the local working copy and need one commit to go live. Until they are pushed, they are not on GitHub and Codex cannot see them.

1. `AGENTS.md` (new file) — the operating guide.
2. `index.html` — a visual redesign, no pricing logic touched:
   - **Realm-style warm theme.** Cream page background, white cards, deep forest-green headings and figures, gold accent buttons, white input fields with a green focus ring. Implemented as a CSS override block at the end of the `<style>` tag. Search for `REALM WARM THEME`. It redefines the `:root` color variables and overrides the handful of components that had hard-coded dark colors.
   - **Dashboard home** (new default landing view, `#dashView`). Four KPI tiles (Projects, Pipeline dollar total, Average margin, Win rate) plus recent saved jobs as clickable project cards. All computed from the archive by `renderDashboard()`. Tapping a card loads that job into the estimator.
   - **Bottom nav** now has four items: Dashboard / Estimate / Archive / Settings. `#navDash` was added and `showView()` handles the new `dash` view.

**Fastest way to ship it:** run the three git commands above in the repo folder. That pushes the redesign and `AGENTS.md` in one commit. Nothing else is required.

If you would rather Codex own the redesign end to end: push the local changes first (recommended, since the work is already done), or have Codex re-implement it from the description above against the current `main`.

## Rules that must not be broken (short form; full detail in AGENTS.md)
- Never change the pricing math in `compute()`. It is the product. Run `node test/math.test.js` before every push.
- Single self-contained `index.html`, no build step, no framework, no bundler.
- No external CDN runtime dependencies. The app must work offline on a jobsite. A blocked CDN request hangs with no error. If a library is truly needed, vendor it into the repo so it is same-origin.
- No em dashes in user-facing copy. Do not run a blind find-and-replace on dashes; a few separators in `SEED_BENCH` keys and the range regex are parsed.
- Never rebuild the `#rows` container in the results-painting path. It drops input focus on mobile.

## Where things live in index.html
- Pricing: `compute()`. Result rendering: `paintResults()`. Orchestration: `calc()`.
- Dashboard: `renderDashboard()` and the `#dashView` section.
- View switching: `showView()` and the `.nav` buttons.
- Summary and PDF: `buildSummary()`, `_estimatePdf()`, `_mkPDF()`, `downloadSummary()`.
- Archive, prune, restore, backup: the save / `pruneArchive` / restore / export handlers.
- Storage: `idbOpen()` and the load/persist helpers, with a localStorage fallback.
