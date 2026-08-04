# Codex handoff: housekeeping pass before the next features

Written 4 Aug 2026, at `f43df29`. This replaces the older `CODEX-HANDOFF.md`.
It is not a feature brief. The job is to make the next round of features cheap to
build, and to do that without changing a single thing the contractor sees.

Read `AGENTS.md` first. It holds the ten golden rules and they are not negotiable.
This document assumes you have.

---

## The one-paragraph version

`index.html` is 4,264 lines and 325KB: 22% CSS, 66% JavaScript, one file, no build
step, 218 top-level functions, 31 module globals. It is a real product used daily
by a working contractor in Los Angeles. It has six test suites that pass, a
serverless API, a service worker, and a client-facing portal. It also has four
overlapping handoff documents, 153 functions no test has ever touched, four render
functions over 100 lines, and a growing pile of markup built by string
concatenation. None of that is on fire. All of it is friction.

---

## What must not change

These are load-bearing. Breaking one of them costs the contractor money or trust.

**`compute()` is frozen.** Every commit in this repo is verified by extracting
`compute()` and diffing it byte for byte against `origin/main`. Pricing math does
not change as a side effect of a cleanup. If a housekeeping change requires
touching it, stop and raise it.

**The six suites must pass, every commit.** `node test/{math,pm,api,backup,lead,portal}.test.js`.
They extract functions out of `index.html` by brace matching, which means **every
tested function must stay a named function declaration**. Converting one to a const
arrow, or moving it inside a closure, breaks the harness rather than the app, which
is a nasty way to find out.

**IndexedDB is primary, localStorage is a mirror.** `saveKey(k,v)` writes to IDB
when `IDB_OK`, otherwise localStorage. `readLS(k)` reads localStorage only.
`getArchive()` is the source of truth. Reading localStorage directly in a test
produces a confident false negative; that trap has been hit three times in this
repo's history. Storage keys: `ea_state`, `ea_archive`, `ea_profile`, `ea_example`,
`ea_sync`, `ea_leadkey`.

**`sanitizeArchive` is the only door into the archive cache** (golden rule 10).
Boot, another tab's write, an import, a cloud restore, the example seed, and
`setArchive` all pass through it. `sanitizeEntry` must stay idempotent: it now runs
many times over an entry's life, so repairs may not regenerate ids, invent dates,
or drift a value on each pass. `test/pm.test.js` sections 22 to 24 hold that line.

**No em dashes anywhere in user-facing copy.** Exactly ten protected ones exist in
`index.html` and the count is checked before every commit. Use commas, parentheses,
or "to".

**No build step, no CDN, no runtime dependencies.** Everything is vendored
same-origin under `/vendor` (12MB: pdfjs, tesseract, fonts). Adding a bundler is
not housekeeping, it is a rewrite, and it is out of scope.

**Deploy is via the GitHub web UI**, not `git push`. See AGENTS.md. Bump the
`sw.js` cache version on every ship or installed devices keep serving the old shell.
It is at `ea-shell-v26`.

---

## What is actually messy, with numbers

### 1. Four handoff documents, three of them stale

| File | Last touched | State |
|---|---|---|
| `AGENTS.md` | today | **Current. The real operating guide.** |
| `CODEX-HANDOFF.md` | 10 days ago | Superseded by this file |
| `HANDOFF.md` | 3 weeks ago | Written for a UX audit, describes a UI that no longer exists |
| `PROJECT-MGMT-HANDOFF.md` | at the PM launch | Historical record of a shipped feature |
| `AUDIT.md` | 3 weeks ago | Findings from a round that has since shipped |

Anyone new reads the wrong one and works from a description of an app that changed
underneath it. Consolidate to `AGENTS.md` plus one current handoff, and move the
rest under `docs/history/` with a dated header so they read as a record rather than
as instructions.

### 2. Four render functions carry a third of the app

| Function | Lines |
|---|---|
| `renderJob` | 171 |
| `wireJobPage` | 139 |
| `renderDashboard` | 137 |
| `renderJobs` | 106 |

2,111 of the file's lines sit inside top-level functions, and these four are 26% of
that. Each builds a large HTML string, assigns `innerHTML`, then re-attaches every
event handler by hand. There are 44 `innerHTML` assignments and 59 `querySelector`
calls across the file.

The recent row was extracted into `recentRowHtml` when the Pinned section needed
the same markup, and that worked well: two callers, one builder, no drift. That is
the pattern to repeat. Do not introduce a template library. Extract the repeated
row and card shapes into named builders that return strings, and keep wiring in one
place per screen.

### 3. 153 functions have never been executed by a test

65 of 218 top-level functions are extracted by a suite. The untested set includes
things that move money or write to storage:

`applyState`, `getState`, `persist`, `saveKey`, `setArchive`, `upsertFromState`,
`saveToArchive`, `stateSig`, `updateSaveStatus`, `schedulePortalPublish`,
`makePortalToken`, `portalLink`, `renderArchive`, `isTaxable`, `pickMargin`.

`isTaxable` deserves particular attention: it decides whether a line gets sales tax
by matching `/material/i` against the item name. That is a pricing decision made by
a regex on user-typed text, and nothing tests it. It is also invisible to the user,
which is why the empty line items state now spells it out.

