# Handoff: Project management, the "Jobs" tab

> STATUS: Shipped Jul 25, 2026 together with the data-integrity hardening supplement
> (CODEX-TO-CLAUDE-JOBS-HARDENING-HANDOFF). Where the two documents differ, the shipped
> behavior follows the hardening rules: edit-in-place identity, managed-job retention,
> unknown-vs-zero tracking, explicit lifecycle actions, cents-exact money, receivables
> ledger, durable CO approval. See test/pm.test.js for the enforced invariants.

Build spec for the next feature. Scope and design were approved by David on Jul 25, 2026: full PM scope (tasks and punch lists, schedule and dates, payment milestones, change orders), a new 5th bottom-nav tab called **Jobs**, pipeline board as the main view. Read `AGENTS.md` first for repo rules. This builds directly on the job tracking feature (stage, costs, `#jobView`, bento dashboard) that shipped in commit `c25592a`.

## Project snapshot
- Repo: `github.com/grassrootsmarketing/estimate-analyzer` (public). Live: https://estimate-analyzer-atb.vercel.app
- Single self-contained `index.html`, vanilla JS, no build step. Vercel auto-deploys `main` in about a minute.
- Deploy note (updated Jul 2026): from a Cowork session, push via the **github.com web UI through the Claude in Chrome extension** (upload page at `/upload/main`, commit directly to main). The claude.ai "GitHub Integration" does not attach credentials to Cowork cloud sessions, so `git push` from the sandbox fails. Do not automate GitHub Desktop; it runs elevated and Windows blocks synthetic input.

## Current production state (do not rebuild)
- Archive entries `e` already have: `id, state, results, trade, size, outcome ("pending"|"won"|"lost"), actualCost, pinned, stage ("" | "active" | "complete"), costs[]`.
- Helpers already exist: `jobBudget(e)`, `jobSpent(e)`, `jobProfitToDate(e)`, `barTone(pct)`, `entryPrice(e)`, `COST_CATS`, `jobById(id)`, `openJob(id)`, `renderJob()`, `setStage(st)`, `CUR_JOB`.
- Views: `#dashView > #dashBody` (bento dashboard, `renderDashboard()`), `#jobView > #jobBody` (job page: status pills, budget hero, cost log, edit estimate), `#archiveView`, `#calcView`, `#settingsView`, `#proposalView`.
- `showView(name)` toggles `["dash","calc","archive","settings","proposal","job"]`; nav Dashboard stays active for `"job"`.
- Icon sprite includes: chevron-left, package, users, tool, bolt, receipt, trending-up, check, plus the original set. `ic(name, cls)` helper. `.ic` inherits `stroke:currentColor`.
- `sanitizeEntry(e)` coerces `stage` and `costs`; keep extending it for every new field.

## Hard rules (full detail in AGENTS.md)
- Never change the pricing math in `compute()`. Change orders and payments are a PM layer on top; they must not alter `compute()` or its outputs. Run `node test/math.test.js` before every push.
- One file, no build, no framework, no CDN runtime deps. Charts and boards are hand-drawn inline SVG/CSS.
- No em dashes in UI copy. Do not blind-replace dashes (SEED_BENCH keys, range regex).
- Never rebuild `#rows` in the results-paint path.
- Every new component uses CSS variables (both themes must work). Two font weights, 400 and 500, for new components. Cards 16 to 18px radius, pills 20px.

## Data model (all on the archive entry `e`, so Backup/Restore carries it automatically)

New fields, all optional on legacy entries:
- `e.tasks`: array of `{ id, ts, title, due, done, doneTs }`. `due` is `"YYYY-MM-DD"` or `""`. `done` boolean, `doneTs` number or null.
- `e.sched`: `{ start, target }`, both `"YYYY-MM-DD"` or `""`.
- `e.draws`: array of `{ id, ts, label, amount, status }`, `status` in `"planned" | "invoiced" | "paid"`.
- `e.changes`: array of `{ id, ts, title, amount, cost, status }`, `status` in `"pending" | "approved"`. `amount` is the price to the client; `cost` is the estimated cost impact (0 if unknown).

`sanitizeEntry` additions: coerce each array like `costs` is handled today (drop malformed rows, `String()` text fields, finite numbers >= 0 for `amount`/`cost`, whitelist `status` values, dates validated against `/^\d{4}-\d{2}-\d{2}$/` else `""`). On `duplicate` (which already goes through `newEntry`), all four reset to empty. Add the empty defaults to `newEntry`.

