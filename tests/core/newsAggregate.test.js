import { dedupe, scoreAll, aggregate, summarizeTopic, marketNews, stockNews } from '../../src/core/newsAggregate.js';
import cfg from '../../config/news.json' with { type: 'json' };
const now = new Date('2026-11-02T00:00:00Z');
const h = (title, daysAgo, o = {}) => ({ title, link: 'https://x/' + title, source: 'S', lang: 'ja', pubDate: new Date(now - daysAgo * 864e5).toISOString(), ...o });
const s = (score, ageDays) => ({ ...h('t', ageDays), score, matched: [], ageDays });

test('重複を除く（Review Focus 4）', () => {
  const out = dedupe([h('A', 0), h('A', 0, { link: 'https://other' }), h('B', 0, { link: 'https://x/A' }), h('C', 0)]);
  expect(out.map((x) => x.title)).toEqual(['A', 'C']);
});
test('経過日数の重みと確信度', () => {
  const a = aggregate([s(1, 0), s(-1, 2), s(null, 0)], { maxAgeDays: 7, halfLifeDays: 2, confidenceFull: 5 });
  expect(a.score).toBeCloseTo(1 / 3); expect(a.n).toBe(2); expect(a.confidence).toBeCloseTo(0.4);
});
test('窓の外は除く', () => {
  const t = summarizeTopic([s(1, 1), s(-1, 3), s(-1, 8)], cfg);
  expect(t.short.score).toBe(1); expect(t.medium.n).toBe(2);
  expect(aggregate([], { maxAgeDays: 7, halfLifeDays: 2, confidenceFull: 5 })).toEqual({ score: null, confidence: 0, n: 0 });
});
test('scoreAll は経過日数を付ける', () => {
  expect(scoreAll([h('上方修正', 1.5)], { now, lexicon: { ja: { '上方修正': 1 }, en: {}, negators: { ja: [], en: [] } } })[0].ageDays).toBeCloseTo(1.5);
});
test('市場の点数は影響度で重み付け', () => {
  const A = (score, confidence) => ({ score, confidence, n: 5 });
  const topics = [{ id: 'us', short: A(null, 0), medium: A(1, 1) }, { id: 'middle_east', short: A(null, 0), medium: A(-1, 0.5) }];
  const m = marketNews(topics, 'US', cfg);
  expect(m.medium).toBeCloseTo((1 - 0.15) / 1.15); expect(m.short).toBeNull();
});
test('銘柄の点数は銘柄と市場の加重平均', () => {
  const r = stockNews({ short: { score: 1, confidence: 1, n: 5 }, medium: { score: null, confidence: 0, n: 0 } }, { short: -1, medium: 0.4 }, cfg);
  expect(r.short).toBeCloseTo((1 - 0.5) / 1.5); expect(r.medium).toBeCloseTo(0.4);
});
