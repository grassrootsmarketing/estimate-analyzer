// /api/structure.js — turns a spoken/typed job description into structured estimate line items via Claude Haiku.
// REQUIRES env var ANTHROPIC_API_KEY (Vercel → Project → Settings → Environment Variables). The key never reaches the client.
//
// Hardening (Codex audit): strict origin allowlist (this project's hosts only, no
// blanket *.vercel.app), Origin-or-Referer required, per-IP burst + daily limits with
// a bounded map, payload size and content-type checks, upstream timeout, and
// server-side clamping of model output so a bad line can never carry negative money.
const HAIKU = "claude-haiku-4-5-20251001";
const CATS = ["Subcontractor", "Materials", "Equipment / rental", "Permits / fees", "Dump / disposal", "Owner labor"];

// ---- origin allowlist: production host, this project's preview deploys, local dev ----
function hostAllowed(h){
  if(!h) return false;
  h = String(h).toLowerCase();
  return h === "estimate-analyzer-atb.vercel.app"
    || (/^estimate-analyzer-atb-[a-z0-9-]+\.vercel\.app$/.test(h))   // Vercel preview URLs for this project
    || h === "localhost" || /^localhost:\d+$/.test(h)
    || h === "127.0.0.1" || /^127\.0\.0\.1:\d+$/.test(h);
}
function originAllowed(origin, referer){
  function hostOf(u){ try{ return new URL(u).host; }catch(e){ return null; } }
  if(origin) return hostAllowed(hostOf(origin));
  if(referer) return hostAllowed(hostOf(referer));
  return false;   // browsers always send Origin on POST; naked requests are rejected
}

// ---- rate limiting: burst + daily, per IP, bounded in-memory map (best effort per instance) ----
const RL = {};
const DAY_MAX = 50, BURST_MAX = 8, BURST_WINDOW_MS = 60000, RL_MAX_IPS = 5000;
function rateCheck(ip, now){
  const keys = Object.keys(RL);
  if(keys.length > RL_MAX_IPS){ for(let i = 0; i < 1000; i++) delete RL[keys[i]]; }   // bound memory under address churn
  const day = new Date(now).toISOString().slice(0, 10);
  let rec = RL[ip];
  if(!rec || rec.day !== day){ rec = RL[ip] = { day: day, count: 0, stamps: [] }; }
  rec.stamps = rec.stamps.filter(function(t){ return now - t < BURST_WINDOW_MS; });
  if(rec.count >= DAY_MAX) return { ok: false, status: 429, error: "Daily limit reached. Try again tomorrow." };
  if(rec.stamps.length >= BURST_MAX) return { ok: false, status: 429, error: "Too many requests. Give it a minute and try again." };
  rec.count++; rec.stamps.push(now);
  return { ok: true };
}

// ---- server-side money clamps (mirror the client's boundary guards) ----
function clampQty(n){ return (typeof n === "number" && isFinite(n)) ? Math.min(100000, Math.max(0, n)) : 1; }
function clampMoney(n){ return (typeof n === "number" && isFinite(n)) ? Math.min(5000000, Math.max(0, n)) : null; }

async function handler(req, res){
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if(req.method !== "POST"){ res.status(405).json({ error: "POST only" }); return; }
  if(!originAllowed(req.headers.origin || "", req.headers.referer || "")){ res.status(403).json({ error: "forbidden" }); return; }

  const ct = String(req.headers["content-type"] || "");
  if(ct.indexOf("application/json") < 0){ res.status(415).json({ error: "JSON only" }); return; }
  const cl = parseInt(req.headers["content-length"] || "0", 10);
  if(cl > 20000){ res.status(413).json({ error: "That description is too long. Keep it under a few paragraphs." }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if(!key){ res.status(500).json({ error: "Voice parser isn't configured yet (missing API key)." }); return; }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const rl = rateCheck(ip, Date.now());
  if(!rl.ok){ res.status(rl.status).json({ error: rl.error }); return; }

  let body = req.body;
  if(typeof body === "string"){ try{ body = JSON.parse(body); }catch(e){ body = {}; } }
  const transcript = String((body && body.transcript) || "").slice(0, 4000).trim();
  if(!transcript){ res.status(400).json({ error: "Empty description" }); return; }

  const system =
    "You convert a contractor's spoken job description into structured estimate line items. " +
    "Return ONLY valid JSON — no prose, no markdown fences — matching exactly this shape: " +
    '{"lines":[{"description":string,"category":string,"qty":number,"unit":number|null,"cost":number|null,"flagged":boolean,"flagReason":string}],"notes":string}. ' +
    "category MUST be exactly one of: " + CATS.join(", ") + ". " +
    "HARD RULE: never invent a number the speaker did not say. If a quantity, unit rate, or cost was not clearly stated, set the missing value(s) to null, set flagged=true, and put a short flagReason like 'no amount given'. " +
    "Only fill cost = qty * unit when BOTH qty and unit were clearly stated. Keep descriptions short (a few words). Maximum 40 lines. Output JSON only.";

  async function ask(){
    const ac = new AbortController();
    const timer = setTimeout(function(){ ac.abort(); }, 15000);
    try{
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: HAIKU, max_tokens: 1500, system: system, messages: [{ role: "user", content: transcript }] }),
        signal: ac.signal
      });
      if(!r.ok){ const t = await r.text().catch(function(){ return ""; }); throw new Error("upstream " + r.status + " " + t.slice(0, 140)); }
      const j = await r.json();
      let txt = (j.content && j.content[0] && j.content[0].text) || "";
      txt = txt.replace(/```json\s*|\s*```/g, "").trim();
      const m = txt.match(/\{[\s\S]*\}/); if(m) txt = m[0];
      return JSON.parse(txt);
    } finally { clearTimeout(timer); }
  }

  try{
    let data;
    try{ data = await ask(); }
    catch(e1){ data = await ask(); } // one retry on malformed output
    let lines = Array.isArray(data.lines) ? data.lines.slice(0, 40) : [];
    lines = lines.map(function(l){
      return {
        description: String((l && l.description) || "").slice(0, 80),
        category: CATS.indexOf(l && l.category) >= 0 ? l.category : "Materials",
        qty: clampQty(l && l.qty),
        unit: clampMoney(l && l.unit),
        cost: clampMoney(l && l.cost),
        flagged: !!(l && l.flagged),
        flagReason: String((l && l.flagReason) || "").slice(0, 80)
      };
    });
    res.status(200).json({ lines: lines, notes: String(data.notes || "").slice(0, 200) });
  }catch(e){
    res.status(502).json({ error: "Couldn't understand that description. Try again, or enter the lines manually." });
  }
}

module.exports = handler;
// exported for test/api.test.js (zero-dependency guard tests; no network involved)
module.exports.originAllowed = originAllowed;
module.exports.hostAllowed = hostAllowed;
module.exports.rateCheck = rateCheck;
module.exports.clampQty = clampQty;
module.exports.clampMoney = clampMoney;
module.exports._RL = RL;
