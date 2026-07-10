// /api/structure.js — turns a spoken/typed job description into structured estimate line items via Claude Haiku.
// REQUIRES env var ANTHROPIC_API_KEY (Vercel → Project → Settings → Environment Variables). The key never reaches the client.
const HAIKU = "claude-haiku-4-5-20251001";
const CATS = ["Subcontractor", "Materials", "Equipment / rental", "Permits / fees", "Dump / disposal", "Owner labor"];
const RL = {}; // in-memory rate limit, best-effort (resets on cold start)

function today(){ return new Date().toISOString().slice(0, 10); }
function originAllowed(origin){
  if(!origin) return true;              // same-origin POSTs may omit Origin; be lenient
  try{ const h = new URL(origin).host; return /\.vercel\.app$/.test(h) || h === "localhost" || /^localhost:/.test(h); }
  catch(e){ return false; }
}

module.exports = async function handler(req, res){
  if(req.method !== "POST"){ res.status(405).json({ error: "POST only" }); return; }
  if(!originAllowed(req.headers.origin || "")){ res.status(403).json({ error: "forbidden" }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if(!key){ res.status(500).json({ error: "Voice parser isn't configured yet (missing API key)." }); return; }

  // rate limit: 50 requests / IP / day
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const day = today();
  const rec = (RL[ip] && RL[ip].day === day) ? RL[ip] : (RL[ip] = { day: day, count: 0 });
  if(rec.count >= 50){ res.status(429).json({ error: "Daily limit reached — try again tomorrow." }); return; }
  rec.count++;

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
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: HAIKU, max_tokens: 1500, system: system, messages: [{ role: "user", content: transcript }] })
    });
    if(!r.ok){ const t = await r.text().catch(function(){ return ""; }); throw new Error("upstream " + r.status + " " + t.slice(0, 140)); }
    const j = await r.json();
    let txt = (j.content && j.content[0] && j.content[0].text) || "";
    txt = txt.replace(/```json\s*|\s*```/g, "").trim();
    const m = txt.match(/\{[\s\S]*\}/); if(m) txt = m[0];
    return JSON.parse(txt);
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
        qty: (typeof (l && l.qty) === "number" && isFinite(l.qty)) ? l.qty : 1,
        unit: (typeof (l && l.unit) === "number" && isFinite(l.unit)) ? l.unit : null,
        cost: (typeof (l && l.cost) === "number" && isFinite(l.cost)) ? l.cost : null,
        flagged: !!(l && l.flagged),
        flagReason: String((l && l.flagReason) || "").slice(0, 80)
      };
    });
    res.status(200).json({ lines: lines, notes: String(data.notes || "").slice(0, 200) });
  }catch(e){
    res.status(502).json({ error: "Couldn't understand that description. Try again, or enter the lines manually." });
  }
};
