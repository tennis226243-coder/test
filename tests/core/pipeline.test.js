import { buildAsset, newsQueries, analyzeNews, finalizeAssets } from '../../src/core/pipeline.js';
import newsCfg from '../../config/news.json' with { type: 'json' };
import lexicon from '../../config/lexicon.json' with { type: 'json' };
import weights from '../../config/weights.json' with { type: 'json' };
import { makeHistory } from '../fixtures/histories.js';

const stocks = [{ symbol: 'IONQ', name: 'IonQ', market: 'US' }];
const now = new Date('2026-11-02T00:00:00Z');
const h = (title, lang = 'ja') => ({ title, link: 'https://x/' + title, source: 'S', lang, pubDate: '2026-11-01T12:00:00.000Z' });

test('newsQueries', () => {
  const q = newsQueries(newsCfg, stocks);
  expect(q).toHaveLength(20);
  expect(q.filter((x) => x.key === 'stock:IONQ').map((x) => x.q)).toEqual(['IonQ 株', 'IonQ stock']);
  expect(q[0].key).toBe('topic:us');
});
test('銘柄のニュースが予測に入る', () => {
  const analysis = analyzeNews({ 'stock:IONQ': [h('IonQ、通期予想を上方修正')] }, { now, newsCfg, lexicon, stocks });
  expect(analysis.newsAvailable).toBe(true);
  const asset = buildAsset(stocks[0], 'stock', makeHistory('IONQ'));
  const [a] = finalizeAssets([asset], analysis, weights, newsCfg);
  expect(a.news.short).toBeGreaterThan(0);
  expect(a.news.headlines[0].matched).toEqual(['上方修正']);
  expect(a.prediction['1d'].contributions.map((c) => c.key)).toContain('news');
  expect(asset.prediction).toBeUndefined();
});
test('中立の見出しだけならニュースなし', () => {
  const analysis = analyzeNews({ 'stock:IONQ': [h('IonQ が説明会')], 'topic:us': [h('米国の天気')] }, { now, newsCfg, lexicon, stocks });
  expect(analysis.newsAvailable).toBe(false);
  const [a] = finalizeAssets([buildAsset(stocks[0], 'stock', makeHistory('IONQ'))], analysis, weights, newsCfg);
  expect(a.prediction['1d'].contributions.map((c) => c.key)).not.toContain('news');
});
test('buildAsset', () => {
  const a = buildAsset({ symbol: '^N225', name: '日経平均', market: 'JP' }, 'index', makeHistory('^N225', 300));
  expect(a.history.closes).toHaveLength(260); expect(a.asOf).toBe('2026-10-30'); expect(a.stale).toBe(false);
  expect(a.techScores.maLong).not.toBeNull();
});
