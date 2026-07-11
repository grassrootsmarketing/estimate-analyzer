# Estimate Analyzer — Handoff & Audit Brief

_Written for a UX + code audit (Fable). Candid about the current state, not a sales pitch. Last updated after the "Build-from-cost default + save indicator + robustness" round._

---

## 1. What this is

A phone-first pricing tool for a **Los Angeles general contractor** (homeowners → small apartment/commercial). It turns a job's costs into a defensible price, guards against underpricing, remembers past jobs (with photos + client contact), and generates a client-facing proposal.

- **Live:** https://estimate-analyzer-atb.vercel.app
- **Repo:** github.com/grassrootsmarketing/estimate-analyzer
- **Primary surface:** mobile, one-handed, ~390px. Desktop is secondary.

**Two modes (this distinction is the #1 source of user confusion — see §9):**
- **Build from cost** (now the DEFAULT): you enter your raw costs; the app adds your **markup** and sets the price. `$1,000 cost + 10% = $1,100`. Sliding the markup moves the total. This is the main workflow.
- **Analyze a bid**: the numbers are treated as a *finished bid* with margin already baked in; it decomposes into break-even cost, profit, and margin. The price is fixed (equal to what you entered), so sliding the margin only re-interprets it. This mode is mainly the **PDF-import path** — importing a priced estimate auto-switches here.

---

## 2. Stack & constraints

- **One self-contained `index.html`** — all HTML, CSS, vanilla JS in a single file (~1,450 lines / ~69 KB). No framework, no build step, no bundler, no npm.
- **One serverless function** — `/api/structure.js` (CommonJS, Vercel Node runtime) for voice-to-estimate. The only code outside `index.html`.
- **`sw.js`** — minimal service worker (offline shell cache + PWA install).
- **Hosting:** Vercel, auto-deploys from `main`.
- **Storage:** IndexedDB with an in-memory cache and a **localStorage fallback**. No backend DB, no accounts, no analytics, no third-party trackers. Everything is on-device.

Hard product rules honored throughout: single file, vanilla JS, nothing new loads at startup (heavy libs lazy-load), mobile-first 44px targets, never fabricate numbers, never break the pricing math.

---

## 3. Deploy pipeline (operational note)

`Edit index.html locally → commit + push via GitHub Desktop → Vercel auto-deploys`.

The build agent that produced this **could not push to GitHub directly**, so every deploy needed a human to push via GitHub Desktop. **If Fable can push to the repo directly, that manual step disappears** — the friction was environmental, not a property of the code.

**Voice feature env var:** `ANTHROPIC_API_KEY` must be set in Vercel → Project → Settings → Environment Variables (already configured on the live project). The key is read only server-side in `/api/structure.js`; it never reaches the client.

---

## 4. File map

```
index.html        # the entire app (HTML + CSS + JS)
api/structure.js  # serverless: transcript → structured line items via Claude Haiku
sw.js             # service worker (offline shell)
HANDOFF.md        # this file
```

---

## 5. Calculator layout (top → bottom, current)

Reordered so inputs/costs are on top and the priced result is the payoff at the bottom:

1. **Mode toggle** (Build from cost / Analyze a bid) + a one-line explainer that changes with the mode
2. **Job details** — name, client type, **contact name / phone / email**, benchmark trade + size
3. **📷 Job photos** — attach site pics (saved with the job)
4. **🎤 Describe the job** — voice → line items
5. **📄 Import PDF / photo** — pdf.js text extraction or Tesseract OCR (auto-switches to Analyze mode)
6. **Line items** — the costs
7. **Rates** — contingency, overhead, tax (all default to 0)
8. **Cost summary** — auto total
9. **💰 Your price & profit** — markup slider + 25/35/45 presets → price, break-even, net profit, and **Save / Summary / Create proposal**, plus an inline **"Test a different price"** field and a **saved/unsaved status line**
10. **Past jobs like this** — matches on trade + size

---

## 6. Pricing math — invariants (do not break)

- **Build-from-cost = MARKUP.** `price = roundUpTo50( trueCost × (1 + markup%) )`. Canonical test: **$1,000 + 10% = $1,100.** The user thinks in markup (explicit decision).
- `trueCost = direct + materialTax + contingency`.
- **Analyze = MARGIN.** `price = sum(line items)`; `grossProfit = price × margin%`.
- **Break-even cost** (Analyze) `= price × (1 − overhead%)` — the most the job can cost before it loses money. (Replaced a confusing "implied cost = price × (1 − margin)" the user disliked.)
- **Break-even (floor)** (Build) `= trueCost / (1 − overhead%)` — price below which you lose money.
- **Net profit** `= grossProfit − price × overhead%`.
- Benchmarks (`$/sf`, `$/hr` by trade; LA-2026 seed, editable in Settings) drive over/under flags. **Personal benchmarks** (median of ≥3 *won* jobs in a trade) override the static table when available and are labeled as such — **never blended**.
- **Never fabricate numbers.** The PDF/OCR parser and the voice parser flag ambiguous data for review instead of guessing.

Key functions: `calc()` (live recompute + DOM write), `compute(state)` (parallel recompute used for archive/summary), `setMode()`, `benchmarkCheck()`, `quoteCheck()` (the "test a price" logic; now runs in both modes).

---

## 7. Data model & storage

- **Working estimate** auto-saves to IndexedDB key `ea_state` on every input (crash recovery). Shape (`getState()`): `{ ts, mode, jobName, clientType, contactName, contactPhone, contactEmail, benchCat, benchQty, margin, contingency, overhead, tax, proposed, photos:[dataURL], rows:[{item,desc,qty,unit}], proposal? }`.
- **Archive** = array under `ea_archive`. Each entry: `{ id, state, results: compute(state), trade, size:{n,unit}, outcome:'pending|won|lost', actualCost }`. Old entries derive `trade`/`size` lazily.
- **Photos**: base64 JPEG data URLs, resized ≤1280px @ 0.72 quality, capped at 12/job, stored inside the job's `state`.
- **Benchmarks** under `ea_bench` (with `updated` date); **profile** under `ea_profile`.
- **Backup/Restore** exports/imports archive + profile + benchmarks as one JSON file.
- **Save indicator**: a lightweight signature (`stateSig()`, excludes photo blobs) compares the current estimate to the last saved snapshot to show saved / unsaved / not-yet-saved.

Storage layer: `idbOpen/idbGet/idbSet`, in-memory `ARCH_CACHE`/`STATE_CACHE`, `saveKey()` writes IDB or falls back to localStorage. One-time localStorage→IDB migration on first load. **`idbOpen` now has an `onblocked` handler + 2.5s timeout** so a blocked/slow DB can never hang boot (it falls back to localStorage).

---

## 8. Feature inventory

Pricing engine (markup/margin, contingency/overhead/tax, break-even, net, inline "test a price"); PDF import (pdf.js, incl. QuickBooks font-shift + split-glyph recovery); photo/scan OCR (Tesseract, lazy-loaded); editable benchmarks + tax; company profile + branded client proposal (cost/margin hidden from client) with Web Share + on-device finger signature; archive with search, duplicate, rename, outcomes, actual-cost, "your history" stats, personal benchmarks, similar-jobs, **client contact fields**, **job photos**; installable PWA + offline shell; **voice-to-estimate** (Web Speech API → `/api/structure` → Haiku → reviewable line items, ambiguous items flagged); **saved/unsaved indicator**.

---

## 9. Known issues & where the audit should focus

This is the useful part. Be critical here.

- **No single source of truth (highest-value refactor).** `calc()` reads values straight from DOM inputs and writes results straight to DOM nodes; `compute()` is a *parallel* recompute from a state object. They can drift. This coupling directly caused a shipped bug where typing in Qty/Unit re-rendered the whole list and destroyed the input's focus (you could only enter one digit at a time). Fixed by not re-rendering on numeric input — but the underlying architecture invites this class of bug. A small state store + one render path would remove it.
- **Single ~1,450-line file, no modules, no tests, no linting.** One global scope. High cognitive load. Worth deciding whether to keep the single-file constraint or introduce a light build + a tiny test harness for the pricing invariants ($1,000+10%=$1,100, break-even, markup↔margin).
- **Two modes look/behave similarly and confuse users.** Both are "type numbers into line items"; the difference is *interpretation* (costs vs finished bid) and whether the total moves with the slider. Mitigated with a mode explainer line and by defaulting to Build-from-cost, but a stronger visual/behavioral distinction (or collapsing Analyze into the PDF-import flow entirely) is worth exploring.
- **Boot depends on async IndexedDB.** Just hardened against hangs (timeout/onblocked), but the boot sequence is a long `async` IIFE where an early failure skips later setup. Consider making label/state defaults render-first and hydrate after, so the UI is never dependent on storage timing. (The HTML now ships Build-from-cost labels as defaults precisely to de-risk this.)
- **Base64 photos in IndexedDB.** ~33% larger than Blobs. Per-job cap is 12; the real risk is cumulative archive size on iOS Safari (7-day eviction of non-installed PWAs). No storage-usage indicator yet.
- **Accessibility.** Tooltips are tap/hover via `tabindex`; number fields, color contrast, focus order, and screen-reader labeling all deserve a real pass.
- **Proposal is print-to-PDF** (browser), not server-rendered.
- **Monkey-patched `render`/`setMode`.** Late in the file they're reassigned to wrap the originals with `persist()`. Works, but surprising to a reader.
- **Voice parser** needs the external API key + network; failure states are handled (toast, transcript preserved), but there's no offline path.

---

## 10. Recent changes (context for the diff / what NOT to "re-fix")

- **Default mode flipped to Build-from-cost**; Analyze is now the PDF-import path. HTML labels default to Build-from-cost so the correct state paints regardless of boot timing.
- **Contingency / overhead / tax now default to 0** (raw numbers first).
- **"Implied cost" replaced with "Break-even cost"** in Analyze.
- **"Test a quote" merged into the Price & Profit card** and now works in both modes (it was dead in Analyze before).
- **Number fields**: fixed focus loss on typing; removed spinner arrows.
- **Added**: job photos, client contact fields, saved/unsaved indicator, mode explainer line, tooltips, hover animations, clear-all trash, price-card heading.
- **Hardened `idbOpen`** so a blocked DB can't freeze the app at load.

---

## 11. Hard rules that shaped the build (for continuity)

Single `index.html` (+ `/api`, `sw.js`); vanilla JS only; nothing new loads on initial page open (heavy libs lazy-load); mobile-first, 44px targets; don't change the pricing math (the $1,000+10%=$1,100 test must always pass); never fabricate numbers; no accounts/cloud/analytics. After each change: math test + `node --check` on the inline script + verify zero app console errors on load.
