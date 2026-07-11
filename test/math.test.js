// test/math.test.js
// Zero-dependency Node test for the pricing invariants. Not loaded by the app.
// Run from the repo root:  node test/math.test.js   (required before every push)
//
// It reads index.html, extracts the roundUp and compute function source by
// brace-matching, evaluates them in a bare sandbox, and asserts the documented
// math. If compute or roundUp changes in a way that breaks an invariant, this fails.

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function extractFn(src, name) {
  const start = src.indexOf("function " + name);
  if (start < 0) throw new Error("Could not find function " + name + " in index.html");
  let i = src.indexOf("{", start);
  if (i < 0) throw new Error("Malformed function " + name);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("Unbalanced braces while extracting " + name);
}

const roundUpSrc = extractFn(html, "roundUp");
const computeSrc = extractFn(html, "compute");

// compute() is pure: it only uses parseFloat, Math, a /material/i regex, and roundUp.
const factory = new Function(roundUpSrc + "\n" + computeSrc + "\nreturn { roundUp: roundUp, compute: compute };");
const compute = factory().compute;

let failures = 0;
function eq(actual, expected, label) {
  if (Math.abs(actual - expected) < 0.005) {
    console.log("ok   " + label + " = " + actual);
  } else {
    failures++;
    console.error("FAIL " + label + ": got " + actual + ", expected " + expected);
  }
}
function S(o) {
  return Object.assign({ mode: "cost", margin: "0", contingency: "0", overhead: "0", tax: "0", rows: [] }, o);
}

// Build: $1,000 cost + 10% markup = $1,100 (the canonical invariant)
eq(compute(S({ margin: "10", rows: [{ item: "Materials", qty: 1, unit: 1000 }] })).price, 1100, "build 1000 + 10% markup = 1100");

// Build: rounds the price up to the next $50. $1,010 + 10% = 1111 -> 1150
eq(compute(S({ margin: "10", rows: [{ item: "Sub", qty: 1, unit: 1010 }] })).price, 1150, "build rounds price up to 50");

// trueCost order: direct + material tax, then contingency on that base.
// $1,000 material, 10% tax, 10% contingency -> (1000 + 100) * 1.10 = 1210
eq(compute(S({ contingency: "10", tax: "10", rows: [{ item: "Materials", qty: 1, unit: 1000 }] })).trueCost, 1210, "trueCost = (direct + tax) * (1 + contingency)");

// Material tax only applies to Materials lines, not other trades
eq(compute(S({ tax: "10", rows: [{ item: "Subcontractor", qty: 1, unit: 1000 }] })).taxAmt, 0, "material tax skips non-material lines");

// Build break-even floor = trueCost / (1 - overhead). trueCost 1000, overhead 20% -> 1250
eq(compute(S({ overhead: "20", rows: [{ item: "Sub", qty: 1, unit: 1000 }] })).breakeven, 1250, "build break-even floor = trueCost / (1 - overhead)");

// Analyze: price = sum of lines; break-even = price*(1-oh); gross = price*margin; net = gross - price*oh
const a = compute(S({ mode: "analyze", margin: "45", overhead: "12", rows: [{ item: "Sub", qty: 1, unit: 6000 }, { item: "Materials", qty: 1, unit: 4000 }] }));
eq(a.price, 10000, "analyze price = sum of lines");
eq(a.breakeven, 8800, "analyze break-even = price * (1 - overhead)");
eq(a.grossProfit, 4500, "analyze gross = price * margin");
eq(a.net, 3300, "analyze net = gross - price * overhead");

// Markup is not margin: 10% markup on $1,000 gives a $1,100 price, which is a 9.09% margin, not 10%
eq(compute(S({ margin: "10", rows: [{ item: "Sub", qty: 1, unit: 1000 }] })).marginPct, 9.0909, "10% markup is a 9.09% margin, not 10%");

if (failures) {
  console.error("\n" + failures + " pricing test(s) FAILED.");
  process.exit(1);
}
console.log("\nAll pricing invariants passed.");
