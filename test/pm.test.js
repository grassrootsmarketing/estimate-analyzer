// test/pm.test.js
// Zero-dependency Node test for the project-management (Jobs) helpers. Not loaded by the app.
// Run from the repo root:  node test/pm.test.js   (required before every push, alongside math.test.js)
//
// Extracts the pure PM helpers from index.html by brace-matching and asserts the
// data-integrity rules from the Jobs hardening handoff: lifecycle, pruning,
// unknown-vs-zero tracking, cents-stable money, receivables, COs, sanitization.

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Could not find function " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("Unbalanced braces extracting " + name);
}
function extractConst(src, name) {
  const start = src.indexOf("const " + name + "=");
  if (start < 0) throw new Error("Could not find const " + name);
  const end = src.indexOf(";\n", start);
  return src.slice(start, end + 1);
}

const FNS = ["roundUp","compute","uid","numTs","txt","capArr","validDateStr","dayOrdinal","todayStr",
  "toC","fromC","sumC","money2","validAmount","validSignedAmount","boardStage","hasPmActivity",
  "isManagedJob","approvedChanges","changesTotalC","contractPrice","jobBudgetTarget","jobBudgetCeiling",
  "jobSpent","projectedProfit","contractLessCosts","rowPaidC","rowInvoicedC","drawsPaid","drawsInvoiced",
  "drawsTotal","contractRemaining","accountsReceivable","unbilled","nextTask","isOverdue","barTone",
  "pruneArchive","entryPrice","safeImg","sanitizePhotos","sanitizeRows","sanitizeEntry"];
const CONSTS = ["COST_CATS","HISTORY_CAP"];

const srcParts = CONSTS.map(c => extractConst(html, c)).concat(FNS.map(f => extractFn(html, f)));
const sandbox = new Function(srcParts.join("\n") + "\nreturn {" + FNS.concat(CONSTS).join(",") + "};")();