Derived helpers (new, pure functions next to `jobBudget`):
- `approvedChanges(e)` = `e.changes` filtered to `status==="approved"`.
- `contractPrice(e)` = `entryPrice(e) + sum(approvedChanges amount)`. This is the client-facing value everywhere in the PM layer.
- `jobBudgetAdj(e)` = `jobBudget(e) + sum(approvedChanges cost)`. Use this (not `jobBudget`) for the spend bar and remaining caption on the job page and dashboard, so approved COs raise the budget instead of showing false overruns.
- `jobProfitToDate(e)` becomes `contractPrice(e) - jobSpent(e)` (update the existing helper; it is display-only, not pricing math).
- `drawsPaid(e)`, `drawsInvoiced(e)` = sums by status. `outstanding(e)` = `contractPrice(e) - drawsPaid(e)`.
- `nextTask(e)` = first not-done task sorted by (has due first, earliest due, then insertion order), or null.
- `boardStage(e)`: `"complete"` if `e.stage==="complete"`; `"active"` if `e.stage==="active"`; `"upnext"` if `outcome==="won"`; `"bidding"` if `outcome==="pending"`; `null` for lost (lost jobs never appear on the board).

## The Jobs tab: `#jobsView > #jobsBody`, `renderJobs()`

Pipeline board, phone-first stacked sections (not horizontal kanban). Section order and card contents:

1. **In progress** (`boardStage==="active"`): richest cards. Name; client; spend bar (`jobBudgetAdj`, barTone colors, capped 100%); `fmt(spent) / fmt(budgetAdj)`; next task line `ic("check") + nextTask title (+ "due {short date}", red if past due)` or "No tasks yet"; if target date set and past: "past target" chip in `--badink`.
2. **Up next** (`won`, stage `""`): name, client, `fmt(contractPrice)`; start date if set ("starts {short date}") else a muted "set start date" hint. A "Start job" pill on the card sets `stage="active"` directly (persist + re-render).
3. **Bidding** (`outcome==="pending"`): name, client, `fmt(price)`, days since saved ("bid 12 days ago", turns `--warnink` past 14 days, matching the outcome-prompt threshold). Tapping the outcome chip is not needed here; keep it simple, tap opens the job.
4. **Recently completed** (`stage==="complete"`, newest 5): compact rows: name, profit (`green/red`), completed date if known (max doneTs/paid ts fallback: just show saved date).

Section headers use the `.bsect` style. Each section hides when empty. If the whole board is empty, one `.dash-empty` card: "No jobs yet. Estimates you save show up here as bids you can win, schedule, and track."

Every card is a button opening `openJob(e.id)`. Reuse `.iprow`/`.brrow` card styles where they fit; add a `.pipecard` variant only if needed.

Top of the tab: a compact 3-stat strip (reuse `.bgrid`-like tiles or a single row): Outstanding `fmt(sum outstanding across active+complete jobs)`, In progress count, Bids waiting count. Skip any stat that is zero-noise; keep this strip to one row.

## Job page additions (extend `renderJob()`, keep existing hero and cost log)

Order on the page: header (existing), budget hero (existing, switch to `jobBudgetAdj` + `contractPrice` in the stats: rename "Bid price" stat to "Contract" when there are approved COs, else keep "Bid price"), then these new sections, then the cost log, then Edit estimate.

