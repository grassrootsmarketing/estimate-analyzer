# Handoff: Job tracking + cost log + artful dashboard

This is a build spec for the next chat. The design was already reviewed and approved by David. Read `AGENTS.md` first for repo rules, then build the feature below, verify it, and push it.

## Project snapshot
- Repo: `github.com/grassrootsmarketing/estimate-analyzer` (public). Live: https://estimate-analyzer-atb.vercel.app
- Single self-contained `index.html`, vanilla JS, no build step. One serverless fn in `/api`. Service worker `sw.js`.
- Deploy: commit + push to `main` → Vercel auto-deploys in ~1 minute.
- IMPORTANT deploy note: use the **GitHub connector** (API) to commit and push. Do NOT use GitHub Desktop via screen automation — on this machine it runs elevated and Windows blocks synthetic input. The connector avoids that entirely. If the connector is available, read the local file(s) and push their content to `main`.

## Current production state (already live — do not rebuild)
- Dark mode is the default; light is a toggle (sun/moon button `#themeToggle` in the header). Theming is CSS variables on `:root` (dark) with `:root[data-theme="light"]` overrides. `applyTheme`/`toggleTheme`/`initTheme`, remembered in `localStorage` key `ea_theme`.
- Inline SVG icon system: a hidden `<svg><defs>` sprite of `<symbol id="i-NAME">` near the top of `<body>`, plus a helper `ic(name, cls)` returning `<svg class="ic ..."><use href="#i-NAME"/></svg>`. `.ic` inherits color via `stroke:currentColor`. All emoji were removed.
- Dashboard home `#dashView` (default landing) with KPI tiles + project cards via `renderDashboard()`. 4-tab bottom nav: Dashboard / Estimate / Archive / Settings, handled by `showView(name)`.
- Realm palette, silent PDF writer (`_estimatePdf` / `_mkPDF`, downloads a real `.pdf`), Project size dropdown (`#benchQty` is a `<select>`), archive rolling-30 with pin/Keep (star icon), XSS-safe restore (`safeImg`/`sanitizeEntry`), storage meter.

## Hard rules (full detail in AGENTS.md)
- Never change the pricing math in `compute()`. Run `node test/math.test.js` before every push; all invariants must pass.
- Keep it one file, no build, no framework. No external CDN runtime dependencies — must work offline. Icons are inline SVG for this reason.
- No em dashes in UI copy. Do not blind-replace dashes (the `SEED_BENCH` keys and the range regex depend on specific separators).
- Never rebuild the `#rows` container in the results-paint path (drops mobile input focus).

## Feature to build

### 1. Data model (archive entries)
Each archive entry `e` gains:
- `e.stage`: `""` | `"active"` | `"complete"` (job progress; independent of `e.outcome` won/lost).
- `e.costs`: array of `{ id, ts, cat, note, amount }`.

Changes:
- `newEntry(st)`: add `stage:""`, `costs:[]`.
- `sanitizeEntry(e)`: coerce `e.stage` to one of `"" | "active" | "complete"`; sanitize `e.costs` to an array of objects with `cat` in the allowed set, `amount` a finite number ≥ 0, `note` via `String()`, `ts` a number. Drop malformed rows.
- On `duplicate`: reset the copy's `costs` to `[]` and `stage` to `""`.
- Costs/stage live on `e`, so they are already included in Backup/export.

Helpers:
- `jobBudget(e)` = build mode: `e.results.trueCost`; analyze mode: `e.results.breakeven != null ? e.results.breakeven : e.results.impliedCost`.
- `jobSpent(e)` = sum of `e.costs[].amount`.
- `jobProfitToDate(e)` = `e.results.price - jobSpent(e)`.

Cost categories (order): Materials, Labor, Subcontractor, Equipment/rental, Permits/fees, Other.

### 2. Job page — new view `#jobView`, opened by `openJob(id)`
Layout (dark theme, matches the approved mockup):
- Back row (`‹ Jobs`) → `showView('dash')`.
- Header: job name (20px/500); sub line `client type · started {date}`; a status pill + control on the right that cycles/sets `e.stage`: **In progress** (green pill) / **Complete** (muted/checked) / **Reopen**. Persist with `setArchive`.
- Budget hero card:
  - Big **Spent** `fmt(jobSpent)` vs right-aligned **Budget** `fmt(jobBudget)`.
  - Progress bar = spent/budget. Fill color: green (`--good`) when ≤ 85%, amber (`--warn`) 85–100%, red (`--bad`) > 100%. Cap bar width at 100%.
  - Caption: `"{pct}% of budget used · {fmt(remaining)} remaining"` (remaining can go negative → "over budget").
  - Divider, then two stats: **Bid price** `fmt(e.results.price)` and **Profit to date** `fmt(jobProfitToDate)` (green if ≥ 0, red if < 0).
