// /api/backup.js — encrypted cloud backup for the Estimate Analyzer.
// Storage: Vercel Blob (connect a Blob store to this project; it injects
// BLOB_READ_WRITE_TOKEN). The server only ever sees AES-GCM ciphertext: the
// client encrypts with a key derived from the user's sync code, and the
// storage path is a SHA-256 hash of that code. No accounts, no PII.
//
// Ops (POST JSON):
//   {op:"status", id}                     -> {exists, parts, bytes, ts} | {exists:false}
//   {op:"put",    id, n, of, data}        -> stores ciphertext part n of of (base64)
//   {op:"commit", id, of, bytes, ts}      -> writes the manifest, prunes stale parts
//   {op:"get",    id, n}                  -> {data} ciphertext part n (base64)
//   {op:"wipe",   id}                     -> deletes the backup entirely
//
// Same hardening posture as /api/structure: strict origin allowlist, burst +
// daily rate limits, payload caps, no caching.
const { put, list, del } = require("@vercel/blob");

const ID_RE = /^[0-9a-f]{64}$/;               // SHA-256 hex of the sync code
const MAX_PARTS = 16;                         // 16 x ~2.2MB binary ≈ 35MB backup ceiling
const MAX_PART_CHARS = 3200000;               // base64 chars per part (fits Vercel's request cap)
const PREFIX = "ea-backups/";

function hostAllowed(h){
  if(!h) return false;
  h = String(h).toLowerCase();
  return h === "estimate-analyzer-atb.vercel.app"
    || (/^estimate-analyzer-atb-[a-z0-9-]+\.vercel\.app$/.test(h))
    || h === "localhost" || /^localhost:\d+$/.test(h)
    || h === "127.0.0.1" || /^127\.0\.0\.1:\d+$/.test(h);
}
function originAllowed(origin, referer){
  function hostOf(u){ try{ return new URL(u).host; }catch(e){ return null; } }
  if(origin) return hostAllowed(hostOf(origin));
  if(referer) return hostAllowed(hostOf(referer));
  return false;
}

const RL = {};
const DAY_MAX = 400, BURST_MAX = 24, BURST_WINDOW_MS = 60000, RL_MAX_IPS = 5000;
function rateCheck(ip, now){
  const keys = Object.keys(RL);
  if(keys.length > RL_MAX_IPS){ for(let i = 0; i < 1000; i++) delete RL[keys[i]]; }
  const day = new Date(now).toISOString().slice(0, 10);
  let rec = RL[ip];
  if(!rec || rec.day !== day){ rec = RL[ip] = { day: day, count: 0, stamps: [] }; }
  rec.stamps = rec.stamps.filter(function(t){ return now - t < BURST_WINDOW_MS; });
  if(rec.count >= DAY_MAX) return { ok: false, status: 429, error: "Daily backup limit reached. Try again tomorrow." };
  if(rec.stamps.length >= BURST_MAX) return { ok: false, status: 429, error: "Too many requests. Give it a minute and try again." };
  rec.count++; rec.stamps.push(now);
  return { ok: true };
}

function partPath(id, n){ return PREFIX + id + "/p" + n; }
function manifestPath(id){ return PREFIX + id + "/manifest.json"; }

async function findBlob(pathname, token){
  const r = await list({ prefix: pathname, limit: 5, token: token });
  const hit = (r.blobs || []).find(function(b){ return b.pathname === pathname; });
  return hit || null;
}
async function fetchBlobText(url){
  const r = await fetch(url, { cache: "no-store" });
  if(!r.ok) throw new Error("blob fetch " + r.status);
  return r.text();
}

