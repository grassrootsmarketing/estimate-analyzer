# AGENTS.md

Operating guide for AI coding agents (Codex and similar) working in this repo.
Codex loads this file automatically. Read it fully before making changes.

## What this is

Homestead (renamed from Estimate Analyzer) is a phone-first operations app for a
Los Angeles general contractor. It helps price a job two ways:

- **Build mode (from cost):** enter your costs, get a recommended price from a markup.
- **Analyze mode:** enter a bid you already have, see the margin and break-even baked into it.

It is a Progressive Web App: installable, works offline, stores everything on the
user's own device. Live at https://estimate-analyzer-atb.vercel.app

## Golden rules (do not violate)

1. **Never change the pricing math.** The formulas in `compute()` are the product.
   Any change that alters a documented result is a regression. See "Pricing model" below.
2. **Run all six test suites before every commit:** math, pm, api, backup,
   lead, and portal (`node test/<name>.test.js`; `npm install` once for the
   @vercel/blob suites). portal.test.js includes the REDACTION test: a client
   portal snapshot must never contain costs, margins, or internal notes. Do
   not push until all pass.
3. **No em dashes in user-facing copy.** Use commas, parentheses, or "to". This is a
   house style rule and it also protects a few load-bearing characters (see "Protected code").
4. **Keep it a single file with no build step.** All HTML, CSS, and JS live in
   `index.html`. Do not introduce a bundler, framework, npm dependency, or build
   pipeline. The no-build constraint is deliberate: it keeps deploys trivial.
5. **Do not add external runtime dependencies or CDN script tags.** The app must
   work offline on a jobsite with no signal. Anything loaded from a third-party CDN
   can be blocked or unreachable and will hang. Prefer dependency-free code. (The
   PDF export was deliberately written by hand for this reason.)
6. **Never touch `#rows` in the results-painting path.** Rewriting that container
   while the user types destroys input focus on mobile. See "Gotchas".
7. **The rebrand to Homestead was cosmetic only. Never rename identifiers.**
   The product name changed; the plumbing did not. These strings are load-bearing,
   and renaming any of them silently destroys live user data or breaks live links:
   - localStorage / IndexedDB keys (`ea_state`, `ea_archive`, `ea_profile`,
     `ea_theme`, and friends). Renaming orphans every saved estimate on the device.
   - Cloud sync derivations (the `ea-sync-v1` salt, the `ea-sync-id-v1` id prefix)
     and the `ea-backups/` blob prefix. Renaming makes existing sync codes restore
     nothing.
   - The `ea-lead-id-v1` inbox derivation and the `leads/` prefix. Renaming kills
     every request link already handed out.
   - The `estimate-analyzer-atb.vercel.app` hostnames in every `hostAllowed()`.
     That is the real deployment origin; changing it 403s the whole API.
   If the deployment is ever renamed, the host allowlist, every shared request
   link, and every published portal token move together. Treat that as its own
   project, not a find-and-replace.

8. **The display face ships one weight. Never ask it for bold.** `--dfont` is
   Instrument Serif, vendored at 400 and nothing else. Any rule that sets a weight
   above 400 on a `--dfont` element makes the browser synthesise a fake bold, which
   smears the letterforms at exactly the sizes the serif is used at. If a headline
   needs more presence, increase the size, not the weight. The sans (`--numfont`,
   Inter) is vendored at 400/500/600/700; 800 and 900 are safe there only because
   font matching falls back to 700 rather than synthesising. This rule already
   caught the app once: the forest build set 700 on four display selectors, and
   they all had to be walked back to 400 during the Homestead retheme.

