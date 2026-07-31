// test/api.test.js
// Zero-dependency Node test for the /api/structure guard rails. No network calls:
// every request here is rejected by a guard before the upstream fetch is reached.
// Run from the repo root:  node test/api.test.js   (alongside math.test.js and pm.test.js)

process.env.ANTHROPIC_API_KEY = "test-key-never-used";

const api = require("../api/structure.js");

let failures = 0;
function ok(cond, label){
  if(cond) console.log("ok   " + label);
  else { failures++; console.error("FAIL " + label); }
}
function eq(actual, expected, label){
  if(actual === expected) console.log("ok   " + label + " = " + JSON.stringify(actual));
  else { failures++; console.error("FAIL " + label + ": got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected)); }
}

function mockRes(){
  const out = { code: null, body: null, headers: {} };
  return {
    setHeader: function(k, v){ out.headers[k] = v; },
    status: function(c){ out.code = c; return { json: function(b){ out.body = b; } }; },
    out: out
  };
}
function req(over){
  return Object.assign({
    method: "POST",
    headers: {
      origin: "https://estimate-analyzer-atb.vercel.app",
      "content-type": "application/json",
      "content-length": "60",
      "x-forwarded-for": "203.0.113.10"
    },
    body: { transcript: "" }
  }, over);
}
function headers(over){
  return Object.assign({}, req({}).headers, over);
}

(async function(){

// 1. Host allowlist: exactly this project, nothing else on vercel.app
ok(api.hostAllowed("estimate-analyzer-atb.vercel.app"), "production host allowed");
ok(api.hostAllowed("estimate-analyzer-atb-git-main-team.vercel.app"), "this project's preview deploy allowed");
ok(!api.hostAllowed("evil-site.vercel.app"), "random vercel.app host rejected");
ok(!api.hostAllowed("estimate-analyzer.vercel.app"), "lookalike project host rejected");
ok(!api.hostAllowed("estimate-analyzer-atb.vercel.app.evil.com"), "suffix-spoof host rejected");
ok(api.hostAllowed("localhost:8901"), "local dev allowed");
ok(!api.hostAllowed("localhost.evil.com"), "localhost-prefix spoof rejected");

// 2. Origin required: no Origin and no Referer means no service
ok(!api.originAllowed("", ""), "naked request (no origin, no referer) rejected");
ok(api.originAllowed("", "https://estimate-analyzer-atb.vercel.app/index.html"), "referer fallback accepted for the real site");
ok(!api.originAllowed("https://evil-site.vercel.app", ""), "cross-site vercel origin rejected");
ok(!api.originAllowed("not a url", ""), "garbage origin rejected");

// 3. Handler-level guards
let r = mockRes();
await api(req({ method: "GET" }), r);
eq(r.out.code, 405, "GET is refused");

r = mockRes();
await api(req({ headers: headers({ origin: "https://evil-site.vercel.app" }) }), r);
eq(r.out.code, 403, "foreign origin is refused");

r = mockRes();
await api(req({ headers: headers({ origin: "" }) }), r);
eq(r.out.code, 403, "missing origin and referer is refused");

r = mockRes();
await api(req({ headers: headers({ "content-type": "text/plain" }) }), r);
eq(r.out.code, 415, "non-JSON content type is refused");

r = mockRes();
await api(req({ headers: headers({ "content-length": "999999" }) }), r);
eq(r.out.code, 413, "oversized payload is refused");

r = mockRes();
await api(req({}), r);
eq(r.out.code, 400, "empty transcript is refused");
eq(r.out.headers["Cache-Control"], "no-store", "responses are never cached");

// 4. Rate limiting: burst window, daily cap, day rollover (fixed clocks, isolated IPs)
const T0 = 1753900000000;
let blocked = null;
for(let i = 0; i < 9; i++){ blocked = api.rateCheck("198.51.100.1", T0 + i * 100); }
eq(blocked.ok, false, "9th request inside a minute is blocked");
ok(/minute/.test(blocked.error), "burst message says to wait a minute");
const later = api.rateCheck("198.51.100.1", T0 + 61000);
eq(later.ok, true, "burst window clears after a minute");

let daily = null;
for(let i = 0; i < 51; i++){ daily = api.rateCheck("198.51.100.2", T0 + i * 120000); }   // spaced 2 min apart, never bursty
eq(daily.ok, false, "51st request of the day is blocked");
ok(/tomorrow/.test(daily.error), "daily message says try again tomorrow");
const nextDay = api.rateCheck("198.51.100.2", T0 + 86400000 + 600000);
eq(nextDay.ok, true, "daily quota resets on the next day");

// 5. Handler-level 429 (rate check runs before body validation)
for(let i = 0; i < 8; i++){ r = mockRes(); await api(req({ headers: headers({ "x-forwarded-for": "198.51.100.3" }) }), r); }
r = mockRes();
await api(req({ headers: headers({ "x-forwarded-for": "198.51.100.3" }) }), r);
eq(r.out.code, 429, "handler returns 429 once the burst budget is spent");

// 6. Model-output money clamps mirror the client guards
eq(api.clampQty(-3), 0, "negative qty from the model is zeroed");
eq(api.clampQty(1e9), 100000, "absurd qty from the model is capped");
eq(api.clampQty("7"), 1, "non-numeric qty falls back to 1");
eq(api.clampMoney(-50), 0, "negative money from the model is zeroed");
eq(api.clampMoney(null), null, "null money stays null so the line stays flagged");
eq(api.clampMoney(1e9), 5000000, "absurd money from the model is capped");

if(failures){ console.error("\n" + failures + " API guard test(s) failed."); process.exit(1); }
console.log("\nAll API guard invariants passed.");
})();