1. **Schedule row**: one slim card: `start date` and `target date` as two `<input type="date">` fields (they follow theme via CSS variables; style minimally). Persist on change. Show "{n} days to target" or "{n} days past target" caption when both/target set.
2. **Tasks**: section header "Tasks" + count "3 of 8 done" + gold "Add task" pill (same `.addcost` style). Inline add form: title input + optional date input + Add. Task rows: tap the leading circle (`ic("circle")` / `ic("check-circle")` in `--accent2`) to toggle done (persist, re-render); title struck/muted when done; due date right-aligned, `--badink` when overdue and not done. Long-press is not a thing here; deleting a task: small x button on the row end (confirm). A "Punch list" quick-add button seeds common tasks (`Demo`, `Rough-in`, `Inspection scheduled`, `Finish work`, `Punch list walk`, `Final payment collected`) skipping titles that already exist.
3. **Payments**: header "Payments" + "Add draw" pill. Summary line: mini bar of paid vs contract (`--accent2` fill on `--panel2`), caption "{fmt(paid)} collected of {fmt(contract)} · {fmt(outstanding)} outstanding". Draw rows: label + amount + a status chip that cycles planned → invoiced → paid on tap (chip styles: planned muted, invoiced `--warn*` tints, paid `--good*` tints). Delete via confirm on a small x. A "Seed from deposit" helper: if `e.state.proposal.deposit` exists and draws are empty, offer one tap to create "Deposit {pct}%" and "Balance" rows.
4. **Change orders**: header "Change orders" + "Add CO" pill. Form: title, client price (amount), cost impact (optional), Add (created as `pending`). Rows: title + `fmt(amount)` + status chip pending/approved, tap to toggle. Approved COs immediately raise the hero's budget and contract figures. Show a one-line caption under the section when any approved: "Contract adjusted by {fmt(total)} across {n} change orders".

All new sections are cards in the existing `.jcard`/`.cgroup` visual family. Keep each section's list collapsed logic simple: render everything; these lists are short in practice.

## Dashboard touch-ups (small, do not redesign)
- In-progress rows on the dashboard: append the next-task line under the bar (same data as the Jobs tab card).
- The dashboard "In progress" section header gains a "View all" link to `showView('jobs')`.

## Wiring
- Nav: add a 5th button `#navJobs` between Estimate and Archive: `ic("kanban")` + label "Jobs". Add `<symbol id="i-kanban" viewBox="0 0 24 24"><path d="M5 3v18"/><path d="M12 3v9"/><path d="M19 3v14"/></symbol>` (columns motif, stroke-inherited like the rest). Check `.nav button` still fits 5 across at 360px width (font 11px holds; reduce horizontal padding if needed).
- `showView`: add `"jobs"` to the toggle list; `navJobs` active for `name==="jobs"` and also for `"job"` (move the job sub-view highlight from Dashboard to Jobs). `if(name==="jobs") renderJobs();`
- `openJob` remembers where it came from: `let JOB_FROM="jobs"`; set it at each call site (dashboard passes "dash", jobs tab passes "jobs", archive passes "archive"); the job page back button label and target use it ("‹ Jobs" / "‹ Dashboard" / "‹ Archive").
- Date handling: store `"YYYY-MM-DD"` strings; format for display with `new Date(y,m-1,d)` (avoid UTC parse shifting a day).
- Everything persists through the existing `setArchive(arr)` path; no new storage keys.

## Verify before pushing
1. `node test/math.test.js` passes (nothing in this feature may touch `compute`).
2. Extract the inline `<script>` and `node --check` it.
3. Grep every `ic("...")` and `href="#i-..."` resolves to a defined symbol (remember dynamic calls: `ic(c[1])`, status chip icons).
4. Headless browser pass (Playwright, chromium at `/opt/pw-browsers/chromium`): save 2 estimates; win one; verify board sections populate (bidding + up next); Start job moves it to In progress; add tasks, toggle done, verify next-task shows on board and dashboard; add draws, cycle to paid, verify outstanding math; add an approved CO, verify contract and budget rise in the hero; complete the job, verify Recently completed. Reload and confirm persistence. Restore a legacy backup entry (no new fields) and confirm nothing crashes.
5. Both pricing canonical checks on the live site after deploy: $1,000 + 10% = $1,100; analyze $10,000 at 45%/12% gives break-even $8,800, net $3,300.
6. Screenshot dark and light themes of the Jobs tab and the expanded job page.

## Design tokens
Same approved dark look as the job tracking handoff: surfaces `--bg #0f1311`, `--panel #171d19`, `--panel2 #1d251f`, `--line #2b342d`; ink `#eef2ec`, muted `#9aa89c`; gold `--accent #f1c14e` (on-gold `--primink`), green `--accent2 #5cc98d`; semantic good/warn/bad tint trios already defined as CSS variables. Light theme mirrors automatically if you never hardcode a hex.

## Files
- `index.html`: all edits.
- `test/math.test.js`: run before every push, never edit.
- `AGENTS.md`, `JOB-TRACKING-HANDOFF.md`: background. This file supersedes nothing; it stacks on top.
