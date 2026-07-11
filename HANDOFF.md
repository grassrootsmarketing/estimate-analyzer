# Estimate Analyzer — Handoff & Audit Brief

_Prepared for a UI/UX + code audit. Written to be candid about the current state, not to sell it._

---

## 1. What this is

A phone-first web app for a **Los Angeles general contractor** (homeowners → small apartment/commercial). It turns job costs (or an existing bid) into a defensible price, guards against underpricing, remembers past jobs, and generates a client-facing proposal.

- **Live:** https://estimate-analyzer-atb.vercel.app
- **Repo:** github.com/grassrootsmarketing/estimate-analyzer
- **Primary user surface:** mobile (one-handed, ~390px). Desktop is secondary.

Two modes:
- **Analyze a bid** — numbers are a finished bid with margin already baked in; it decomposes into break-even cost, profit, margin.
- **Build from cost** — enter your raw costs; it applies your **markup** and sets the price.

---

## 2. Stack & constraints

- **One self-contained `index.html`** — all HTML, CSS, and vanilla JS in a single file. No framework, no build step, no npm, no bundler.
- **One serverless function** — `/api/structure.js` (CommonJS, Vercel Node runtime) for the voice-to-estimate parser. This is the only code outside `index.html`.
- **`sw.js`** — minimal service worker (offline shell cache + PWA).
- **Hosting:** Vercel, auto-deploys from `main`.
- **Storage:** IndexedDB (with in-memory cache + localStorage fallback). No backend DB, no accounts, no analytics, no third-party trackers. Everything is on-device.

