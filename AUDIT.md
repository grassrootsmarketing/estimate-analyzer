# Estimate Analyzer, 10-point audit

Run after the P8 stability round. Each area lists the finding, and either the fix that shipped or a recommendation to decide together. Fixed items are already committed and deployed. "Decide together" items were left alone because they involve a judgment call or need device testing.

---

## 1. Pricing correctness, PASS
One source of truth after P8.1: `compute(state)` holds all the math, `calc()` is a thin `getState, compute, paintResults` pipeline, and `test/math.test.js` guards the invariants on every push. Verified live on the deploy: build $1,000 + 10% = $1,100, analyze $10,000 at 45% margin and 12% overhead gives break-even $8,800 and net $3,300, and the number the calculator paints matches what the archive, summary, and proposal compute for the same state.

## 2. Injection / XSS from restored or edited data, FIXED
Found a real hole: the company logo (`PROFILE.logo`) was written into an `<img src>` via `innerHTML` on the main header and in the proposal without validation, and profile restore assigned `PROFILE = d.profile` straight from an uploaded backup. A crafted backup with a logo like `x" onerror="..."` would have run script on page load. Benchmark `note` and `unit` had the same class of problem: injected unescaped and restorable from backup.
Fix: added `safeImg()` (keeps a value only if it starts with `data:image/`), applied it to every logo and signature `img src`, sanitized `d.profile.logo` on restore, and escaped benchmark `note` and `unit` at the render points. Verified `safeImg` blocks `onerror`, `javascript:`, `data:text/html`, and remote URLs while keeping real images.

## 3. Untrusted backup validation, PASS (extended)
P8.4 already validates restored entries (drops non-object entries, keeps only `data:image/` photos capped at 12, nulls non-image signatures, coerces row types). This round extended the same idea to the profile logo. A normal backup round-trips with zero loss; a malicious one is stripped and the skipped count is reported.

## 4. Boot resilience and storage, PASS
P8.6 moved `registerSW()` ahead of the storage awaits and wrapped each storage load in its own try/catch, so one bad read cannot take out the rest of boot. `idbOpen()` has an `onblocked` handler and a 2.5s timeout, so a blocked database falls back to localStorage instead of hanging. Settings shows a storage-used line with a "getting full" nudge past 60% of quota, and there is a one-time backup reminder at 100 saved estimates.

## 5. State to DOM coupling, PASS
The old `render`/`setMode` monkey-patch is gone; persistence lives inside the real functions. `paintResults` never touches the `#rows` container, which is what keeps input focus while typing.

## 6. Mobile input UX, PASS
Typing multiple digits into Qty/Unit keeps focus (the earlier re-render bug is fixed). Number spinners are hidden. Tap targets are at or above 44px. Build-from-cost is the default and the total moves as you drag the markup.

## 7. Accessibility, PARTIAL, decide together
Good foundation: `lang="en"`, a real viewport, most icon buttons have `aria-label`. Worth a dedicated pass: the info tooltips are tap/hover with `tabindex` but have no keyboard-dismiss or `aria-describedby` wiring; color contrast on the muted grey text should be measured against WCAG AA; the scenario preset cards use `role="button"` but are not in the tab order for keyboard users. None of this blocks use; it needs real device and screen-reader testing to do right.

## 8. Copy and style consistency, RECOMMENDATION
The project style rule is no em dashes in UI copy, but there are roughly thirty pre-existing em dashes across labels, hints, and messages (for example the mode hint and several toast strings). I did not bulk-replace them because the same character is load-bearing in three places that must not change: the `SEED_BENCH` keys (like `Flooring - tile (per sf)`), the range-detection regex, and the `deriveMeta` check. A careful sweep that touches only copy strings is safe but is a large, purely cosmetic diff; flagging it so you can decide whether it is worth the churn. New copy added in P8 already avoids em dashes.

## 9. Offline and PWA, PASS with one nice-to-have
Installable, service worker is network-first for navigations so fresh deploys flow, offline shell works. Nice-to-have: ship real app icons and a maskable icon so the installed home-screen icon is crisp on Android instead of the default.

## 10. Maintainability, minor
After the P8.1 refactor, `isTaxable()` is now unused (the tax test lives inline in `compute`). Harmless, left in place to keep the diff surgical; safe to delete whenever. The single-file, no-build constraint is a deliberate tradeoff that keeps deploys trivial but caps how far the code can be modularized; the math test harness offsets some of that risk.

---

## Shipped this round
- XSS hardening: `safeImg()` on all image sources, profile-logo sanitization on restore, escaped benchmark note/unit.

## For us to decide together (no input needed until you are back)
- Em-dash copy sweep (cosmetic, ~30 strings).
- Accessibility pass (tooltips, contrast, keyboard order) with device testing.
- App icons + maskable icon for a cleaner installed PWA.
- Whether to auto-prune or warn harder as the archive grows, given photos are stored on-device.
