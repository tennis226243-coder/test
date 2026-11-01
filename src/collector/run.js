// 毎日の処理：株価・ニュースを集めて予測し、data/ に JSON を書き出す
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchAll, defaultYf } from './prices.js';
import { fetchNews } from './news.js';
import { evaluate, summarize } from './accuracy.js';
import { buildAsset, newsQueries, analyzeNews, finalizeAssets, changePct } from '../core/pipeline.js';

const DAY = 864e5;

export function jstDate(now) {
  return new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
}

export async function runDaily({ now, yf, fetch, sleep, store, config }) {
  const { watchlist, weights, news: newsCfg, lexicon } = config;
  const date = jstDate(now);
  const period1 = new Date(now.getTime() - 400 * DAY);
  const defs = [
    ...watchlist.indices.map((d) => ({ ...d, kind: 'index' })),
    ...watchlist.stocks.map((d) => ({ ...d, kind: 'stock' })),
  ];

  // 1. 株価
  const symbols = [...defs.map((d) => d.symbol), ...watchlist.indicators.map((d) => d.symbol)];
  const prices = await fetchAll(symbols, { yf, period1 });
  if (!defs.some((d) => prices.ok[d.symbol])) throw new Error('株価を1つも取得できませんでした');

  // 2. 取れなかったものは前回の値（stale）
  const prev = store.read('latest.json');
  const prevAsset = (s) => prev?.assets?.find((a) => a.symbol === s);
  const prevIndicator = (s) => prev?.indicators?.find((a) => a.symbol === s);
  const assets = [];
  for (const d of defs) {
    if (prices.ok[d.symbol]) assets.push(buildAsset(d, d.kind, prices.ok[d.symbol]));
    else if (prevAsset(d.symbol)) assets.push({ ...prevAsset(d.symbol), stale: true });
  }
  const indicators = [];
  for (const d of watchlist.indicators) {
    const h = prices.ok[d.symbol];
    if (h) indicators.push({ symbol: d.symbol, name: d.name, last: h.closes.at(-1), changePct: changePct(h.closes), stale: false });
    else if (prevIndicator(d.symbol)) indicators.push({ ...prevIndicator(d.symbol), stale: true });
  }

  // 3. ニュース
  const queries = newsQueries(newsCfg, watchlist.stocks);
  const { results, failed } = await fetchNews(queries, { fetch, sleep, lookbackDays: newsCfg.lookbackDays });
  const analysis = analyzeNews(results, { now, newsCfg, lexicon, stocks: watchlist.stocks });

  // 4. 予測
  const finalAssets = finalizeAssets(assets, analysis, weights, newsCfg);
  const latest = {
    generatedAt: now.toISOString(),
    date,
    newsAvailable: analysis.newsAvailable,
    failedQueries: failed,
    topics: analysis.topics,
    indicators,
    assets: finalAssets,
  };

  // 5. 書き出し（stale の銘柄は予測の履歴に入れない）
  store.write('latest.json', latest);
  store.write(`history/${date}.json`, {
    date,
    assets: finalAssets.filter((a) => !a.stale).map((a) => ({
      symbol: a.symbol, asOf: a.asOf, last: a.last, vol20: a.features?.vol20 ?? null, prediction: a.prediction,
    })),
  });

  // 6. 的中率
  const entries = store.list('history').filter((f) => f.endsWith('.json')).sort()
    .map((f) => store.read(`history/${f}`)).filter(Boolean);
  store.write('accuracy.json', summarize(evaluate(entries, prices.ok), now.toISOString()));
  return latest;
}

export function fileStore(root) {
  return {
    read(p) {
      try { return JSON.parse(readFileSync(join(root, p), 'utf8')); } catch { return null; }
    },
    write(p, obj) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), JSON.stringify(obj, null, 1) + '\n');
    },
    list(dir) {
      try { return readdirSync(join(root, dir)); } catch { return []; }
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const cfg = (n) => JSON.parse(readFileSync(join(repo, 'config', n), 'utf8'));
  const config = { watchlist: cfg('watchlist.json'), weights: cfg('weights.json'), news: cfg('news.json'), lexicon: cfg('lexicon.json') };
  runDaily({
    now: new Date(),
    yf: defaultYf(),
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    store: fileStore(join(repo, 'data')),
    config,
  }).then((l) => {
    console.log(`OK ${l.date}: assets=${l.assets.length} stale=${l.assets.filter((a) => a.stale).length} news=${l.newsAvailable} failedQueries=${l.failedQueries.length}`);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
