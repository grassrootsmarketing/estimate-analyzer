// test/backup.test.js
// Zero-network Node test for cloud sync: the client-side crypto pipeline
// (extracted from index.html) and the /api/backup guard rails (required
// directly with mocked req/res). Nothing here touches Vercel Blob or the net.
// Run from the repo root:  node test/backup.test.js
// Requires Node 18+ (global crypto.subtle, btoa/atob). `npm install` first so
// api/backup.js can resolve @vercel/blob.

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

// ---- extract the client sync helpers from index.html (async-aware) ----
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
const CLIENT_FNS = ["makeSyncCode","normCode","b64FromBuf","bufFromB64","splitB64","syncKey","syncId","encryptBackup","decryptBackup","mergeArchives","emptyBackupOk"];
const S = new Function(CLIENT_FNS.map(f => extractFn(html, f)).join("\n") + "\nreturn {" + CLIENT_FNS.join(",") + "};")();

(async function(){

// 1. Sync codes: format, normalization, uniqueness
const code = S.makeSyncCode();
ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), "sync code is 4x4 grouped, no ambiguous 0/1/I/L/O");
ok(S.makeSyncCode() !== S.makeSyncCode(), "codes are random");
eq(S.normCode(" ea12-cd34 ef56_gh78 "), "EA12CD34EF56GH78", "normCode strips separators and uppercases");

// 2. Base64 helpers roundtrip binary exactly
const raw = new Uint8Array(70000).map((_, i) => (i * 31) % 256);
const rt = S.bufFromB64(S.b64FromBuf(raw.buffer));
ok(rt.length === raw.length && rt.every((v, i) => v === raw[i]), "b64 helpers roundtrip 70KB of binary");
eq(S.splitB64("abcdefghij", 4).join("|"), "abcd|efgh|ij", "splitB64 chunks with a short tail");

// 3. Encrypt/decrypt roundtrip; wrong code fails closed
const payload = { v: 1, archive: [{ id: "e1", updatedTs: 5, state: { jobName: "Reyes bathroom" } }], profile: { company: "ATB" } };
const b64 = await S.encryptBackup(code, payload);
ok(b64.length > 60, "ciphertext produced");
const back = await S.decryptBackup(code, b64);
eq(back.archive[0].state.jobName, "Reyes bathroom", "decrypt with the right code restores the payload");
const b64b = await S.encryptBackup(code, payload);
ok(b64 !== b64b, "fresh IV: same payload never encrypts to the same bytes");
let wrongFailed = false;
try{ await S.decryptBackup(S.makeSyncCode(), b64); }catch(e){ wrongFailed = true; }
ok(wrongFailed, "wrong code cannot decrypt (AES-GCM auth fails)");
eq(await S.syncId(code), await S.syncId(code.toLowerCase().replace(/-/g, " ")), "storage id is stable across code formatting");
ok((await S.syncId(code)) !== (await S.syncId(S.makeSyncCode())), "different codes map to different storage ids");
ok(/^[0-9a-f]{64}$/.test(await S.syncId(code)), "storage id is a sha-256 hex, no code material leaks");

// 4. Merge: union by id, newer updatedTs wins, local never silently dropped
const local = [{ id: "a", updatedTs: 10, tag: "local" }, { id: "b", updatedTs: 5, tag: "local" }, { id: "only-local", updatedTs: 1 }];
const incoming = [{ id: "a", updatedTs: 3, tag: "cloud" }, { id: "b", updatedTs: 9, tag: "cloud" }, { id: "only-cloud", updatedTs: 2 }];
const merged = S.mergeArchives(local, incoming);
eq(merged.length, 4, "merge is a union by id");
eq(merged.find(e => e.id === "a").tag, "local", "newer local entry survives the merge");
eq(merged.find(e => e.id === "b").tag, "cloud", "newer cloud entry wins the merge");
ok(merged.some(e => e.id === "only-local") && merged.some(e => e.id === "only-cloud"), "one-sided entries are kept");

// ---- /api/backup guard rails (mocked req/res; all paths stop before Blob) ----
delete process.env.BLOB_READ_WRITE_TOKEN;
const api = require("../api/backup.js");

function mockRes(){
  const out = { code: null, body: null, headers: {} };
  return { setHeader: function(k, v){ out.headers[k] = v; },
    status: function(c){ out.code = c; return { json: function(b){ out.body = b; } }; }, out: out };
}
const GOOD_ID = "a".repeat(64);
function req(over){
  return Object.assign({ method: "POST",
    headers: { origin: "https://estimate-analyzer-atb.vercel.app", "content-type": "application/json", "x-forwarded-for": "203.0.113.50" },
    body: { op: "status", id: GOOD_ID } }, over);
}

