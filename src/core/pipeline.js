// 銘柄データの組み立て・ニュースの分析・予測
import { computeFeatures, scoreTechnicals } from './scoring.js';
import { predict } from './predict.js';
import { dedupe, scoreAll, summarizeTopic, marketNews, stockNews } from './newsAggregate.js';

const KEEP = 260;
const TOP_HEADLINES = 10;

export function changePct(closes) {
  return closes.length >= 2 ? (closes.at(-1) / closes.at(-2) - 1) * 100 : null;
}

export function buildAsset(def, kind, history) {
  const features = computeFeatures(history.closes);
  const asset = {
    symbol: def.symbol,
    name: def.name,
    market: def.market,
    kind,
    stale: false,
    asOf: history.dates.at(-1),
    last: history.closes.at(-1),
    changePct: changePct(history.closes),
    history: { dates: history.dates.slice(-KEEP), closes: history.closes.slice(-KEEP) },
    features,
    techScores: scoreTechnicals(features),
  };
  if (def.note) asset.note = def.note;
  return asset;
}

export function newsQueries(newsCfg, stocks) {
  const out = [];
  for (const t of newsCfg.topics) for (const q of t.queries) out.push({ key: `topic:${t.id}`, q: q.q, lang: q.lang });
  for (const s of stocks) for (const q of newsCfg.stockQueries) out.push({ key: `stock:${s.symbol}`, q: q.q.replaceAll('{name}', s.name), lang: q.lang });
  return out;
}

const topHeadlines = (scored) =>
  scored.filter((s) => s.score !== null).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, TOP_HEADLINES);

export function analyzeNews(results, { now, newsCfg, lexicon, stocks }) {
  let anyScored = false;
  const score = (key, topicLexicon) => {
    const scored = scoreAll(dedupe(results[key] ?? []), { now, lexicon, topicLexicon });
    if (scored.some((s) => s.score !== null)) anyScored = true;
    return { ...summarizeTopic(scored, newsCfg), headlines: topHeadlines(scored) };
  };

  const topics = newsCfg.topics.map((t) => ({ id: t.id, name: t.name, ...score(`topic:${t.id}`, t.lexicon) }));
  const stockResults = Object.fromEntries(stocks.map((s) => [s.symbol, score(`stock:${s.symbol}`)]));
  const markets = { JP: marketNews(topics, 'JP', newsCfg), US: marketNews(topics, 'US', newsCfg) };
  return { newsAvailable: anyScored, topics, markets, stocks: stockResults };
}

export function finalizeAssets(assets, analysis, weights, newsCfg) {
  return assets.map((a) => {
    let news = { short: null, medium: null, headlines: [] };
    if (analysis.newsAvailable) {
      const market = analysis.markets[a.market] ?? { short: null, medium: null };
      if (a.kind === 'stock') {
        const s = analysis.stocks[a.symbol];
        news = { ...stockNews(s, market, newsCfg), headlines: s?.headlines ?? [] };
      } else {
        news = { short: market.short, medium: market.medium, headlines: [] };
      }
    }
    const prediction = predict({
      techScores: a.techScores,
      news: analysis.newsAvailable ? { short: news.short, medium: news.medium } : null,
      vol20: a.features?.vol20 ?? null,
      weights,
    });
    return { ...a, news, prediction };
  });
}
