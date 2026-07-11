# Estimate Analyzer

Phone-first pricing tool for an LA general contractor. Single self-contained `index.html` (vanilla JS, no build step), one serverless function in `/api`, and a service worker `sw.js`. Vercel auto-deploys from `main`.

- Live: https://estimate-analyzer-atb.vercel.app
- See `HANDOFF.md` for architecture, the pricing math, the data model, and known issues.

## Before every push

Run the pricing test. It has no dependencies and is not loaded by the app.

```
node test/math.test.js
```

It reads `index.html`, extracts the `compute` and `roundUp` functions, and checks the pricing invariants (for example: $1,000 cost + 10% markup = $1,100). A nonzero exit means a pricing invariant broke; do not push until it passes.
