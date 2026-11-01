// 見出し → テーマ・市場・銘柄の点数（設計書 3.2）
import { scoreHeadline, stripSource } from './sentiment.js';

const DAY = 864e5;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function dedupe(headlines) {
  const links = new Set();
  const titles = new Set();
  const out = [];
  for (const h of headlines) {
    const t = stripSource(h.title);
    if (links.has(h.link) || titles.has(t)) continue;
    links.add(h.link);
    titles.add(t);
    out.push(h);
  }
  return out;
}

export function scoreAll(headlines, { now, lexicon, topicLexicon }) {
  return headlines.map((h) => {
    const { score, matched } = scoreHeadline(h.title, h.lang, lexicon, topicLexicon);
    const ageDays = Math.max(0, (now.getTime() - new Date(h.pubDate).getTime()) / DAY);
    return { ...h, score, matched, ageDays };
  });
}

export function aggregate(scored, { maxAgeDays, halfLifeDays, confidenceFull }) {
  const used = scored.filter((s) => isNum(s.score) && s.ageDays <= maxAgeDays);
  if (!used.length) return { score: null, confidence: 0, n: 0 };
  let num = 0;
  let den = 0;
  for (const s of used) {
    const w = 0.5 ** (s.ageDays / halfLifeDays);
    num += w * s.score;
    den += w;
  }
  return { score: num / den, confidence: Math.min(1, used.length / confidenceFull), n: used.length };
}

export function summarizeTopic(scored, cfg) {
  const opts = { halfLifeDays: cfg.halfLifeDays, confidenceFull: cfg.confidenceFull };
  return {
    short: aggregate(scored, { ...opts, maxAgeDays: cfg.shortDays }),
    medium: aggregate(scored, { ...opts, maxAgeDays: cfg.lookbackDays }),
  };
}

export function marketNews(topics, market, cfg) {
  const impactOf = Object.fromEntries(cfg.topics.map((t) => [t.id, t.impact?.[market] ?? 0]));
  const windowScore = (key) => {
    let num = 0;
    let den = 0;
    for (const t of topics) {
      const a = t[key];
      const w = (a?.confidence ?? 0) * (impactOf[t.id] ?? 0);
      if (!a || !isNum(a.score) || w <= 0) continue;
      num += a.score * w;
      den += w;
    }
    return den > 0 ? num / den : null;
  };
  return { short: windowScore('short'), medium: windowScore('medium') };
}

export function stockNews(stock, market, cfg) {
  const windowScore = (key) => {
    const parts = [];
    const a = stock?.[key];
    if (a && isNum(a.score) && a.confidence > 0) parts.push([a.score, a.confidence]);
    if (isNum(market?.[key])) parts.push([market[key], cfg.stockMarketWeight]);
    if (!parts.length) return null;
    const den = parts.reduce((s, [, w]) => s + w, 0);
    return parts.reduce((s, [v, w]) => s + v * w, 0) / den;
  };
  return { short: windowScore('short'), medium: windowScore('medium') };
}