These were hard product rules throughout (single file, vanilla JS, nothing new loads at startup, mobile-first 44px targets, never fabricate numbers, don't break the pricing math).

---

## 3. Deploy pipeline (important operational note)

`Edit index.html locally → commit + push via GitHub Desktop → Vercel auto-deploys`.

The build agent that produced this **cannot push to GitHub directly** from its environment, so every deploy required a human to push via GitHub Desktop on their machine. If you (Fable) can push to the repo directly, you can drop that manual step entirely — that friction is environmental, not a property of the codebase.

**Voice feature requires an env var:** `ANTHROPIC_API_KEY` must be set in Vercel → Project → Settings → Environment Variables (already configured in the live project). The key is read only server-side in `/api/structure.js` and never reaches the client.

---

## 4. File map

```
index.html        # the entire app (HTML + CSS + JS)
api/structure.js  # serverless: transcript → structured line items via Claude Haiku
sw.js             # service worker (offline shell)
HANDOFF.md        # this file
```

Inside `index.html`, roughly in order:
- `<style>` — CSS variables (dark theme, `--accent` orange), component styles, mobile-first layout, bottom nav, overlays, tooltips, animations.
- `<body>` — three views toggled by a bottom tab nav: **Calculator** (`#calcView`), **Archive** (`#archiveView`), **Settings** (`#settingsView`), plus proposal view and full-screen overlays (signature, preview, photo viewer).
- `<script src=pdf.js>` then one big inline `<script>` with all logic.

---

## 5. Calculator layout (top → bottom)

Recently reordered so inputs come first and the result is the payoff at the bottom:

1. Mode toggle (Analyze / Build) + a mode explainer line
2. Job details (name, client type, **contact name/phone/email**, benchmark trade + size)
3. 📷 Job photos (attach site pics, saved with the job)
4. 🎤 Describe the job (voice → line items)
5. 📄 Import PDF / photo (pdf.js text extraction or Tesseract OCR)
6. Line items (the costs/prices)
7. Rates (contingency, overhead, tax)
8. Cost summary (auto total)
9. 💰 Your price & profit (margin slider + 25/35/45 presets → price, break-even, net profit, **Save / Summary / Proposal**)
10. Past jobs like this (matches on trade + size)
11. Test a quote

---

## 6. Pricing math — the invariants (do not break)

- **Build-from-cost = MARKUP.** `price = roundUpTo50( trueCost × (1 + markup%) )`. The canonical test: **$1,000 cost + 10% markup = $1,100.** (The user thinks in markup; this was an explicit decision after they clarified with that exact example.)
- `trueCost = direct + materialTax + contingency`.
- **Analyze = MARGIN.** `price = sum(line items)`, `grossProfit = price × margin%`.
- **Break-even cost** (shown in Analyze) `= price × (1 − overhead%)` — the most the job can cost before it loses money. (This replaced a confusing "implied cost = price × (1 − margin)" metric the user disliked.)
- **Net profit** `= grossProfit − price × overhead%`.
- Benchmarks (`$/sf`, `$/hr` by trade, LA 2026 seed values, editable in Settings) drive over/under flags. Personal benchmarks (median of ≥3 **won** jobs in a trade) override the static table when available and are labeled as such. **The two are never blended.**
- **Never fabricate numbers.** The PDF/OCR parser and the voice parser flag ambiguous data for review rather than guessing.

Key functions: `calc()` (live recompute + DOM update), `compute(state)` (pure-ish recompute used for archive/summary), `setMode()`, `benchmarkCheck()`, `quoteCheck()`.

---

## 7. Data model & storage

- **Working estimate** auto-saves to IndexedDB key `ea_state` on every input (crash recovery). Shape (`getState()`): `{ ts, mode, jobName, clientType, contactName, contactPhone, contactEmail, benchCat, benchQty, margin, contingency, overhead, tax, proposed, photos:[dataURL], rows:[{item,desc,qty,unit}], proposal?, ... }`.
- **Archive** = array under `ea_archive`. Each entry: `{ id, state, results: compute(state), trade, size:{n,unit}, outcome:'pending|won|lost', actualCost }`. Old entries derive `trade`/`size` lazily.
- **Photos** are base64 JPEG data URLs (resized ≤1280px, quality 0.72), capped at 12/job, stored inside the job's `state`.
- **Benchmarks** editable, stored under `ea_bench` with a `updated` date.
- **Company profile** (name, logo, license, rates, tax) under `ea_profile`.
- **Backup/Restore** exports/imports the whole archive + profile + benchmarks as JSON.

Storage layer: `idbOpen/idbGet/idbSet`, in-memory `ARCH_CACHE`/`STATE_CACHE`, `saveKey()` writes IDB or falls back to localStorage. One-time migration from old localStorage keys on first load.

---

## 8. Feature inventory

Pricing engine (markup/margin, contingency/overhead/tax, break-even, net, "test a quote"); PDF import (pdf.js, incl. a nasty QuickBooks font-shift + split-glyph recovery); photo/scan OCR (Tesseract, lazy-loaded); editable benchmarks + tax; company profile + branded client proposal (cost/margin hidden from client) with Web Share + on-device finger signature; archive with search, duplicate, rename, outcomes, actual-cost, "your history" stats, personal benchmarks, similar-jobs; installable PWA + offline shell; **voice-to-estimate** (Web Speech API transcription → `/api/structure` → Haiku → reviewable line items, ambiguous items flagged); job photos; client contact fields.

---

## 9. Known issues & suggested audit focus

Be critical here — this is where the value is.

- **Single 1,400+ line file.** No modules, no tests, no linting. Everything shares one global scope. High cognitive load; easy to introduce regressions. Worth discussing whether to keep the single-file constraint or introduce a light build.
- **State ↔ DOM coupling.** `calc()` reads values straight from DOM inputs and writes results straight to DOM nodes. `compute()` is a parallel recompute from a state object. These two can drift; there's no single source of truth. A small state store + one render path would remove a class of bugs (the recently-fixed "typing loses focus" bug was exactly this — `render()` rebuilt all inputs on every keystroke).
- **Monkey-patched `render`/`setMode`.** Late in the file, `render` and `setMode` are reassigned to wrap the originals with `persist()`. Clever but surprising; a reader can miss it.
- **Base64 photos in IndexedDB.** ~33% larger than storing Blobs; cumulative archive size is the real storage risk, especially on iOS Safari (7-day eviction of non-installed PWAs). No storage-usage indicator yet.
- **No automated tests.** Verification has been manual + ad-hoc in-page JS. The pricing invariants ($1,000+10%=$1,100, etc.) are prime candidates for a tiny test harness.
- **Accessibility.** Tooltips are tap/hover with `tabindex`; number fields, contrast, and focus order deserve a real a11y pass.
- **Two modes look similar.** Analyze vs Build differ mainly in labels + math meaning; users have found this confusing. A stronger visual/behavioral distinction may help.
- **Proposal is print-to-PDF** (browser), not server-rendered.
- **Voice parser** depends on an external API key + network; failure states are handled (toast, transcript preserved) but there's no offline path.

---

## 10. Recently fixed (context for the diff)

- Reordered the calculator (inputs first, price/profit at bottom).
- Replaced "implied cost" with "break-even cost."
- **Fixed the number-field focus bug** (Qty/Unit inputs no longer re-render the list on each keystroke) and hid the number spinners.
- Added a mode explainer line, result-card heading, hover animations, clear-all trash, tooltips, job photos, and client contact fields.

---

## 11. Hard rules that shaped the build (for continuity)

Single `index.html` (+ `/api`, `sw.js`); vanilla JS only; nothing new loads on initial page open (heavy libs lazy-load); mobile-first, 44px targets; don't change the pricing math (the $1,000+10%=$1,100 test must always pass); never fabricate numbers; no accounts/cloud/analytics. After each change: math test + `node --check` on the inline script + verify zero app console errors on load.