Highest value additions, in order: `upsertFromState` and `saveToArchive` (the
save path, where edit-in-place identity lives), `applyState` round-tripping
against `getState`, and `isTaxable` including the cases that surprise people
("Materials", "material haul", "Miscellaneous", "Immaterial").

### 4. Boot is a long unguarded sequence, recently patched under fire

Today a corrupt held estimate blanked the entire app: `applyState` threw, and
because boot ran the paint calls in the same statement sequence, nothing rendered.
It is now step-guarded and the held estimate is repaired before restore. That fix
is correct but it is a bandage over a shape problem: boot is one long async
function doing storage loads, form rebuild, and first paint in sequence, with
`let dropped` and `hadState` threaded through it.

Worth restructuring into three named phases (`loadStorage`, `restoreForm`,
`paintFirstScreen`) that each return rather than mutate outer scope. Behaviour must
not change; this is purely so the next person can see the order.

### 5. 31 module globals, and mutation at a distance

`ARCH_CACHE`, `rows`, `PHOTOS`, `EDIT_ENTRY_ID`, `_savedSig`, `_touchedTs`,
`_lastSig`, `_draftReady`, `CUR_JOB`, `MODE`, `SIGNATURE` and twenty more. The
recent save-status and draft-expiry bugs were both caused by two of these
disagreeing about the same fact. `_savedSig` and `EDIT_ENTRY_ID` in particular
encode overlapping truths about "what am I editing".

Do not attempt a state-management refactor. Do collapse the pairs that already
proved they drift: the editing identity (`EDIT_ENTRY_ID` + `_savedSig`) and the
draft clock (`_touchedTs` + `_lastSig` + `_draftReady`) each want to be one small
object with named accessors.

### 6. 16 inline `onclick=` attributes in markup

They coexist with programmatic wiring elsewhere, so there are two conventions for
the same job. `clearAllRows`, `addRow`, `delRow`, `upd`, `snapRow`, `confirmRow`
are reached this way, which also forces them to stay on `window`. Pick one
convention. Programmatic is the majority.

### 7. 29 `confirm()` calls

The row menu recently moved to an in-place confirmation, which the contractor liked
much better than a system dialog. The other 28 are still native `confirm()`:
delete a cost entry, delete a task, delete a draw, void a change order, clear the
archive, and so on. Not urgent, but they are now the inconsistent ones, and the
in-menu pattern already exists to copy.

### 8. Vendor payload is 12MB

`pdfjs` and `tesseract` are lazy-loaded, which is correct, but they are also the
entire reason the repo is heavy and they serve one feature (importing a PDF bid).
Worth confirming that path is still used before carrying the weight forward. That
is a question for David, not a decision to make alone.

---

## Suggested order

Cheap and safe first, so momentum is real before anything structural.

1. **Docs.** Consolidate the five markdown files. One hour, zero risk, and it stops
   the next person starting from a false picture.
2. **Tests for the save path.** `upsertFromState`, `saveToArchive`, `applyState`
   round-trip, `isTaxable`. This buys the confidence that every later step spends.
3. **Extract row and card builders** in `renderDashboard`, `renderJobs`,
   `renderJob`. Follow `recentRowHtml`. Verify by screenshotting each view before
   and after in both themes.
4. **Split boot into three named phases.** Behaviour identical, order visible.
5. **Collapse the two global clusters** that have already caused bugs.
6. **Pick one event-wiring convention** and finish the job.
7. **Raise the `confirm()` question** with David rather than converting 28 dialogs
   on your own initiative.

Steps 1 to 3 are safe to do without asking. Step 4 onward, show a diff first.

---

## How to verify anything here

The repo has an unusually good verification story. Use it.

- **Six suites:** `node test/{math,pm,api,backup,lead,portal}.test.js`
- **compute() diff:** extract `function compute(` by brace matching from your build
  and from `origin/main`, compare byte for byte.
- **Em dash count:** must be exactly 10 in `index.html`.
- **Headless checks** with Playwright at `/opt/pw-browsers/chromium`. There is a
  shared app-shaped seed and a set of one-off audit scripts that cover contrast,
  touch targets, hostile text overflow, calendar performance, cross-tab sync,
  offline behaviour, the row menu, the pinned section, and boot with corrupt data.
  They are not committed; rebuild the ones you need, and prefer them to reasoning.

Three traps that have produced false results in this repo:

- Reading `localStorage` when the truth is in IndexedDB. Use `getArchive()`.
- `browser.newPage()` creates an isolated context, so two "tabs" made that way
  share nothing. Use `browser.newContext()` then `context.newPage()`.
- Seeding storage before the app has booted once: the first load autosaves and can
  overwrite your fixture. Seed after load, through the app's own `saveKey`.

---

## Open product questions, not housekeeping

Listed so you do not accidentally decide them: stage badges in caps or sentence
case, whether the Pinned section belongs above In progress, whether pinned jobs
should count against the five Recent slots, whether the phone home screen icon
stays Homestead or reverts to the contractor's own mark, whether 72 hours is the
right draft expiry, notification when a request form submission arrives, and an
offline queue for portal publishing.

Leave all of them alone.
