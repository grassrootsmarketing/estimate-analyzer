// /api/portal.js — read-only client portal snapshots for Homestead.
// The owner's app publishes a client-safe snapshot (built by portalSnapshot();
// costs and margins are structurally excluded) to a random 128-bit capability
// token. Anyone with the link can read that one snapshot; nothing else.
// Storage: Vercel Blob (BLOB_READ_WRITE_TOKEN).
//
// Ops (POST JSON):
//   {op:"put",  token, data}   -> stores the snapshot JSON (string, capped)
//   {op:"get",  token}         -> {data} the snapshot JSON string
//   {op:"wipe", token}         -> deletes the snapshot (portal turned off)
const { put, list, del } = require("@vercel/blob");

const TOKEN_RE = /^[0-9a-f]{32}$/;
const MAX_DATA_CHARS = 3800000;      // snapshot cap; fits Vercel's request/response limits
const PREFIX = "portals/";

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
const DAY_MAX = 300, BURST_MAX = 20, BURST_WINDOW_MS = 60000, RL_MAX_IPS = 5000;
function rateCheck(ip, now){
  const keys = Object.keys(RL);
  if(keys.length > RL_MAX_IPS){ for(let i = 0; i < 1000; i++) delete RL[keys[i]]; }
  const day = new Date(now).toISOString().slice(0, 10);
  let rec = RL[ip];
  if(!rec || rec.day !== day){ rec = RL[ip] = { day: day, count: 0, stamps: [] }; }
  rec.stamps = rec.stamps.filter(function(t){ return now - t < BURST_WINDOW_MS; });
  if(rec.count >= DAY_MAX) return { ok: false, status: 429, error: "Daily limit reached. Try again tomorrow." };
  if(rec.stamps.length >= BURST_MAX) return { ok: false, status: 429, error: "Too many requests. Give it a minute and try again." };
  rec.count++; rec.stamps.push(now);
  return { ok: true };
}

function blobPath(token){ return PREFIX + token + ".json"; }
async function findBlob(pathname, token){
  const r = await list({ prefix: pathname, limit: 5, token: token });
  const hit = (r.blobs || []).find(function(b){ return b.pathname === pathname; });
  return hit || null;
}

async function handler(req, res){
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if(req.method !== "POST"){ res.status(405).json({ error: "POST only" }); return; }
  if(!originAllowed(req.headers.origin || "", req.headers.referer || "")){ res.status(403).json({ error: "forbidden" }); return; }
  const ct = String(req.headers["content-type"] || "");
  if(ct.indexOf("application/json") < 0){ res.status(415).json({ error: "JSON only" }); return; }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if(!blobToken){ res.status(500).json({ error: "The portal isn't set up yet. Connect a Blob store to the Vercel project." }); return; }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const rl = rateCheck(ip, Date.now());
  if(!rl.ok){ res.status(rl.status).json({ error: rl.error }); return; }

  let body = req.body;
  if(typeof body === "string"){ try{ body = JSON.parse(body); }catch(e){ body = {}; } }
  body = body || {};
  const op = String(body.op || "");
  const token = String(body.token || "").toLowerCase();
  if(!TOKEN_RE.test(token)){ res.status(400).json({ error: "This portal link is not valid." }); return; }

  try{
    if(op === "put"){
      const data = body.data;
      if(typeof data !== "string" || data.length < 2 || data.length > MAX_DATA_CHARS){ res.status(400).json({ error: "bad data" }); return; }
      try{ JSON.parse(data); }catch(e){ res.status(400).json({ error: "bad data" }); return; }
      await put(blobPath(token), data, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", token: blobToken });
      res.status(200).json({ ok: true });
      return;
    }
    if(op === "get"){
      const b = await findBlob(blobPath(token), blobToken);
      if(!b){ res.status(404).json({ error: "This portal link isn't active." }); return; }
      const r = await fetch(b.url, { cache: "no-store" });
      if(!r.ok) throw new Error("blob fetch " + r.status);
      const data = await r.text();
      res.status(200).json({ data: data });
      return;
    }
    if(op === "wipe"){
      const b = await findBlob(blobPath(token), blobToken);
      if(b) await del(b.url, { token: blobToken });
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ error: "bad op" });
  }catch(e){
    res.status(502).json({ error: "Storage hiccup. Try again in a moment." });
  }
}

module.exports = handler;
// exported for test/portal.test.js (guard tests only; no network, no blob calls)
module.exports.originAllowed = originAllowed;
module.exports.hostAllowed = hostAllowed;
module.exports.rateCheck = rateCheck;
module.exports.TOKEN_RE = TOKEN_RE;
module.exports.MAX_DATA_CHARS = MAX_DATA_CHARS;