async function handler(req, res){
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if(req.method !== "POST"){ res.status(405).json({ error: "POST only" }); return; }
  if(!originAllowed(req.headers.origin || "", req.headers.referer || "")){ res.status(403).json({ error: "forbidden" }); return; }
  const ct = String(req.headers["content-type"] || "");
  if(ct.indexOf("application/json") < 0){ res.status(415).json({ error: "JSON only" }); return; }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if(!token){ res.status(500).json({ error: "Cloud backup isn't set up yet. Connect a Blob store to the Vercel project." }); return; }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const rl = rateCheck(ip, Date.now());
  if(!rl.ok){ res.status(rl.status).json({ error: rl.error }); return; }

  let body = req.body;
  if(typeof body === "string"){ try{ body = JSON.parse(body); }catch(e){ body = {}; } }
  body = body || {};
  const op = String(body.op || "");
  const id = String(body.id || "");
  if(!ID_RE.test(id)){ res.status(400).json({ error: "bad id" }); return; }

  try{
    if(op === "status"){
      const m = await findBlob(manifestPath(id), token);
      if(!m){ res.status(200).json({ exists: false }); return; }
      const man = JSON.parse(await fetchBlobText(m.url));
      res.status(200).json({ exists: true, parts: man.parts, bytes: man.bytes, ts: man.ts });
      return;
    }
    if(op === "put"){
      const n = body.n, of = body.of, data = body.data;
      if(!Number.isInteger(n) || !Number.isInteger(of) || n < 0 || of < 1 || of > MAX_PARTS || n >= of){ res.status(400).json({ error: "bad part index" }); return; }
      if(typeof data !== "string" || !data.length || data.length > MAX_PART_CHARS || /[^A-Za-z0-9+/=]/.test(data)){ res.status(400).json({ error: "bad part data" }); return; }
      await put(partPath(id, n), data, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "text/plain", token: token });
      res.status(200).json({ ok: true, n: n });
      return;
    }
    if(op === "commit"){
      const of = body.of;
      if(!Number.isInteger(of) || of < 1 || of > MAX_PARTS){ res.status(400).json({ error: "bad part count" }); return; }
      const bytes = Number.isFinite(+body.bytes) ? Math.max(0, Math.round(+body.bytes)) : 0;
      const ts = Number.isFinite(+body.ts) ? +body.ts : Date.now();
      const man = { v: 1, parts: of, bytes: bytes, ts: ts };
      await put(manifestPath(id), JSON.stringify(man), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", token: token });
      // prune parts from an older, larger backup so restores can't mix versions
      try{
        const all = await list({ prefix: PREFIX + id + "/", limit: 100, token: token });
        const stale = (all.blobs || []).filter(function(b){
          const m2 = b.pathname.match(/\/p(\d+)$/); return m2 && parseInt(m2[1], 10) >= of;
        });
        for(const b of stale){ await del(b.url, { token: token }); }
      }catch(e){}
      res.status(200).json({ ok: true, ts: ts });
      return;
    }
    if(op === "get"){
      const n = body.n;
      if(!Number.isInteger(n) || n < 0 || n >= MAX_PARTS){ res.status(400).json({ error: "bad part index" }); return; }
      const b = await findBlob(partPath(id, n), token);
      if(!b){ res.status(404).json({ error: "No backup found for that code." }); return; }
      const data = await fetchBlobText(b.url);
      res.status(200).json({ data: data });
      return;
    }
    if(op === "wipe"){
      const all = await list({ prefix: PREFIX + id + "/", limit: 100, token: token });
      for(const b of (all.blobs || [])){ await del(b.url, { token: token }); }
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ error: "bad op" });
  }catch(e){
    res.status(502).json({ error: "Cloud storage hiccup. Try again in a moment." });
  }
}

module.exports = handler;
// exported for test/backup.test.js (guard tests only; no network, no blob calls)
module.exports.originAllowed = originAllowed;
module.exports.hostAllowed = hostAllowed;
module.exports.rateCheck = rateCheck;
module.exports.ID_RE = ID_RE;
module.exports.MAX_PARTS = MAX_PARTS;
module.exports.MAX_PART_CHARS = MAX_PART_CHARS;