let failures = 0;
function ok(cond, label) {
  if (cond) console.log("ok   " + label);
  else { failures++; console.error("FAIL " + label); }
}
function eq(actual, expected, label) {
  if ((typeof actual === "number" && typeof expected === "number") ? Math.abs(actual - expected) < 0.005 : actual === expected) {
    console.log("ok   " + label + " = " + actual);
  } else { failures++; console.error("FAIL " + label + ": got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected)); }
}
const S = sandbox;
function job(over) {
  return Object.assign({ id: "e1", state: { ts: 1, jobName: "T" }, results: { mode: "cost", price: 10000, trueCost: 7000 },
    outcome: "pending", stage: "", costs: [], tasks: [], draws: [], changes: [],
    sched: { start: "", target: "" }, costTracking: "unknown", paymentTracking: "unknown", createdTs: 1 }, over);
}

// 1. Lifecycle: lost is excluded BEFORE stage is considered
eq(S.boardStage(job({ outcome: "lost", stage: "active" })), null, "boardStage: lost job never on board even if stage active");
eq(S.boardStage(job({ outcome: "won", stage: "active" })), "active", "boardStage: won + active = active");
eq(S.boardStage(job({ outcome: "won" })), "upnext", "boardStage: won, unstarted = upnext");
eq(S.boardStage(job()), "bidding", "boardStage: pending = bidding");
eq(S.boardStage(job({ outcome: "won", stage: "complete" })), "complete", "boardStage: complete wins over upnext");

// 2. Managed jobs never pruned
const many = [];
for (let i = 0; i < 40; i++) many.push(job({ id: "e" + i }));
many.push(job({ id: "eactive", stage: "active", outcome: "won" }));
many.push(job({ id: "ecosts", costs: [{ id: "c1", ts: 1, cat: "Materials", note: "", amount: 5 }] }));
const pruned = S.pruneArchive(many);
ok(pruned.some(e => e.id === "eactive"), "pruning keeps the active job past the cap");
ok(pruned.some(e => e.id === "ecosts"), "pruning keeps a job with logged costs");
eq(pruned.filter(e => !S.isManagedJob(e) && !e.pinned).length, S.HISTORY_CAP, "cap still applies to disposable history");

// 3. Unknown vs zero tracking on sanitize
const legacy = S.sanitizeEntry({ state: { ts: 1 } });
eq(legacy.costTracking, "unknown", "legacy entry defaults to unknown cost tracking");
eq(legacy.paymentTracking, "unknown", "legacy entry defaults to unknown payment tracking");
const withCosts = S.sanitizeEntry({ state: { ts: 1 }, costs: [{ id: "c1", ts: 1, cat: "Labor", note: "", amount: 10 }] });
eq(withCosts.costTracking, "tracking", "entry with costs sanitizes to tracking");

// 4. Lost jobs cannot stay staged (sanitize repairs it)
const lostActive = S.sanitizeEntry({ state: { ts: 1 }, outcome: "lost", stage: "active" });
eq(lostActive.stage, "", "sanitize clears stage on a lost job");

// 5. Contract math with additive, deductive, pending, and void COs
const co = job({ changes: [
  { id: "o1", ts: 1, title: "a", amount: 500, cost: 200, status: "approved" },
  { id: "o2", ts: 1, title: "b", amount: 900, cost: 0, status: "pending" },
  { id: "o3", ts: 1, title: "c", amount: 700, cost: 0, status: "void" }] });
eq(S.contractPrice(co), 10500, "approved CO raises the contract; pending and void do not");
eq(S.jobBudgetTarget(co), 7200, "approved CO cost impact raises the cost target");
const deduct = job({ changes: [{ id: "o1", ts: 1, title: "d", amount: -500, cost: -100, status: "approved" }] });
eq(S.contractPrice(deduct), 9500, "deductive CO lowers the contract");
eq(S.jobBudgetTarget(deduct), 6900, "deductive CO lowers the cost target");

// 6. Analyze mode: target cost and break-even ceiling stay distinct
const an = job({ results: { mode: "analyze", price: 10000, impliedCost: 5500, breakeven: 8800 } });
eq(S.jobBudgetTarget(an), 5500, "analyze target = impliedCost, not breakeven");
eq(S.jobBudgetCeiling(an), 8800, "analyze ceiling = breakeven");
eq(S.jobBudgetCeiling(job()), null, "build mode has no separate ceiling");

// 7. Receivables: partial payment, overpayment, unbilled
const pay = job({ draws: [
  { id: "d1", ts: 1, label: "Deposit", amount: 5000, status: "invoiced", paidAmount: 2000, invoicedTs: 1, paidTs: 1, note: "" },
  { id: "d2", ts: 1, label: "Balance", amount: 3000, status: "planned", paidAmount: 0, invoicedTs: null, paidTs: null, note: "" }] });
eq(S.drawsPaid(pay), 2000, "partial payment counts what was received");
eq(S.accountsReceivable(pay), 3000, "receivable = invoiced minus received");
eq(S.unbilled(pay), 5000, "unbilled = contract minus invoiced");
eq(S.contractRemaining(pay), 8000, "contract remaining = contract minus received");
const over = job({ draws: [{ id: "d1", ts: 1, label: "All", amount: 10000, status: "paid", paidAmount: 12000, invoicedTs: 1, paidTs: 1, note: "" }] });
eq(S.contractRemaining(over), -2000, "overpayment yields a negative remaining (credit), not clamped silently");
eq(S.accountsReceivable(over), 0, "receivable never goes negative");

// 8. Money is cents-stable
const cents = job({ draws: [
  { id: "d1", ts: 1, label: "a", amount: 0.1, status: "paid", paidAmount: 0.1, invoicedTs: 1, paidTs: 1, note: "" },
  { id: "d2", ts: 1, label: "b", amount: 0.2, status: "paid", paidAmount: 0.2, invoicedTs: 1, paidTs: 1, note: "" }] });
eq(S.drawsPaid(cents), 0.3, "0.10 + 0.20 sums to exactly 0.30");
eq(S.toC(19.99) + S.toC(0.01), 2000, "cents addition is integer-exact");

// 9. Money validation boundaries
eq(S.validAmount("0"), null, "zero amount rejected for costs and draws");
eq(S.validAmount("-5"), null, "negative amount rejected for costs and draws");
eq(S.validAmount("12.345"), 12.35, "amounts round to cents at the boundary");
eq(S.validSignedAmount("-250"), -250, "signed amounts allow deductive CO values");
eq(S.validSignedAmount("0"), null, "signed amounts still reject zero");

// 10. Real calendar dates only
eq(S.validDateStr("2026-02-30"), "", "Feb 30 rejected");
eq(S.validDateStr("2026-02-28"), "2026-02-28", "real date accepted");
eq(S.validDateStr("2026-13-01"), "", "month 13 rejected");
eq(S.validDateStr("03/08/2026"), "", "wrong shape rejected");

// 11. DST-safe day math (US spring-forward around Mar 8, 2026)
eq(S.dayOrdinal("2026-03-09") - S.dayOrdinal("2026-03-08"), 1, "day ordinals are DST-safe");
eq(S.dayOrdinal("2026-11-02") - S.dayOrdinal("2026-11-01"), 1, "fall-back day is still one day");

// 12. Duplicate IDs are repaired; invariants enforced
const dup = S.sanitizeEntry({ state: { ts: 1 }, costs: [
  { id: "c1", ts: 1, cat: "Labor", note: "a", amount: 1 },
  { id: "c1", ts: 1, cat: "Labor", note: "b", amount: 2 }] });
ok(dup.costs[0].id !== dup.costs[1].id, "duplicate cost ids repaired to unique ids");
const inv = S.sanitizeEntry({ state: { ts: 1 }, tasks: [{ id: "t1", ts: 1, title: "x", done: false, doneTs: 123 }] });
eq(inv.tasks[0].doneTs, null, "not-done task cannot keep a doneTs");
const paidfix = S.sanitizeEntry({ state: { ts: 1 }, draws: [{ id: "d1", ts: 1, label: "x", amount: 100, status: "paid", paidAmount: 0 }] });
eq(paidfix.draws[0].paidAmount, 100, "paid draw with no paidAmount defaults to the draw amount");

// 13. Sanitize drops garbage rows but keeps deductive COs
const gar = S.sanitizeEntry({ state: { ts: 1 },
  draws: [{ id: "d1", ts: 1, label: "zero", amount: 0, status: "planned" }, { id: "d2", ts: 1, label: "ok", amount: 5, status: "planned" }],
  costs: [{ id: "c1", ts: 1, cat: "Labor", amount: -4 }, { id: "c2", ts: 1, cat: "NotACategory", amount: 5 }],
  changes: [{ id: "o1", ts: 1, title: "deduct", amount: -300, status: "approved" }, { id: "o2", ts: 1, title: "zero", amount: 0 }] });
eq(gar.draws.length, 1, "zero-amount draw dropped");
eq(gar.costs.length, 0, "negative and unknown-category costs dropped");
eq(gar.changes.length, 1, "zero-amount CO dropped, deductive CO kept");
eq(gar.changes[0].amount, -300, "deductive CO amount survives sanitize");

// 14. Array caps hold on restore
const big = S.sanitizeEntry({ state: { ts: 1 }, tasks: Array.from({ length: 900 }, (_, i) => ({ id: "t" + i, ts: 1, title: "t" + i, done: false })) });
ok(big.tasks.length <= 300, "restored task arrays are capped");

// 15. nextTask ordering: earliest due first, then no-due by insertion
const nt = S.nextTask(job({ tasks: [
  { id: "t1", ts: 1, title: "no due", due: "", done: false, doneTs: null },
  { id: "t2", ts: 2, title: "later", due: "2026-09-01", done: false, doneTs: null },
  { id: "t3", ts: 3, title: "sooner", due: "2026-08-01", done: false, doneTs: null },
  { id: "t4", ts: 0, title: "done", due: "2026-01-01", done: true, doneTs: 5 }] }));
eq(nt.id, "t3", "nextTask picks the earliest-due open task");

// 16. Profit figures come from contract, not bare price
const prof = job({ outcome: "won", stage: "active", costTracking: "tracking",
  costs: [{ id: "c1", ts: 1, cat: "Labor", note: "", amount: 2500 }],
  changes: [{ id: "o1", ts: 1, title: "add", amount: 1000, cost: 400, status: "approved" }] });
eq(S.contractLessCosts(prof), 8500, "contract less logged costs uses the adjusted contract");
eq(S.projectedProfit(prof), 3600, "projected gross profit = contract minus adjusted cost target");

if (failures) { console.error("\n" + failures + " PM test(s) failed."); process.exit(1); }
console.log("\nAll PM invariants passed.");