// 5. Unconfigured store fails with a helpful message, before any rate spend
let r = mockRes();
await api(req({}), r);
eq(r.out.code, 500, "missing Blob store returns 500");
ok(/Connect a Blob store/.test(r.out.body.error), "error tells you the fix");

process.env.BLOB_READ_WRITE_TOKEN = "fake-token-guards-only";

// 6. Same perimeter as the voice endpoint
r = mockRes(); await api(req({ method: "GET" }), r);
eq(r.out.code, 405, "GET is refused");
r = mockRes(); await api(req({ headers: { origin: "https://evil-site.vercel.app", "content-type": "application/json" } }), r);
eq(r.out.code, 403, "foreign origin is refused");
ok(!api.hostAllowed("evil-site.vercel.app") && api.hostAllowed("estimate-analyzer-atb.vercel.app"), "host allowlist matches the voice endpoint");

// 7. Input validation stops bad requests before storage is touched
r = mockRes(); await api(req({ body: { op: "status", id: "short" } }), r);
eq(r.out.code, 400, "malformed backup id is refused");
r = mockRes(); await api(req({ body: { op: "put", id: GOOD_ID, n: 5, of: 3, data: "AAAA" } }), r);
eq(r.out.code, 400, "part index beyond part count is refused");
r = mockRes(); await api(req({ body: { op: "put", id: GOOD_ID, n: 0, of: 99, data: "AAAA" } }), r);
eq(r.out.code, 400, "part count beyond the 16-part cap is refused");
r = mockRes(); await api(req({ body: { op: "put", id: GOOD_ID, n: 0, of: 1, data: "not base64 !!" } }), r);
eq(r.out.code, 400, "non-base64 part data is refused");
r = mockRes(); await api(req({ body: { op: "put", id: GOOD_ID, n: 0, of: 1, data: "A".repeat(api.MAX_PART_CHARS + 1) } }), r);
eq(r.out.code, 400, "oversized part is refused");
r = mockRes(); await api(req({ body: { op: "hack", id: GOOD_ID } }), r);
eq(r.out.code, 400, "unknown op is refused");

// 8. Rate limits sized for chunked backups: 16 parts + commit fit one burst window
const T0 = 1754000000000;
let res16 = null;
for(let i = 0; i < 17; i++){ res16 = api.rateCheck("198.51.100.60", T0 + i * 200); }
eq(res16.ok, true, "a full 16-part backup plus commit fits in one burst window");
let burst = null;
for(let i = 0; i < 25; i++){ burst = api.rateCheck("198.51.100.61", T0 + i * 200); }
eq(burst.ok, false, "25th request in a minute is blocked");

// 9. Wipe guard: a device with no estimates must not overwrite a healthy cloud backup.
// This is the rule that stops local data loss from propagating to the only copy.
eq(S.emptyBackupOk([]), false, "an empty archive is not safe to upload on its own");
eq(S.emptyBackupOk(null), false, "a missing archive is not safe to upload");
eq(S.emptyBackupOk(undefined), false, "an undefined archive is not safe to upload");
eq(S.emptyBackupOk([{ id: "e1" }]), true, "one real estimate is enough to back up normally");
// the guard only bites when the cloud actually holds something worth protecting
const GUARD = Number((html.match(/const EMPTY_GUARD_BYTES\s*=\s*(\d+)/) || [])[1]);
ok(GUARD > 0, "the guard threshold is defined in the app");
const wouldHold = (localArch, cloud) => !S.emptyBackupOk(localArch) && !!(cloud && cloud.exists && (cloud.bytes || 0) > GUARD);
eq(wouldHold([], { exists: true, bytes: 137504 }), true, "empty device + real cloud backup = hold the upload");
eq(wouldHold([], { exists: true, bytes: 10 }), false, "empty device + trivial cloud copy = allow, nothing to lose");
eq(wouldHold([], { exists: false }), false, "empty device + no cloud copy = allow the first backup");
eq(wouldHold([{ id: "e1" }], { exists: true, bytes: 137504 }), false, "a device with estimates always backs up normally");

if(failures){ console.error("\n" + failures + " backup test(s) failed."); process.exit(1); }
console.log("\nAll cloud backup invariants passed.");
})();