9. **`--accent` and `--accent2` are not interchangeable.** `--accent` is a fill
   colour (clay #D97757). `--accent2` is a text colour, and on bone it runs deeper
   (#A8492A) because clay on bone is about 2.9:1 and will not carry small type.
   Swapping them produces text that looks fine on a dark screen in a review and
   fails in daylight on a phone, which is where this app actually gets used.

## Run, test, deploy

- **Run locally:** open `index.html` in a browser, or serve the folder statically
  (e.g. `npx serve`). No install step.
- **Test:** all six suites in `test/` (math, pm, api, backup, lead, portal)
  are required before every commit; run `npm install` once first.
- **Deploy:** Vercel auto-deploys the `main` branch. Push to `main` and the live
  site updates in about a minute. There is no manual deploy step.
- **Deploy from a Cowork session:** commit through the github.com web UI via the
  Claude in Chrome extension (the repo's `/upload/main` page, commit directly to
  main). The claude.ai GitHub Integration does not attach git credentials to
  Cowork cloud sandboxes, so `git push` fails there. Never automate GitHub
  Desktop; it runs elevated and Windows blocks synthetic input.
- **Serverless:** `/api/structure` is a Vercel serverless function used by the
  voice-to-estimate feature. It is optional to the core calculator.

## Architecture and file map

- `index.html` — the entire app. HTML, CSS, and vanilla JS in one file.
- `sw.js` — service worker. Network-first for page navigations (so new deploys flow),
  cache-first for same-origin assets, and it intentionally ignores cross-origin and
  non-GET requests. Do not make it intercept cross-origin traffic.
- `manifest.json` — PWA manifest (name, icons, standalone display).
- `icons/` — PWA app icons including a maskable icon, plus `apple-touch-icon`.
- `api/` — Vercel serverless function(s), e.g. `structure` for voice parsing.
- `test/math.test.js` — zero-dependency pricing test. Extracts `compute` and
  `roundUp` from `index.html` by brace-matching and asserts the invariants.
- `test/pm.test.js` — zero-dependency project-management test (lifecycle,
  pruning, unknown-vs-zero tracking, cents-exact money, receivables, change
  orders, sanitization). Same extraction approach; run it with the math test.
- `test/api.test.js` — zero-dependency guard test for `/api/structure` (origin
  allowlist, burst and daily rate limits, payload checks, output clamps). It
  requires the module directly with mocked req/res; no network is touched.
- `test/backup.test.js` — cloud-sync test: client crypto pipeline (PBKDF2 +
  AES-GCM roundtrip, merge rules) extracted from index.html, plus /api/backup
  guard rails with mocked req/res. No network. Needs `npm install` once.
- `api/portal.js` + `portal.html` — read-only client portal. The owner's app
  publishes a snapshot built by portalSnapshot() (client-safe fields only;
  costs/margins structurally excluded) to a random 128-bit token. Republishes
  automatically ~15s after job changes via schedulePortalPublish().
- `api/lead.js` + `request.html` — public estimate-request intake. The share
  link carries only sha256(lead code); submitting needs the link, reading or
  clearing the inbox needs the raw code (owner's device only). Honeypot +
  strict rate limits; leads import into the Jobs board as the Leads stage.
- `api/backup.js` + `package.json` — encrypted cloud backup on Vercel Blob
  (@vercel/blob is a server-side dependency only; the client stays
  zero-dependency). Requires a Blob store connected to the Vercel project
  (env BLOB_READ_WRITE_TOKEN). The server stores only AES-GCM ciphertext at a
  path derived from SHA-256 of the user's sync code; it can never read backups.
- `README.md`, `HANDOFF.md`, `AUDIT.md` — background docs. HANDOFF.md has the
  deepest architecture and data-model notes.

## Pricing model (the invariants the test guards)

`compute(state)` is the single source of truth for all pricing math. `calc()` is a
thin pipeline: `getState()` then `compute()` then `paintResults()`. `paintResults()`
only writes result fields and never rebuilds the line-item inputs.

**Build mode (from cost):**
- `trueCost = direct + materialTax + contingency`
  (material tax applies only to Materials lines; contingency is applied on the
  direct-plus-tax base).
- `price = roundUpTo50( trueCost * (1 + markup%) )`
- `breakeven = trueCost / (1 - overhead%)`
- Canonical check: **$1,000 cost + 10% markup = $1,100.**
- Markup is not margin: a 10% markup on $1,000 is a 9.09% gross margin.

**Analyze mode:**
- `price = sum(line items)`
- `breakeven = price * (1 - overhead%)`
- `grossProfit = price * margin%`
- `net = grossProfit - price * overhead%`
- Canonical check: $10,000 at 45% margin and 12% overhead gives break-even $8,800
  and net $3,300.

If you need to change presentation of these numbers, do it in `paintResults()` or the
document/PDF builders, never in `compute()`.

## Data and storage model

- Primary store is **IndexedDB**, with a **localStorage fallback** if IndexedDB is
  blocked or times out. In-memory caches (`ARCH_CACHE`, `STATE_CACHE`) mirror the data.
- Working state autosaves so a crash or refresh recovers the current estimate.
- **Archive** keeps a rolling history of saved jobs, capped at `HISTORY_CAP` (30).
  Entries can be **pinned** to survive the cap, or deleted manually. Pruning is
  applied on save, not on restore.
- Persistence caveat worth knowing: on iOS Safari, script-writable storage is
  evicted after 7 days of no visits unless the app is installed to the Home Screen.
  Backup (Archive tab) exports a JSON file as the durable, portable copy.

## Security invariants

- `safeImg(v)` returns a value only if it starts with `data:image/`; it is applied to
  every image `src` (company logo, signature, photos). This blocks `onerror=` and
  `javascript:` payloads that could arrive through a restored backup.
- `esc()` HTML-escapes any user or benchmark text written via `innerHTML`.
- Restored backups are validated and sanitized (non-image photos dropped, photo count
  capped, row fields coerced, logo passed through `safeImg`). Keep this validation if
  you touch restore.

## Protected code (do not touch without care)

These use characters or patterns that look cosmetic but are functional:

- `SEED_BENCH` keys such as `"Flooring - tile (per sf)"` — the separators are parsed.
- The range-detection regex `(?:-|to)` variants and the `deriveMeta` separator check.
- Because of the above, do not run a blind find-and-replace on dashes across the file.
  A copy-only em-dash sweep is fine if it skips these.

## What is already implemented (recent state)

- Two modes (Build from cost, Analyze a bid) with mode-aware layout.
- Voice-to-estimate via `/api/structure`, with a review flag on parsed lines and a
  guard that warns before saving lines still flagged for review.
- PDF export written by hand (no libraries): `_mkPDF()` assembles the PDF, `_estimatePdf()`
  lays out the summary. The summary downloads silently as a real `.pdf`. The branded
  client proposal uses the browser's print-to-PDF path (it carries the logo/letterhead).
- Project size is a dropdown (`#benchQty` select: 1,000 through 100,000) feeding the
  per-unit benchmark check.
- Desktop two-column layout above 900px (results column is sticky); mobile stays single
  column. Custom hollow dark-green margin slider on a cream track.
- Installable PWA with real app icons and a maskable icon; offline shell via `sw.js`.
- Company profile and branded proposal; on-site signature capture; editable benchmarks
  and tax rate; personal/past-job benchmarks.
- Boot resilience (each storage load is isolated) and a storage-usage meter in Settings.

## Gotchas

- **Focus loss on mobile:** any code that rewrites the `#rows` container while typing
  will drop the input's focus. Results painting must not rebuild inputs.
- **Offline first:** do not reach for a CDN. A blocked CDN request hangs with no error.
  If you truly need a library, vendor it into the repo so it is same-origin and cached.
- **Service worker caching:** after a deploy, navigations are network-first so users
  get fresh HTML, but same-origin assets are cache-first. Bump the cache name in
  `sw.js` if you change a cached asset's contents under the same path.
- **Test extraction is brace-based:** `test/math.test.js` finds `compute` and `roundUp`
  by name and matches braces. Keep those as normal named function declarations.

## Where to look

- Pricing: `compute()`. Rendering results: `paintResults()`. Orchestration: `calc()`.
- Summary and PDF: `buildSummary()`, `_estimatePdf()`, `_mkPDF()`, `downloadSummary()`.
- Proposal: `buildProposal()` / `openProposalWindow()`.
- Archive and backup: the save, prune (`pruneArchive`), restore, and export handlers.
- Storage: `idbOpen()` and the load/persist helpers, with the localStorage fallback.
