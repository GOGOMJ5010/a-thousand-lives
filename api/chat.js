// A Thousand Lives: live answers from NVIDIA Nemotron on Nebius Token Factory.
// The key never reaches the browser. Set NEBIUS_API_KEY in the host's environment variables.
const BASE = (process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1/").replace(/\/?$/, "/");
const MODEL = process.env.NEBIUS_MODEL || "nvidia/nemotron-3-super-120b-a12b";
const FALLBACK = process.env.NEBIUS_MODEL_FALLBACK || "nvidia/nvidia-nemotron-3-nano-30b-a3b";

export const config = { maxDuration: 60 };
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
    if (r.ok) { const d = await r.json(); let text = strip(d.choices?.[0]?.message?.content);
      if (!json && d.choices?.[0]?.finish_reason === "length") { const k = Math.max(text.lastIndexOf("."), text.lastIndexOf("?"), text.lastIndexOf("!")); if (k > 20) text = text.slice(0, k + 1); }
      return { model, text }; }
    last = r.status + " " + clip(await r.text(), 300);
    if (r.status === 401 || r.status === 403) break; // bad key: a second model will not help
  }
  throw new Error(last);
}

async function tavily(query) {
  if (!process.env.TAVILY_API_KEY) return [];
  try {
    const r = await fetch("https://api.tavily.com/search", { method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + process.env.TAVILY_API_KEY },
      body: JSON.stringify({ query: clip(query, 300), max_results: 5, search_depth: "basic" }) });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.results || []).map(x => ({ title: clip(x.title, 120), url: clip(x.url, 400), content: clip(x.content, 700) }));
  } catch (e) { return []; }
}

