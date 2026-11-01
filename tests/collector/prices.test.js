import { fetchHistory, fetchAll } from '../../src/collector/prices.js';
const period1 = new Date('2026-01-01');
const q = (iso, close) => ({ date: new Date(iso), close });
const fakeYf = (map) => ({ chart: async (s) => { const v = map[s]; if (v instanceof Error) throw v; return v; } });

test('null の終値の日は除く（Review Focus 2）', async () => {
  const yf = fakeYf({ A: { meta: { exchangeTimezoneName: 'America/New_York' }, quotes: [q('2026-10-29T13:30:00Z', 10), q('2026-10-30T13:30:00Z', null), q('2026-11-02T14:30:00Z', 12)] } });
  const h = await fetchHistory('A', { yf, period1 });
  expect(h).toEqual({ symbol: 'A', dates: ['2026-10-29', '2026-11-02'], closes: [10, 12] });
  for (const d of h.dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
test('日付は取引所の現地日付', async () => {
  const yf = fakeYf({ J: { meta: { exchangeTimezoneName: 'Asia/Tokyo' }, quotes: [q('2026-10-29T15:00:00Z', 100)] } });
  expect((await fetchHistory('J', { yf, period1 })).dates).toEqual(['2026-10-30']);
});
test('fetchAll は失敗と0件を failed に入れる', async () => {
  const yf = fakeYf({ OK: { meta: {}, quotes: [q('2026-10-29T13:30:00Z', 1)] }, BAD: new Error('x'), EMPTY: { meta: {}, quotes: [] } });
  const r = await fetchAll(['OK', 'BAD', 'EMPTY'], { yf, period1 });
  expect(Object.keys(r.ok)).toEqual(['OK']); expect(r.failed).toEqual(['BAD', 'EMPTY']);
});
test('同じ日の足が2本あれば後ろの値を使う', async () => {
  const yf = fakeYf({ A: { meta: { exchangeTimezoneName: 'America/New_York' }, quotes: [q('2026-10-29T13:30:00Z', 10), q('2026-10-29T19:00:00Z', 11)] } });
  expect((await fetchHistory('A', { yf, period1 })).closes).toEqual([11]);
});
