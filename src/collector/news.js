// Google ニュースの検索 RSS を取得して見出しにする
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const LOCALE = { ja: 'hl=ja&gl=JP&ceid=JP:ja', en: 'hl=en-US&gl=US&ceid=US:en' };
const UA = 'Mozilla/5.0 (personal stock-predictor)';

export function buildRssUrl(q, lang, lookbackDays = 7) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${lookbackDays}d`)}&${LOCALE[lang]}`;
}

const text = (v) => (v && typeof v === 'object' ? String(v['#text'] ?? '') : String(v ?? ''));

export function parseRss(xml, lang) {
  if (typeof xml !== 'string' || XMLValidator.validate(xml) !== true) return [];
  let doc;
  try {
    doc = new XMLParser({ ignoreAttributes: false, processEntities: true }).parse(xml);
  } catch {
    return [];
  }
  let items = doc?.rss?.channel?.item ?? [];
  if (!Array.isArray(items)) items = [items];
  const out = [];
  for (const it of items) {
    const d = new Date(text(it.pubDate));
    const title = text(it.title).trim();
    if (Number.isNaN(d.getTime()) || !title) continue;
    out.push({ title, link: text(it.link).trim(), source: text(it.source).trim(), pubDate: d.toISOString(), lang });
  }
  return out;
}

export async function fetchNews(queries, { fetch, sleep, lookbackDays = 7, retries = 2, intervalMs = 1000 }) {
  const results = {};
  const failed = [];
  for (let qi = 0; qi < queries.length; qi++) {
    const { key, q, lang } = queries[qi];
    if (qi > 0) await sleep(intervalMs);
    results[key] ??= [];
    let ok = false;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const res = await fetch(buildRssUrl(q, lang, lookbackDays), { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        results[key].push(...parseRss(await res.text(), lang));
        ok = true;
        break;
      } catch (e) {
        if (attempt <= retries) await sleep(2000 * 2 ** (attempt - 1));
        else console.warn(`[news] ${key} "${q}": ${e.message}`);
      }
    }
    if (!ok && !failed.includes(key)) failed.push(key);
  }
  return { results, failed };
}
