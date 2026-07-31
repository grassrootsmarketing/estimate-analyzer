// test/lead.test.js
// Zero-network Node test for the /api/lead guard rails: origin perimeter,
// honeypot, field validation, inbox-key verification, and rate limits.
// Every request here is rejected or short-circuited before any Blob call.
// Run from the repo root:  node test/lead.test.js   (npm install once, for @vercel/blob)

delete process.env.BLOB_READ_WRITE_TOKEN;
const api = require("../api/lead.js");

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
  return { setHeader: function(k, v){ out.headers[k] = v; },
    status: function(c){ out.code = c; return { json: function(b){ out.body = b; } }; }, out: out };
}
const GOOD_TO = "b".repeat(64);
function req(over){
  return Object.assign({ method: "POST",
    headers: { origin: "https://estimate-analyzer-atb.vercel.app", "content-type": "application/json", "x-forwarded-for": "203.0.113.90" },
    body: {} }, over);
}
function body(b, ip){
  return req({ body: b, headers: { origin: "https://estimate-analyzer-atb.vercel.app", "content-type": "application/json", "x-forwarded-for": ip || "203.0.113.90" } });
}

(async function(){

// 1. Inbox id derivation: stable across formatting, one-way, correct shape
const idA = api.leadIdOf("EA12-CD34-EF56-GH78");
eq(idA, api.leadIdOf(" ea12 cd34 ef56 gh78 "), "inbox id is stable across code formatting");
ok(/^[0-9a-f]{64}$/.test(idA), "inbox id is sha-256 hex");
ok(idA !== api.leadIdOf("EA12-CD34-EF56-GH79"), "different codes give different inboxes");

// 2. Perimeter matches the other endpoints
ok(!api.hostAllowed("evil-site.vercel.app") && api.hostAllowed("estimate-analyzer-atb.vercel.app"), "host allowlist matches the app's endpoints");
ok(!api.originAllowed("", ""), "naked requests are rejected");

// 3. Unconfigured store fails helpfully
let r = mockRes();
await api(body({ op: "submit", to: GOOD_TO, name: "Marisol", phone: "323", desc: "retile two bathrooms" }), r);
eq(r.out.code, 500, "missing Blob store returns 500");

process.env.BLOB_READ_WRITE_TOKEN = "fake-token-guards-only";

// 4. Method / origin / content-type guards
r = mockRes(); await api(req({ method: "GET" }), r);
eq(r.out.code, 405, "GET is refused");
r = mockRes(); await api(req({ headers: { origin: "https://evil-site.vercel.app", "content-type": "application/json" } }), r);
eq(r.out.code, 403, "foreign origin is refused");
r = mockRes(); await api(req({ headers: { origin: "https://estimate-analyzer-atb.vercel.app", "content-type": "text/plain" } }), r);
eq(r.out.code, 415, "non-JSON is refused");

// 5. Submit validation (all fail before storage is touched)
r = mockRes(); await api(body({ op: "submit", to: "nope", name: "Marisol", phone: "323", desc: "retile bathrooms" }), r);
eq(r.out.code, 400, "malformed inbox id is refused");
r = mockRes(); await api(body({ op: "submit", to: GOOD_TO, website: "spam.biz", name: "Bot", phone: "1", desc: "buy pills" }), r);
eq(r.out.code, 200, "honeypot submissions get a fake success");
eq(r.out.body.ok, true, "honeypot response looks real to the bot");
r = mockRes(); await api(body({ op: "submit", to: GOOD_TO, name: "M", phone: "323", desc: "retile bathrooms" }), r);
eq(r.out.code, 400, "one-letter name is refused");
r = mockRes(); await api(body({ op: "submit", to: GOOD_TO, name: "Marisol", desc: "retile bathrooms" }), r);
eq(r.out.code, 400, "no phone and no email is refused");
r = mockRes(); await api(body({ op: "submit", to: GOOD_TO, name: "Marisol", phone: "323", desc: "hi" }), r);
eq(r.out.code, 400, "empty job description is refused");

// 6. Inbox reads require a plausible key; remove is scoped to your own prefix
r = mockRes(); await api(body({ op: "list", key: "short" }, "203.0.113.91"), r);
eq(r.out.code, 400, "too-short inbox key is refused");
r = mockRes(); await api(body({ op: "remove", key: "EA12-CD34-EF56-GH78", names: ["leads/" + "f".repeat(64) + "/l1.json"] }, "203.0.113.92"), r);
eq(r.out.code, 400, "removing another inbox's requests is refused");
r = mockRes(); await api(body({ op: "hack", key: "EA12-CD34-EF56-GH78" }, "203.0.113.93"), r);
eq(r.out.code, 400, "unknown op is refused");

// 7. clip() normalizes whitespace and caps length
eq(api.clip("  two   bathrooms \n retile  ", 600), "two bathrooms retile", "clip collapses whitespace");
eq(api.clip("x".repeat(700), 600).length, 600, "clip caps at the field limit");

// 8. Rate limits: tighter than the app endpoints (public form)
const T0 = 1754100000000;
let out = null;
for(let i = 0; i < 7; i++){ out = api.rateCheck("198.51.100.80", T0 + i * 100); }
eq(out.ok, false, "7th request in a minute is blocked");
const later = api.rateCheck("198.51.100.80", T0 + 61000);
eq(later.ok, true, "burst clears after a minute");

if(failures){ console.error("\n" + failures + " lead test(s) failed."); process.exit(1); }
console.log("\nAll lead capture invariants passed.");
})();
