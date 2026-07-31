// /api/lead.js — public estimate-request inbox for the Estimate Analyzer.
// Anyone with the share link can SUBMIT a request (the link carries only a
// SHA-256 inbox id). Reading or clearing the inbox requires the raw lead code,
// which lives only on the owner's device; the server verifies sha256(code)
// against the inbox id. Storage: Vercel Blob (BLOB_READ_WRITE_TOKEN).
//
// Ops (POST JSON):
//   {op:"submit", to, name, phone, email, desc, area, timing, website}
//       website is a honeypot: bots that fill it get a fake success.
//   {op:"list",   key}          -> {leads:[{key,name,phone,email,desc,area,timing,ts}]}
//   {op:"remove", key, names}   -> deletes imported requests
const { put, list, del } = require("@vercel/blob");
const nodeCrypto = require("node:crypto");

const ID_RE = /^[0-9a-f]{64}$/;
const PREFIX = "leads/";
const INBOX_CAP = 200;                 // pending requests per inbox before we refuse new ones

function normCode(c){ return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function leadIdOf(code){ return nodeCrypto.createHash("sha256").update("ea-lead-id-v1:" + normCode(code)).digest("hex"); }
function clip(v, n){ return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); }

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
const DAY_MAX = 60, BURST_MAX = 6, BURST_WINDOW_MS = 60000, RL_MAX_IPS = 5000;
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

async function handler(req, res){
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if(req.method !== "POST"){ res.status(405).json({ error: "POST only" }); return; }
  if(!originAllowed(req.headers.origin || "", req.headers.referer || "")){ res.status(403).json({ error: "forbidden" }); return; }
  const ct = String(req.headers["content-type"] || "");
  if(ct.indexOf("application/json") < 0){ res.status(415).json({ error: "JSON only" }); return; }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if(!token){ res.status(500).json({ error: "Requests aren't set up yet. Connect a Blob store to the Vercel project." }); return; }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const rl = rateCheck(ip, Date.now());
  if(!rl.ok){ res.status(rl.status).json({ error: rl.error }); return; }

  let body = req.body;
  if(typeof body === "string"){ try{ body = JSON.parse(body); }catch(e){ body = {}; } }
  body = body || {};
  const op = String(body.op || "");

  try{
    if(op === "submit"){
      const to = String(body.to || "");
      if(!ID_RE.test(to)){ res.status(400).json({ error: "This request link is not valid." }); return; }
      if(clip(body.website, 10)){ res.status(200).json({ ok: true }); return; }   // honeypot: swallow bots silently
      const lead = {
        name: clip(body.name, 80), phone: clip(body.phone, 40), email: clip(body.email, 80),
        desc: clip(body.desc, 600), area: clip(body.area, 120), timing: clip(body.timing, 40),
        ts: Date.now()
      };
      if(lead.name.length < 2){ res.status(400).json({ error: "Please add your name." }); return; }
      if(!lead.phone && !lead.email){ res.status(400).json({ error: "Add a phone number or email so they can reach you." }); return; }
      if(lead.desc.length < 5){ res.status(400).json({ error: "Tell them a little about the job." }); return; }
      const existing = await list({ prefix: PREFIX + to + "/", limit: INBOX_CAP + 1, token: token });
      if((existing.blobs || []).length >= INBOX_CAP){ res.status(429).json({ error: "This inbox is full. Try again later." }); return; }
      const name = PREFIX + to + "/l" + lead.ts + "-" + nodeCrypto.randomBytes(16).toString("hex") + ".json";
      await put(name, JSON.stringify(lead), { access: "public", addRandomSuffix: false, contentType: "application/json", token: token });
      res.status(200).json({ ok: true });
      return;
    }

    const key = normCode(body.key);
    if(key.length < 12){ res.status(400).json({ error: "bad key" }); return; }
    const id = leadIdOf(key);

    if(op === "list"){
      const all = await list({ prefix: PREFIX + id + "/", limit: 60, token: token });
      const blobs = (all.blobs || []).slice(0, 50);
      const leads = [];
      for(const b of blobs){
        try{
          const r = await fetch(b.url, { cache: "no-store" });
          if(!r.ok) continue;
          const d = await r.json();
          leads.push({ key: b.pathname,
            name: clip(d.name, 80), phone: clip(d.phone, 40), email: clip(d.email, 80),
            desc: clip(d.desc, 600), area: clip(d.area, 120), timing: clip(d.timing, 40),
            ts: Number.isFinite(+d.ts) ? +d.ts : 0 });
        }catch(e){}
      }
      leads.sort(function(a, b){ return a.ts - b.ts; });
      res.status(200).json({ leads: leads });
      return;
    }
    if(op === "remove"){
      const names = Array.isArray(body.names) ? body.names.slice(0, 60) : [];
      const mine = names.filter(function(n){ return typeof n === "string" && n.indexOf(PREFIX + id + "/") === 0; });
      if(mine.length !== names.length){ res.status(400).json({ error: "bad names" }); return; }
      const all = await list({ prefix: PREFIX + id + "/", limit: 100, token: token });
      const byPath = {};
      (all.blobs || []).forEach(function(b){ byPath[b.pathname] = b.url; });
      for(const n of mine){ if(byPath[n]) await del(byPath[n], { token: token }); }
      res.status(200).json({ ok: true, removed: mine.length });
      return;
    }
    res.status(400).json({ error: "bad op" });
  }catch(e){
    res.status(502).json({ error: "Storage hiccup. Try again in a moment." });
  }
}

module.exports = handler;
// exported for test/lead.test.js (guard tests only; no network, no blob calls)
module.exports.originAllowed = originAllowed;
module.exports.hostAllowed = hostAllowed;
module.exports.rateCheck = rateCheck;
module.exports.leadIdOf = leadIdOf;
module.exports.normCode = normCode;
module.exports.clip = clip;
module.exports.ID_RE = ID_RE;