function context(b) {
  const lang = b.lang === "ko" ? "Korean" : "English";
  return { lang, base:
`You are part of "A Thousand Lives", a simulator that ran one person's decision 1,000 times over 10 years using researched statistics.
The person's decision: ${clip(b.decision, 300)}
What they told us about themselves:
${clip(b.profile, 2500)}
Rules: answer in ${lang}. Use only the facts given. Never invent numbers, companies or events that are not in the facts. No advice-column tone, no bullet points, no markdown.${lang==="Korean"?" Speak in casual Korean (반말), the way a person talks to themselves. Never use 존댓말.":""}` };
}

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ ok: true, hasKey: !!process.env.NEBIUS_API_KEY, hasSearch: !!process.env.TAVILY_API_KEY, model: MODEL });
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
      ], { max: 1200 });
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
      ], { json: true, max: 3500 });
      const m = out.text.match(/\{[\s\S]*\}/);
      const j = JSON.parse(m ? m[0] : out.text);
      return res.status(200).json({ options: j.options, answers: j.answers, takeaway: j.takeaway, model: out.model });
    }
    if (b.kind === "plan") {
      const ko = b.lang === "ko", lang = ko ? "Korean" : "English";
      const [s1, s2] = await Promise.all([
        tavily(q + (ko ? " 통계 비율 성공률 실패율" : " statistics success rate failure rate data")),
        tavily(q + (ko ? " 후회 만족도 장기 결과 조사" : " regret satisfaction long-term outcomes survey")),
      ]);
      const seen = new Set(), sources = [...s1, ...s2].filter(x => x.url && !seen.has(x.url) && seen.add(x.url)).slice(0, 8);
      const out = await complete([
        { role: "system", content: `You design a 10-year simulation of one personal decision for "A Thousand Lives". The person either takes a new path or stays as they are. Write all text in ${lang}${ko ? " (questions and labels in polite 존댓말)" : ""}.
Return ONLY JSON with this shape:
{"type":"startup"|"other"|"invalid",
 "v":{"act":"short noun for the new path","doing":"short phrase meaning still on the new path","start":"short noun for the starting event","fallback":"short phrase for what happens after stopping","base":"short phrase meaning: if I had not done it","metric":"what is measured, such as income or life satisfaction"},
 "questions":[{"q":"question about this person's situation that changes the odds","o":["option","option","option"],"risk":[1.3,1.0,0.75]}],
 "hazard":[ten numbers],"hzSrc":source index or -1,
 "start":number,"growth":number,"vol":number,"cap":number,"fallback":number,"cost":number,
 "facts":[{"t":"one sentence stating a number used","s":source index or -1}]}
Rules:
- type "startup" only when the decision is about leaving a job to start a business or go freelance. Then return {"type":"startup"} and nothing else.
- type "invalid" when the text is not a personal life decision. Then return {"type":"invalid"}.
- Exactly 7 questions, 3 options each. risk is the multiplier on the yearly chance of stopping for each option (0.6 to 1.6; higher is riskier).
- hazard: chance in each of years 1 to 10 that the person stops or the new path ends that year (0.01 to 0.4). Use the sources when they give rates.
- The metric is an index where 1.0 means "the same as if I had not done it". start: index in year 1. growth: average yearly growth of the index while continuing. vol: yearly volatility. cap: maximum index. fallback: index after stopping. cost: upfront cost measured in years of the baseline.
- facts: 3 to 5 sentences. Each must be supported by the source whose index you give in "s". If a number is your own estimate, set "s" to -1 and say it is an assumption. Never attribute an invented number to a source.
- Korean example of v for studying abroad: {"act":"유학","doing":"유학 중","start":"출국","fallback":"귀국 후 취업","base":"가지 않았다면","metric":"소득"}` },
        { role: "user", content: `Decision: ${q}\n\nSearch results (index, title, text):\n${sources.map((x, i) => `[${i}] ${x.title}\n${x.content}`).join("\n\n") || "(no search results)"}` },
      ], { json: true, max: 4500 });
      const m = out.text.match(/\{[\s\S]*\}/); const j = JSON.parse(m ? m[0] : out.text);
      if (j.type === "startup") return res.status(200).json({ startup: true });
      const num = (x, lo, hi, d) => { x = Number(x); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
      const si = x => { x = Number(x); return Number.isInteger(x) && x >= 0 && x < sources.length ? x : -1; };
      const qs = (Array.isArray(j.questions) ? j.questions : []).filter(x => x && x.q && Array.isArray(x.o) && x.o.length >= 2).slice(0, 8)
        .map(x => { const o = x.o.slice(0, 4).map(y => clip(y, 40)); return { q: clip(x.q, 90), o, risk: o.map((_, k) => num((x.risk || [])[k], 0.5, 1.8, 1)) }; });
      const hz = Array.isArray(j.hazard) ? j.hazard : [];
      if (j.type === "invalid" || qs.length < 4 || hz.length < 5 || !j.v) return res.status(200).json({ ok: false });
      const v = {}; for (const k of ["act", "doing", "start", "fallback", "base", "metric"]) v[k] = clip(j.v[k] || "", 30);
      if (!v.act || !v.doing || !v.base || !v.metric) return res.status(200).json({ ok: false });
      const facts = (Array.isArray(j.facts) ? j.facts : []).filter(f => f && f.t).slice(0, 5).map(f => ({ t: clip(f.t, 220), s: si(f.s) }));
      const used = [...new Set(facts.map(f => f.s).concat([si(j.hzSrc)]).filter(x => x >= 0))], remap = {}; used.forEach((x, k) => remap[x] = k);
      const spec = { v, questions: qs, hazard: Array.from({ length: 10 }, (_, k) => num(hz[Math.min(k, hz.length - 1)], 0.005, 0.5, 0.08)), hzSrc: si(j.hzSrc) >= 0 ? remap[si(j.hzSrc)] : -1,
        start: num(j.start, 0.2, 1.5, 0.8), growth: num(j.growth, -0.05, 0.4, 0.08), vol: num(j.vol, 0.05, 0.4, 0.15), cap: num(j.cap, 1, 6, 3), fallback: num(j.fallback, 0.3, 1.2, 0.9), cost: num(j.cost, 0, 3, 0.3),
        facts: facts.map(f => ({ t: f.t, s: f.s >= 0 ? remap[f.s] : -1 })), sources: used.map(x => ({ title: sources[x].title, url: sources[x].url })) };
      return res.status(200).json({ ok: true, spec, searched: sources.length, model: out.model });
    }
    return res.status(400).json({ error: "kind" });
  } catch (e) {
    return res.status(502).json({ error: "upstream", detail: clip(e.message, 200) });
  }
}
