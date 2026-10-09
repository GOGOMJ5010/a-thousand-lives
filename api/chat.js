// A Thousand Lives: live answers from NVIDIA Nemotron on Nebius Token Factory.
// The key never reaches the browser. Set NEBIUS_API_KEY in the host's environment variables.
const BASE = (process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1/").replace(/\/?$/, "/");
const MODEL = process.env.NEBIUS_MODEL || "nvidia/nemotron-3-super-120b-a12b";
const FALLBACK = process.env.NEBIUS_MODEL_FALLBACK || "nvidia/nvidia-nemotron-3-nano-30b-a3b";

import CARDS from "./_cards.js";
export const config = { maxDuration: 60 };
const STARTUP_IDS = CARDS.filter(c => c.type === "startup").map(c => c.id);
const CARD_LIST = CARDS.map(c => `${c.id}. ${c.title.ko} / ${c.title.en}`).join("\n");
async function pickCard(q, me) {
  const out = await complete([
    { role: "system", content: `You match a person's decision to a library of 100 researched decision cards for "A Thousand Lives".
Cards:
${CARD_LIST}

Return ONLY JSON: {"id": number, "known": {}}
- "id" is the card that is the SAME decision as the text (same choice, maybe different wording or language). If the text adds details that do not change which decision it is, it still matches. If no card is the same decision, or it is only loosely related, return 0. The card's questions must fit this person's decision: for example, going to flight school to become a pilot is not "professional certification" (that card means exams like CPA or labor attorney), so return 0. When in doubt, return 0.
- Return -1 only if the text is about self-harm, suicide, violence, abuse or a medical emergency happening now.
- Only when the chosen card is one of ${STARTUP_IDS.join(", ")}, fill "known" with answers the text states clearly, as option indexes: "ind" (0 online or software, 1 shop or retail, 2 freelance or consulting or teaching, 3 making products, 4 other), "exp" (0 none, 1 some, 2 already doing this work), "cust" (0 no paying customers, 1 a few, 2 steady sales), "team" (0 alone, 1 with partners), "inv" (0 almost no upfront money: consulting, teaching, most freelancing). Leave out anything not stated.
Example: "회사 다니면서 AI 강의와 컨설팅을 하는데 이쪽으로 전직할까?" -> {"id":12,"known":{"ind":2,"exp":2,"cust":1,"inv":0}}` },
    { role: "user", content: q + (me ? "\n\nAbout the person:\n" + me : "") },
  ], { json: true, max: 1500, temp: 0 });
  const m = out.text.match(/\{[\s\S]*\}/); const j = JSON.parse(m ? m[0] : out.text);
  const id = Number(j.id);
  if (id === -1) return { crisis: true };
  const card = CARDS.find(c => c.id === id);
  if (!card) return null;
  const kn = {}, K = { ind: 4, exp: 2, cust: 2, team: 1, inv: 3 }, jk = j.known && typeof j.known === "object" ? j.known : {};
  for (const k in K) { const x = Number(jk[k]); if (Number.isInteger(x) && x >= 0 && x <= K[k]) kn[k] = x; }
  return { card, known: kn, model: out.model };
}
function fromCard(c, ko, known) {
  const L = ko ? "ko" : "en";
  const sources = c.sources.map(s => ({ title: clip(s.title, 120), url: s.url }));
  const pt = p => ({ t: p.stat[L], place: p.place ? p.place[L] : "", agency: p.agency || "", year: p.year || "", s: p.s });
  const card = { id: c.id, title: c.title[L], sources, data: { korea: (c.korea || []).map(pt), usa: (c.usa || []).map(pt), global: (c.global || []).map(pt) } };
  const facts = c.facts.map(f => ({ t: f[L], s: f.s }));
  const questions = c.questions.map(x => ({ q: x[L], o: x.o[L], risk: x.risk }));
  if (c.type === "startup") return { startup: true, act: c.v[L].act, known, questions, card: Object.assign(card, { facts }) };
  const spec = { mode: c.type === "commit" ? "commit" : "path", v: c.v[L], questions, hazard: c.hazard, hzSrc: c.hzSrc,
    start: c.start, growth: c.growth, vol: c.vol, cap: c.cap, fallback: c.type === "commit" ? 1 : c.fallback, cost: c.type === "commit" ? 0 : c.cost,
    facts, sources, refs: [], card };
  return { ok: true, spec, searched: 0, card: c.id };
}
async function preAnswer(qs, me) {
  if (!me || !Array.isArray(qs) || !qs.length) return {};
  try {
    const out = await complete([
      { role: "system", content: `You read what a person told us about themselves and answer multiple-choice questions only where their text clearly states or directly implies the answer. Return ONLY JSON: {"answers":{"<question index>": <option index>}}. Leave out every question the text does not clearly answer. Never guess.` },
      { role: "user", content: `About the person:\n${me}\n\nQuestions:\n${qs.map((x, i) => `${i}. ${x.q} ${x.o.map((o, k) => `[${k}] ${o}`).join(" ")}`).join("\n")}` },
    ], { json: true, max: 1200, temp: 0 });
    const m = out.text.match(/\{[\s\S]*\}/); const j = JSON.parse(m ? m[0] : out.text), a = j.answers || {}, r = {};
    for (const k in a) { const i = Number(k), v = Number(a[k]); if (Number.isInteger(i) && qs[i] && Number.isInteger(v) && v >= 0 && v < qs[i].o.length) r[i] = v; }
    return r;
  } catch (e) { return {}; }
}
const hits = new Map(); // tiny per-instance rate limit
function limited(ip) {
  const now = Date.now(), w = (hits.get(ip) || []).filter(t => now - t < 60000);
  w.push(now); hits.set(ip, w); return w.length > 20;
}
const clip = (x, n) => String(x == null ? "" : x).slice(0, n);
const strip = s => String(s || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();

async function complete(messages, { json = false, max = 500, temp = 0.7 } = {}) {
  let last;
  for (const model of [MODEL, FALLBACK]) {
    const r = await fetch(BASE + "chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + process.env.NEBIUS_API_KEY },
      body: JSON.stringify({ model, messages, temperature: temp, max_tokens: max, ...(json ? { response_format: { type: "json_object" } } : {}) }),
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
      body: JSON.stringify({ query: clip(query, 300), max_results: 5, search_depth: "advanced", exclude_domains: ["namu.wiki", "reddit.com", "quora.com", "dcinside.com", "fmkorea.com", "blog.naver.com", "cafe.naver.com", "youtube.com", "tistory.com", "workingus.com", "gohackers.com", "theqoo.net", "clien.net", "instagram.com", "facebook.com", "threads.net", "x.com", "tiktok.com", "ohou.se", "pinterest.com"] }) });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.results || []).map(x => ({ title: clip(String(x.title || "").split(/ [<|] | - /)[0], 90), url: clip(x.url, 400), content: clip(x.content, 900) }));
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
Return ONLY JSON: {"options":[2 or 3 short answer labels, at most 3 words each, only labels that at least one life actually chooses],"answers":[{"n":life number,"option":index into options,"say":"one first-person sentence that names a concrete year or number from that life's record"}],"takeaway":"one sentence on what separates the groups"}
Include every life exactly once in answers.` },
        { role: "user", content: `Outcome counts across all lives [success, landed safely, past loss limit]: ${clip(JSON.stringify(b.counts), 60)}\nThe lives answering:\n${clip(JSON.stringify(lives), 14000)}\n\nQuestion to all of them: ${q}` },
      ], { json: true, max: 3500 });
      const m = out.text.match(/\{[\s\S]*\}/);
      const j = JSON.parse(m ? m[0] : out.text);
      return res.status(200).json({ options: j.options, answers: j.answers, takeaway: j.takeaway, model: out.model });
    }
    if (b.kind === "plan") {
      const ko = b.lang === "ko", lang = ko ? "Korean" : "English";
      const me = clip(b.me, 1500).trim();
      if (!b.nocard) {
        let pc = null; try { pc = await pickCard(q, me); } catch (e) { pc = null; }
        if (pc && pc.crisis) return res.status(200).json({ ok: false, why: "crisis" });
        if (pc && pc.card) { const r0 = fromCard(pc.card, ko, pc.known); r0.pre = await preAnswer(r0.questions || r0.spec.questions, me); return res.status(200).json(Object.assign(r0, { model: pc.model })); }
      }
      const [s1, s2] = await Promise.all([
        tavily(q + (ko ? " 통계 조사 보고서 비율" : " statistics report survey rate")),
        tavily(q + (ko ? " 장기 결과 연구 소득 만족도" : " long-term outcomes study income satisfaction")),
      ]);
      const seen = new Set(), sources = [...s1, ...s2].filter(x => x.url && !seen.has(x.url) && seen.add(x.url)).slice(0, 8);
      const msgs = [
        { role: "system", content: `You design a 10-year simulation of one personal decision for "A Thousand Lives". The person either takes a new path or stays as they are. Write all text in ${lang}${ko ? " (questions and labels in polite 존댓말)" : ""}.
Return ONLY JSON with this shape:
{"type":"startup"|"other"|"commit"|"invalid"|"crisis",
 "v":{"act":"short noun for the new path","doing":"short phrase meaning still on the new path","start":"short noun for the starting event","fallback":"short phrase for what happens after stopping","base":"short phrase meaning: if I had not done it","metric":"what is measured, such as income or life satisfaction"},
 "questions":[{"q":"question about this person's situation that changes the odds","o":["option","option","option"],"risk":[1.3,1.0,0.75]}],
 "hazard":[ten numbers],"hzSrc":source index or -1,
 "start":number,"growth":number,"vol":number,"cap":number,"fallback":number,"cost":number,
 "facts":[{"t":"one sentence stating a number used","s":source index or -1,"quote":"the exact words copied from that source that contain the number"}]}
Rules:
- type "startup" only when the person would found and run their own business or go freelance. Changing employers, including joining a startup as an employee, is type "other". Then return {"type":"startup","act":"short noun for this business, such as AI 강의·컨설팅","known":{},"questions":[...]} and nothing else. "known" holds only the answers the text already states clearly, as option indexes: "ind" (0 online or software, 1 shop or retail, 2 freelance or consulting or teaching, 3 making products, 4 other), "exp" (0 none, 1 some, 2 already doing this work), "cust" (0 no paying customers, 1 a few, 2 steady sales), "team" (0 alone, 1 with partners), "inv" (0 almost no upfront money, which is true for consulting, teaching and most freelancing). Leave out anything not stated. "questions" are exactly 4 questions in the same shape as above ("q", "o" with 3 options, "risk" as the multiplier on the yearly chance of the business failing, 0.6 to 1.6) about what most decides whether THIS particular business survives, beyond age, income, dependants, savings, debt, experience and customers, which are asked separately. If the person already does this on the side, ask about it: how much it earns compared with the salary, how often work comes in, where the work comes from, whether it can grow before quitting; in that case the first question must be how much the side work earns compared with the salary, with options like 월급의 절반 이상 / 10~50% / 10% 미만. Do not ask about partners or a team, which is asked separately. Example: for "회사 다니면서 AI 강의와 컨설팅을 하는데 이쪽으로 전직할까?" known is {"ind":2,"exp":2,"cust":1,"inv":0}. Follow the question rules below.
- type "invalid" when the text is not a personal life decision. Then return {"type":"invalid"}.
- type "crisis" only when the text is about self-harm, suicide, violence, abuse or a medical emergency happening now. Then return {"type":"crisis"} and nothing else.
- type "commit" when the path cannot be stopped or undone once taken: having a child, marrying, divorcing or breaking up, adopting, taking in a pet, a permanent body change, cutting off a relationship. Fill in every field as for "other", with these meanings: v.metric must be life satisfaction; v.doing is a short phrase meaning living with this choice; v.fallback is an empty string; hazard is the chance in each year of a hard stretch that seriously tests the choice (not of stopping); risk is the multiplier on that chance; the index is life satisfaction compared with not having done it; fallback is 1 and cost is 0. Questions must be about readiness and circumstances, never about whether the person can back out.
- Any other personal decision, large or small (career, study, moving, money, relationships, health habits, hobbies, buying something big), is type "other" or "commit". Never refuse a personal decision because it is unusual or small.
- Moving to the countryside to farm is type "other", not "startup".
- Exactly 5 questions, 3 options each, using exactly the keys "q", "o" and "risk" as in the shape above. Questions end politely (in Korean: ~인가요? or ~있나요?). risk is the multiplier on the yearly chance of stopping for each option (0.6 to 1.6; higher is riskier).
- Question rules. Keep only the 5 factors that most change how THIS decision turns out; no generic filler such as health, stress or motivation unless the decision is about that. Ask only facts about the person's present situation that they can answer right now: never ask them to predict the future (interest rates, the market, development plans), and never ask how they feel about something they have not experienced yet (the weather after moving, confidence in the decision). Never assume anything the person did not say (a spouse, children, a job, a partner's opinion); if a factor only applies to some people, make one of the three options the not-applicable case (in Korean: 해당 없음). The three options must answer the question's exact wording, be concrete and mutually exclusive, and run from most favourable to least favourable. Do not ask for counts or numbers the person would have to calculate. Options are short, at most about 15 characters each. Write every word in the requested language; never mix in English words.
- v.metric: use income only when money is the main point of the decision (changing jobs, starting a business, investing). For study, moving, housing, relationships, pets and lifestyle use life satisfaction.
- hazard: chance in each of years 1 to 10 that the person stops or the new path ends that year (0.01 to 0.4). Use the sources when they give rates.
- The metric is an index where 1.0 means "the same as if I had not done it". start: index in year 1. growth: average yearly growth of the index while continuing. vol: yearly volatility. cap: maximum index. fallback: index after stopping. cost: upfront cost measured in years of the baseline.
- facts: 3 to 5 sentences. Every fact must bear directly on how this decision turns out; drop numbers about unrelated topics even if a source contains them. Use a source only if it is about the same decision seen from this person's side (for example, for someone deciding to study abroad, ignore sources about foreign students coming to their country). For a sourced fact, "quote" must be copied character for character from that source text, at most 80 characters, and must not contain double quote characters. If a number is your own estimate, set "s" to -1, leave "quote" empty and say in the sentence that it is an assumption. Never attribute an invented number to a source.\n- The questions must be about the person making this decision, from their side.\n- Write every string in ${lang} only. Do not mix in words or letters from any other language.
- If the search results are empty or unrelated, still return the full JSON using your own estimates, with every fact marked s:-1.\n- Korean example of v for studying abroad: {"act":"유학","doing":"유학 중","start":"출국","fallback":"귀국 후 취업","base":"가지 않았다면","metric":"소득"}` },
        { role: "user", content: `${me ? "About this person (fit the questions to this person; never ask what this already answers):\n" + me + "\n\n" : ""}Decision: ${q}\n\nSearch results (index, title, text):\n${sources.map((x, i) => `[${i}] ${x.title}\n${x.content}`).join("\n\n") || "(no search results)"}` },
      ];
      let j = null, out, perr = "";
      const good = x => x && (["startup", "crisis", "invalid"].includes(x.type) || (x.v && Array.isArray(x.questions || x.question_list) && (x.questions || x.question_list).length >= 4));
      if (j === null && b.retry) msgs[1].content += "\n\nReturn the complete JSON object with all fields. Do not leave out questions or v.";
      for (let a = 0; a < 2 && !good(j); a++) {
      out = await complete(msgs, { json: true, max: 5000, temp: a ? 0.6 : 0.3 });
      let txt = out.text;
      if (ko && /[\u3040-\u30ff\u00c0-\u024f\u0400-\u04ff]/.test(txt)) txt = txt.replace(/[\u3040-\u30ff\u00c0-\u024f\u0400-\u04ff]+/g, "");
      const m = txt.match(/\{[\s\S]*\}/); try { const jj = JSON.parse(m ? m[0] : txt); if (jj && jj.question_list && !jj.questions) jj.questions = jj.question_list; if (good(jj) || !j) j = jj; } catch (e) { perr = clip(e.message, 80) + " | " + clip(txt, 60); }
      }
      if (!j) return res.status(200).json({ ok: false, why: "json: " + perr });
      if (j.type === "startup") { const kn = {}, K = { ind: 4, exp: 2, cust: 2, team: 1, inv: 3 }; const jk = j.known && typeof j.known === "object" ? j.known : {}; for (const k in K) { const x = Number(jk[k]); if (Number.isInteger(x) && x >= 0 && x <= K[k]) kn[k] = x; } const sq = (Array.isArray(j.questions) ? j.questions : []).map(x => x && ({ q: clip(x.q || x.question || "", 120), o: (x.o || x.options || []).slice(0, 3).map(y => clip(String(y), 60)), risk: (x.risk || []).slice(0, 3).map(y => (Number.isFinite(+y) ? Math.max(0.6, Math.min(1.6, +y)) : 1)) })).filter(x => x && x.q && x.o.length === 3 && x.risk.length === 3).slice(0, 4); return res.status(200).json({ startup: true, act: clip(j.act || "", 30), known: kn, questions: sq, pre: await preAnswer(sq, me) }); }
      if (j.type === "crisis") return res.status(200).json({ ok: false, why: "crisis" });
      const num = (x, lo, hi, d) => { x = Number(x); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
      const si = x => { x = Number(x); return Number.isInteger(x) && x >= 0 && x < sources.length ? x : -1; };
      const qs = (Array.isArray(j.questions) ? j.questions : []).map(x => x && ({ q: x.q || x.question || x.text, o: x.o || x.options || x.choices || x.answers, risk: x.risk || x.risks || x.multipliers })).filter(x => x && x.q && Array.isArray(x.o) && x.o.length >= 2).slice(0, 7)
        .map(x => { const o = x.o.slice(0, 4).map(y => clip(y && typeof y === "object" ? (y.label || y.text || y.o || "") : y, 40)); return { q: clip(x.q, 90), o, risk: o.map((_, k) => num((x.risk || [])[k], 0.5, 1.8, 1)) }; });
      let hz = j.hazard || j.hazards || j.yearly_hazard; if (!Array.isArray(hz) || hz.length < 5) { hz = [0.12, 0.1, 0.08, 0.07, 0.06, 0.05, 0.05, 0.04, 0.04, 0.03]; j.hzSrc = -1; }
      if (j.type === "invalid" || qs.length < 4 || hz.length < 5 || !j.v) return res.status(200).json({ ok: false, why: `type=${j.type} qs=${qs.length} hz=${hz.length} v=${!!j.v} rawq=${Array.isArray(j.questions) ? j.questions.length : typeof j.questions}` });
      const v = {}; for (const k of ["act", "doing", "start", "fallback", "base", "metric"]) v[k] = clip(j.v[k] || "", 30);
      const commit = j.type === "commit";
      if (!v.doing) v.doing = v.act; if (!v.base) v.base = ko ? "하지 않았다면" : "if I had not"; if (!v.metric) v.metric = commit ? (ko ? "삶의 만족도" : "life satisfaction") : (ko ? "소득" : "income");
      if (!v.act) return res.status(200).json({ ok: false, why: "v " + JSON.stringify(v) });
      const norm = x => String(x || "").replace(/[\s"'“”‘’.,·]/g, "").toLowerCase();
      const backed = (s, quote) => { const n = norm(quote); return s >= 0 && n.length >= 6 && norm(sources[s].content).includes(n); };
      const facts = (Array.isArray(j.facts) ? j.facts : []).filter(f => f && f.t).slice(0, 5).map(f => { const s = si(f.s); return { t: clip(f.t, 220), s: backed(s, f.quote) ? s : -1 }; });
      if (!facts.some(f => f.s === si(j.hzSrc))) j.hzSrc = -1;
      const used = [...new Set(facts.map(f => f.s).concat([si(j.hzSrc)]).filter(x => x >= 0))], remap = {}; used.forEach((x, k) => remap[x] = k);
      const spec = { mode: commit ? "commit" : "path", v, questions: qs, hazard: Array.from({ length: 10 }, (_, k) => num(hz[Math.min(k, hz.length - 1)], 0.005, 0.5, 0.08)), hzSrc: si(j.hzSrc) >= 0 ? remap[si(j.hzSrc)] : -1,
        start: num(j.start, 0.2, 1.5, 0.8), growth: num(j.growth, -0.05, 0.4, 0.08), vol: num(j.vol, 0.05, 0.4, 0.15), cap: num(j.cap, 1, 6, 3), fallback: commit ? 1 : num(j.fallback, 0.3, 1.2, 0.9), cost: commit ? 0 : num(j.cost, 0, 3, 0.3),
        facts: facts.map(f => ({ t: f.t, s: f.s >= 0 ? remap[f.s] : -1 })), sources: used.map(x => ({ title: sources[x].title, url: sources[x].url })), refs: sources.filter((_, i) => !used.includes(i)).slice(0, 4).map(x => ({ title: x.title, url: x.url })) };
      return res.status(200).json({ ok: true, spec, pre: await preAnswer(qs, me), searched: sources.length, model: out.model });
    }
    return res.status(400).json({ error: "kind" });
  } catch (e) {
    return res.status(502).json({ error: "upstream", detail: clip(e.message, 200) });
  }
}
