// A Thousand Lives: live answers from NVIDIA Nemotron on Nebius Token Factory.
// The key never reaches the browser. Set NEBIUS_API_KEY in the host's environment variables.
const BASE = (process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1/").replace(/\/?$/, "/");
const MODEL = process.env.NEBIUS_MODEL || "nvidia/nemotron-3-super-120b-a12b";
const FALLBACK = process.env.NEBIUS_MODEL_FALLBACK || "nvidia/nvidia-nemotron-3-nano-30b-a3b";

const hits = new Map(); // tiny per-instance rate limit
function limited(ip) {
  const now = Date.now(), w = (hits.get(ip) || []).filter(t => now - t < 60000);
  w.push(now); hits.set(ip, w); return w.length > 20;
}
const clip = (x, n) => String(x == null ? "" : x).slice(0, n);
const strip = s => String(s || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();

async function complete(messages, { json = false, max = 500 } = {}) {
  let last;
  for (const model of [MODEL, FALLBACK]) {
    const r = await fetch(BASE + "chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + process.env.NEBIUS_API_KEY },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: max, ...(json ? { response_format: { type: "json_object" } } : {}) }),
    });
    if (r.ok) { const d = await r.json(); return { model, text: strip(d.choices?.[0]?.message?.content) }; }
    last = r.status + " " + clip(await r.text(), 300);
    if (r.status === 401 || r.status === 403) break; // bad key: a second model will not help
  }
  throw new Error(last);
}

function context(b) {
  const lang = b.lang === "ko" ? "Korean" : "English";
  return { lang, base:
`You are part of "A Thousand Lives", a simulator that ran one person's decision 1,000 times over 10 years using real business survival statistics.
The person's decision: ${clip(b.decision, 300)}
What they told us about themselves:
${clip(b.profile, 2500)}
Rules: answer in ${lang}. Use only the facts given. Never invent numbers, companies or events that are not in the facts. No advice-column tone, no bullet points, no markdown.${lang==="Korean"?" Speak in casual Korean (반말), the way a person talks to themselves. Never use 존댓말.":""}` };
}

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ ok: true, hasKey: !!process.env.NEBIUS_API_KEY, model: MODEL });
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!process.env.NEBIUS_API_KEY) return res.status(503).json({ error: "no key" });
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "x";
  if (limited(ip)) return res.status(429).json({ error: "slow down" });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const q = clip(b.q, 200).trim();
  if (!q) return res.status(400).json({ error: "empty" });
  const { base } = context(b);
  try {
    if (b.kind === "life") {
      const out = await complete([
        { role: "system", content: base + `\nYou are the version of this person who lived life #${clip(b.life?.n, 6)}. Speak in the first person, to your earlier self, plainly and specifically. At most 4 sentences.` },
        { role: "user", content: `Facts of the life you lived:\n${clip(JSON.stringify(b.life), 3000)}\n\nYour earlier self asks: ${q}` },
      ], { max: 350 });
      return res.status(200).json({ text: out.text, model: out.model });
    }
    if (b.kind === "crowd") {
      const lives = (Array.isArray(b.lives) ? b.lives : []).slice(0, 14);
      if (!lives.length) return res.status(400).json({ error: "no lives" });
      const out = await complete([
        { role: "system", content: base + `\nSeveral versions of this person, each of whom lived a different one of the 1,000 lives, are asked the same question. Each answers from their own facts, so people with different outcomes should often disagree.
Return ONLY JSON: {"options":[2 or 3 short answer labels, at most 3 words each, only labels that at least one life actually chooses],"answers":[{"n":life number,"option":index into options,"say":"one first-person sentence, specific to that life"}],"takeaway":"one sentence on what separates the groups"}
Include every life exactly once in answers.` },
        { role: "user", content: `Outcome counts across all lives [success, landed safely, past loss limit]: ${clip(JSON.stringify(b.counts), 60)}\nThe lives answering:\n${clip(JSON.stringify(lives), 14000)}\n\nQuestion to all of them: ${q}` },
      ], { json: true, max: 1100 });
      const m = out.text.match(/\{[\s\S]*\}/);
      const j = JSON.parse(m ? m[0] : out.text);
      return res.status(200).json({ options: j.options, answers: j.answers, takeaway: j.takeaway, model: out.model });
    }
    return res.status(400).json({ error: "kind" });
  } catch (e) {
    return res.status(502).json({ error: "upstream", detail: clip(e.message, 200) });
  }
}