- Cost log:
  - Section header "Cost log" + an **Add cost** button (gold). Opens an inline form: category `<select>`, amount `<input inputmode=decimal>`, note `<input>`, and an Add button. On add: push `{id:"c"+Date.now(), ts:Date.now(), cat, note, amount:parseFloat}` to `e.costs`, persist, re-render.
  - List grouped by category (only categories with entries), each group a card: header row `icon + category` left, `subtotal` right; then entry rows `note · {short date}` left, `fmt(amount)` right. Tap an entry to delete (confirm), persist, re-render.
  - Empty state when no costs logged yet.
- "Edit estimate" link/button → `applyState(e.state); showView('calc')`.

### 3. Artful dashboard (rewrite `renderDashboard`)
Restructure `#dashView` to a single container `<div id="dashBody"></div>` and build everything in `renderDashboard()` (remove the old static `#dashKpis`/`#dashProjects`/`.dash-hero` children and the static `dashNew`/`dashAll` listeners — re-wire after building innerHTML). Bento layout, all charts hand-drawn inline SVG/CSS (no libraries):
- Greeting header: date line + "Good {morning/afternoon/evening}, David" + a `+ New estimate` icon button → `showView('calc')`.
- **Hero pipeline card** (full width): "Pipeline" label, big `fmt(sum of e.results.price)`, and a bar chart of the last ~8 jobs' prices (bars scaled to the max; most-recent bar highlighted in `--accent2` green, others a dim green). Optional small trend chip; omit if there's no real trend data.
- **Bento row** (2 cols):
  - Win-rate donut (SVG): `circle r=36` track `--panel2`, arc `--accent2`, `stroke-dasharray="226.2"`, `stroke-dashoffset = 226.2*(1 - winRate/100)`, rotate -90. Center text `{winRate}%`; sub `"{won} of {decided} won"`.
  - Avg-margin tile: big `{avgMargin}%` (green) + a mini distribution bar (counts in margin bands under 20 / 20–35 / over 35 as small bars).
- **In-progress section**: entries where `e.stage === "active"`. Each row: name + `"{fmt(spent)} / {fmt(budget)}"` + a thin progress bar (green/amber/red as above). Tap → `openJob(e.id)`. Hide the whole section if none active.
- **Recent list**: last ~5 saved jobs as bordered rows (name + `client · date` | `fmt(price)` + `{margin}%`), a "View all" → `showView('archive')`. Tap a row → `openJob(e.id)`.
- Empty state when there are no saved jobs.

### 4. Wiring
- `showView(name)`: add `"job"` to the toggled view list `["dash","calc","archive","settings","proposal","job"]`. Keep nav active state on Dashboard while in the job sub-view (or none). Do not add a 5th bottom-nav tab.
- Tapping a job on the dashboard opens `openJob(id)`. In the Archive list, keep the existing **Load** (direct calculator edit); optionally add an **Open** action that calls `openJob(id)`.
- New icons to add to the sprite if missing (Lucide-style stroke paths, no stroke/fill attributes on the paths — they inherit from `.ic`): `i-chevron-left`, `i-package` (materials), `i-users` (labor), `i-tool` (subs), `i-bolt` (equipment), `i-receipt` or `i-file-dollar` (permits/fees/other), `i-trending-up`, `i-progress` (or reuse `i-circle`), `i-check`.

### 5. Verify before pushing
1. `node test/math.test.js` → all invariants pass.
2. Extract the inline `<script>` and `node --check` it (syntax).
3. Grep that every `href="#i-…"` / `ic("…")` literal resolves to a defined `<symbol id="i-…">`.
4. After deploy, live-probe: `openJob` opens a job, adding/deleting a cost persists and updates the hero, the dashboard renders (pipeline bars, win ring, in-progress bars), both pricing modes still compute ($1,000 + 10% = $1,100; analyze $10,000 @ 45%/12% → break-even $8,800, net $3,300).

## Design tokens (approved dark look)
- Surfaces: `--bg:#0f1311`, `--panel:#171d19`, `--panel2:#1d251f`, `--line:#2b342d`.
- Text: `--ink:#eef2ec`, `--muted:#9aa89c`.
- Accents: gold `--accent:#f1c14e` (text on gold `--primink:#241a05`); green `--accent2:#5cc98d`.
- Semantic tints: good `--goodbg:#14271e` / `--goodbd:#2c5540` / `--goodink:#8fe0b4`; warn `--warnbg:#2a2410` / `--warnbd:#57491d` / `--warnink:#f0d68a`; bad `--bad:#f0836b` / `--badbg:#2c1a16` / `--badbd:#5e342b` / `--badink:#f3b3a4`.
- Radii: cards 16–18px, tiles 14–15px, pills 20px. All shadows subtle. Two font weights: 400 and 500. Sentence case, no em dashes, no emoji.
- The light theme mirrors these via `[data-theme="light"]` — every new component must use the CSS variables (never hardcode a hex) so it works in both themes.

## Files
- `index.html` — the app (all edits happen here).
- `test/math.test.js` — pricing invariants (run before every push).
- `AGENTS.md`, `HANDOFF.md`, `CODEX-HANDOFF.md` — background and rules.
