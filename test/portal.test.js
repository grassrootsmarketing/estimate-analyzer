// test/portal.test.js
// Client portal test: THE test that matters is redaction. A published snapshot
// must never contain the contractor's costs, margins, or internal notes, no
// matter what is on the job. Also covers /api/portal guard rails with mocked
// req/res. No network. Run from the repo root:  node test/portal.test.js

const fs = require("fs");
const path = require("path");

let failures = 0;
function ok(cond, label){
  if(cond) console.log("ok   " + label);
  else { failures++; console.error("FAIL " + label); }
}
function eq(actual, expected, label){
  if(actual === expected) console.log("ok   " + label + " = " + JSON.stringify(actual));
  else { failures++; console.error("FAIL " + label + ": got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected)); }
}

// ---- extract portalSnapshot and its dependencies from index.html ----
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
function extractFn(src, name){
  let start = src.indexOf("async function " + name + "(");
  if(start < 0) start = src.indexOf("function " + name + "(");
  if(start < 0) throw new Error("Could not find function " + name);
  let i = src.indexOf("{", start), depth = 0;
  for(; i < src.length; i++){
    const c = src[i];
    if(c === "{") depth++;
    else if(c === "}"){ depth--; if(depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("Unbalanced braces extracting " + name);
}
const FNS = ["roundUp","compute","txt","numTs","validDateStr","toC","fromC","sumC","money2",
  "boardStage","approvedChanges","changesTotalC","contractPrice","entryPrice",
  "rowPaidC","rowInvoicedC","drawsPaid","dayOrdinal","todayStr","nextTask","isOverdue",
  "dayFromTs","projectedFinish","slipDays","phaseTimeline","portalSnapshot"];
const S = new Function(FNS.map(f => extractFn(html, f)).join("\n") + "\nreturn {" + FNS.join(",") + "};")();

// A job loaded with everything secret: distinctive values that must never appear
const SECRET_COST = 4321.99, SECRET_TRUECOST = 77777, SECRET_MARGIN = 33.77;
const job = {
  id: "e1",
  state: { ts: 1, jobName: "Reyes bathroom", contactName: "Marisol Reyes",
    contactPhone: "(323) 555-0134", contactEmail: "marisol@example.com",
    rows: [{ item: "Sub", desc: "internal sub pricing note", qty: 1, unit: 6000 }] },
  results: { mode: "cost", price: 10000, trueCost: SECRET_TRUECOST, marginPct: SECRET_MARGIN, net: 2222.22 },
  outcome: "won", stage: "active", actualStart: "2026-07-20", completed: "",
  sched: { start: "2026-07-20", target: "2026-08-15" },
  costs: [{ id: "c1", ts: 1, cat: "Materials", note: "secret vendor discount", amount: SECRET_COST }],
  tasks: [{ id: "t1", ts: 1, title: "Demo", due: "", done: true, doneTs: 2 },
          { id: "t2", ts: 1, title: "Tile", due: "", done: false, doneTs: null }],
  draws: [{ id: "d1", ts: 1, label: "Deposit", amount: 3000, status: "paid", paidAmount: 3000, invoicedTs: 1, paidTs: 2, note: "paid cash, no receipt" }],
  changes: [{ id: "o1", ts: 1, number: "CO-1", title: "Add shower niche", amount: 500, cost: 200, status: "approved", approvedTs: 2, note: "client asked twice" },
            { id: "o2", ts: 1, number: "CO-2", title: "Rejected idea", amount: 900, cost: 400, status: "void", approvedTs: null, note: "" },
            { id: "o3", ts: 1, number: "CO-3", title: "Upgrade fixtures", amount: 750, cost: 310, status: "pending", approvedTs: null, note: "haggling with supplier" }],
  costTracking: "tracking", paymentTracking: "tracking", createdTs: 1
};

// 1. Redaction: the snapshot never carries costs, margins, or internal notes
const snap = S.portalSnapshot(job, { money: true, coName: "ATB Builders", coPhone: "(818) 555-1000", coEmail: "atb@example.com", logo: "" }, []);
const json = JSON.stringify(snap);
ok(!json.includes(String(SECRET_COST)), "logged cost amounts never appear");
ok(!json.includes(String(SECRET_TRUECOST)), "true cost never appears");
ok(!json.includes(String(SECRET_MARGIN)), "margin never appears");
ok(!json.toLowerCase().includes("margin"), "the word margin never appears");
ok(!json.includes("secret vendor discount"), "cost notes never appear");
ok(!json.includes("internal sub pricing note"), "line item descriptions never appear");
ok(!json.includes("paid cash, no receipt"), "draw notes never appear");
ok(!json.includes("client asked twice"), "change order notes never appear");
ok(!json.includes("2222.22"), "net profit never appears");
ok(!json.includes("6000"), "unit pricing internals never appear");

// 2. What the client SHOULD see is present and correct
eq(snap.job.name, "Reyes bathroom", "job name is shown");
eq(snap.job.stage, "active", "stage is shown");
eq(snap.progress.done + "/" + snap.progress.total, "1/2", "task progress is shown");
eq(snap.money.contract, 10500, "contract includes approved change orders");
eq(snap.money.paid, 3000, "paid to date is shown");
eq(snap.money.balance, 7500, "balance owed is correct");
eq(snap.changes.length, 2, "approved and pending change orders are shown, voided are not");
eq(snap.changes[0].title, "Add shower niche", "approved CO title is shown");
eq(snap.changes[0].status, "approved", "approved CO carries its status");
eq(snap.changes[1].status, "pending", "pending CO carries awaiting-approval status");
eq(snap.changes[1].amount, 750, "pending CO amount is shown when money is on");
ok(!json.includes("310") && !json.includes("haggling with supplier"), "pending CO cost and note never appear");
eq(snap.money.draws[0].status, "paid", "draw status is shown");
eq(snap.job.next && snap.job.next.title, "Tile", "the client sees what's coming next");
ok(!JSON.stringify(snap.job.next).includes("doneTs"), "next-up carries only title and due date");
eq(snap.work.done.length, 1, "done-so-far lists completed work");
eq(snap.work.done[0].title, "Demo", "done-so-far shows the finished task title");
eq(snap.work.upcoming.length, 1, "coming-up lists open work");
eq(snap.work.upcoming[0].title, "Tile", "coming-up shows the open task title");
ok(!JSON.stringify(snap.work).includes("doneTs") && !JSON.stringify(snap.work).includes('"id"'), "work log carries titles and dates only");
const busy = Object.assign({}, job, { tasks: Array.from({ length: 40 }, (_, i) =>
  ({ id: "bt" + i, ts: i, title: "Task " + i, due: "", done: i < 20, doneTs: i < 20 ? i + 1 : null })) });
const busySnap = S.portalSnapshot(busy, {}, []);
eq(busySnap.work.done.length, 8, "done-so-far caps at 8 (most recent)");
eq(busySnap.work.upcoming.length, 8, "coming-up caps at 8");
eq(busySnap.work.done[7].title, "Task 19", "done-so-far keeps the most recent completions");
const dueOrder = Object.assign({}, job, { tasks: [
  { id: "u1", ts: 1, title: "No due", due: "", done: false, doneTs: null },
  { id: "u2", ts: 2, title: "Later", due: "2026-09-01", done: false, doneTs: null },
  { id: "u3", ts: 3, title: "Sooner", due: "2026-08-05", done: false, doneTs: null }] });
eq(S.portalSnapshot(dueOrder, {}, []).work.upcoming[0].title, "Sooner", "coming-up is ordered by due date");

// 3. Money off: nothing financial survives
const noMoney = S.portalSnapshot(job, { money: false, coName: "ATB" }, []);
const njson = JSON.stringify(noMoney);
eq(noMoney.money, null, "money:false strips the payments block");
eq(noMoney.changes.length, 2, "money:false keeps CO titles so the client still knows they exist");
ok(!("amount" in noMoney.changes[0]) && !("amount" in noMoney.changes[1]), "money:false strips CO amounts");
ok(!njson.includes("10500") && !njson.includes("10000") && !njson.includes("3000") && !njson.includes("500") && !njson.includes("750"), "no dollar figures leak with money off");

// 4. Photos are capped
const many = Array.from({ length: 20 }, (_, i) => "data:image/jpeg;base64,x" + i);
eq(S.portalSnapshot(job, {}, many).photos.length, 12, "photos are capped at 12");

// ---- 10. Summary rollup: what was agreed, what was added, where that leaves it ----
const m = snap.money;
eq(m.base, 10000, "base is the originally agreed price, before change orders");
eq(m.approvedChanges, 500, "approved changes are totalled separately");
eq(m.pendingChanges, 750, "pending changes are totalled separately");
eq(m.contract, 10500, "contract is base plus approved changes only");
ok(m.contract === m.base + m.approvedChanges, "the rollup adds up");
ok(m.contract !== m.base + m.approvedChanges + m.pendingChanges,
   "pending changes are NOT folded into the contract total");
ok(JSON.stringify(m).indexOf(String(SECRET_COST)) < 0 &&
   JSON.stringify(m).indexOf(String(SECRET_TRUECOST)) < 0 &&
   JSON.stringify(m).indexOf(String(SECRET_MARGIN)) < 0,
   "the money rollup carries no cost, true cost, or margin");

// ---- 11. Change orders carry an approval date, and only when approved ----
const coA = snap.changes.find(c => c.number === "CO-1");
const coP = snap.changes.find(c => c.number === "CO-3");
ok(coA && coA.on, "an approved change order carries the date it was approved");
eq(coP.on, "", "a pending change order carries no approval date");
ok(!snap.changes.some(c => c.number === "CO-2"), "a voided change order is still never shared");
ok(JSON.stringify(snap.changes).indexOf("haggling") < 0 &&
   JSON.stringify(snap.changes).indexOf("client asked twice") < 0,
   "change order notes still never leave the app");

// ---- 12. Completion dates on finished work ----
ok(snap.work.done.every(t => "on" in t), "finished work carries the date it was finished");
ok(snap.work.upcoming.every(t => "late" in t), "upcoming work carries an overdue flag");

// ---- 13. Timing projections ----
eq(S.dayFromTs(0), "", "dayFromTs refuses a missing timestamp");
const sched = { start: "2026-07-20", target: "2026-08-15" };
const onTime = { sched, tasks: [{ id:"a", ts:1, title:"A", done:false, due:"2026-08-10" }] };
eq(S.projectedFinish(onTime), "2026-08-15",
   "a job whose last phase lands before the target still projects to the target");
const late = { sched, tasks: [{ id:"a", ts:1, title:"A", done:false, due:"2026-08-22" }] };
eq(S.projectedFinish(late), "2026-08-22",
   "a phase due past the target pushes the projected finish out to meet it");
eq(S.slipDays(late), 7, "slip is measured in days past the original target");
eq(S.slipDays(onTime), 0, "a job on or ahead of schedule reports no slip");
eq(S.slipDays({ sched: { start:"", target:"" }, tasks: [] }), 0,
   "no target means no slip rather than a nonsense number");
eq(S.projectedFinish({ sched: { start:"", target:"" }, tasks: [{ id:"a", ts:1, title:"A", done:false, due:"2026-09-01" }] }),
   "2026-09-01", "with no target the last open phase becomes the projection");
eq(S.projectedFinish({ sched, tasks: [] }), "2026-08-15",
   "with no phases the target stands as the projection");
ok(S.slipDays({ sched, tasks: [{ id:"a", ts:1, title:"A", done:true, doneTs:1, due:"2026-09-30" }] }) === 0,
   "a finished phase never drags the projection out, however late its due date was");

// ---- 14. Phase timeline ordering and state ----
const tl = S.phaseTimeline({
  sched,
  tasks: [{ id:"p3", ts:3, title:"Third",  done:false, due:"2026-12-01" },
          { id:"p1", ts:1, title:"First",  done:true,  doneTs:1000, due:"" },
          { id:"p2", ts:2, title:"Second", done:false, due:"2000-01-01" }]
});
eq(tl.length, 3, "every phase appears in the timeline");
eq(tl[0].title, "First", "finished phases come first");
eq(tl[0].state, "done", "a finished phase reads as done");
eq(tl[1].title, "Second", "open phases follow, ordered by due date");
eq(tl[1].state, "late", "an open phase past its due date is flagged late");
eq(tl[2].state, "planned", "a phase that is neither overdue nor next up reads as planned");
// "late" outranks "now" on purpose. When the next phase up is already overdue,
// the client should be told it is late, not told it is merely current.
const tlClear = S.phaseTimeline({
  sched,
  tasks: [{ id:"q1", ts:1, title:"Soon",  done:false, due:"2099-01-01" },
          { id:"q2", ts:2, title:"Later", done:false, due:"2099-06-01" }]
});
eq(tlClear[0].state, "now", "with nothing overdue, the next phase up is flagged as current");
eq(tlClear[1].state, "planned", "phases behind the current one stay planned");
ok(tl.every(p => !("cost" in p) && !("note" in p) && !("amount" in p)),
   "the timeline carries titles and dates only");
const tlSnap = snap.timeline;
ok(tlSnap && Array.isArray(tlSnap.phases), "the snapshot carries a timeline");
ok(tlSnap.slip >= 0, "slip is never negative in the snapshot");
ok(JSON.stringify(tlSnap).indexOf(String(SECRET_COST)) < 0 &&
   JSON.stringify(tlSnap).indexOf("secret vendor discount") < 0,
   "the timeline leaks nothing from the cost log");

// ---- 15. Timing survives money:false, the rollup does not ----
//     Reuses the noMoney snapshot built in section 8 rather than rebuilding it.
ok(noMoney.timeline && noMoney.timeline.phases.length === 2,
   "timing is still shared when money is withheld");
ok(!noMoney.money, "the whole money rollup goes with money:false, base included");

// ---- /api/portal guard rails ----
delete process.env.BLOB_READ_WRITE_TOKEN;
const api = require("../api/portal.js");
function mockRes(){
  const out = { code: null, body: null, headers: {} };
  return { setHeader: function(k, v){ out.headers[k] = v; },
    status: function(c){ out.code = c; return { json: function(b){ out.body = b; } }; }, out: out };
}
const TOK = "c".repeat(32);
function req(over){
  return Object.assign({ method: "POST",
    headers: { origin: "https://estimate-analyzer-atb.vercel.app", "content-type": "application/json", "x-forwarded-for": "203.0.113.120" },
    body: { op: "get", token: TOK } }, over);
}

(async function(){
let r = mockRes(); await api(req({}), r);
eq(r.out.code, 500, "missing Blob store returns 500");
process.env.BLOB_READ_WRITE_TOKEN = "fake-token-guards-only";
r = mockRes(); await api(req({ method: "GET" }), r);
eq(r.out.code, 405, "GET is refused");
r = mockRes(); await api(req({ headers: { origin: "https://evil-site.vercel.app", "content-type": "application/json" } }), r);
eq(r.out.code, 403, "foreign origin is refused");
r = mockRes(); await api(req({ body: { op: "get", token: "short" } }), r);
eq(r.out.code, 400, "malformed token is refused");
r = mockRes(); await api(req({ body: { op: "put", token: TOK, data: "not json {{" } }), r);
eq(r.out.code, 400, "non-JSON snapshot data is refused");
r = mockRes(); await api(req({ body: { op: "put", token: TOK, data: '"' + "x".repeat(api.MAX_DATA_CHARS) + '"' } }), r);
eq(r.out.code, 400, "oversized snapshot is refused");
r = mockRes(); await api(req({ body: { op: "hack", token: TOK } }), r);
eq(r.out.code, 400, "unknown op is refused");
ok(!api.hostAllowed("evil-site.vercel.app") && api.hostAllowed("estimate-analyzer-atb.vercel.app"), "host allowlist matches the other endpoints");
const T0 = 1754200000000;
let out = null;
for(let i = 0; i < 21; i++){ out = api.rateCheck("198.51.100.140", T0 + i * 100); }
eq(out.ok, false, "21st request in a minute is blocked");

if(failures){ console.error("\n" + failures + " portal test(s) failed."); process.exit(1); }
console.log("\nAll client portal invariants passed.");
})();
