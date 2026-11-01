import { evaluate, summarize } from '../../src/collector/accuracy.js';
const pred = (direction, days = 1) => ({ days, score: 0, direction, expectedPct: 0, rangePct: [-1.5, 1.5], confidence: 'low', contributions: [] });
const preds = (d1, d1m = 'up') => ({ '1d': pred(d1), '1w': pred('up', 5), '1m': pred(d1m, 21) });
const entry = (date, assets) => ({ date, assets });
const asset = (symbol, asOf, last, d1, vol20 = 0.02) => ({ symbol, asOf, last, vol20, prediction: preds(d1) });

test('日米で日付の並びが違っても自分の次の取引日で評価（Review Focus 2）', () => {
  const histories = {
    JP: { symbol: 'JP', dates: ['2026-11-02', '2026-11-04'], closes: [100, 101] },
    US: { symbol: 'US', dates: ['2026-11-02', '2026-11-03'], closes: [100, 99] },
  };
  const ev = evaluate([entry('2026-11-02', [asset('JP', '2026-11-02', 100, 'up'), asset('US', '2026-11-02', 100, 'up')])], histories);
  const d1 = ev.filter((e) => e.horizon === '1d');
  expect(d1.find((e) => e.symbol === 'JP')).toMatchObject({ actualPct: expect.closeTo(1, 6), hit: true, inRange: true });
  expect(d1.find((e) => e.symbol === 'US')).toMatchObject({ actualPct: expect.closeTo(-1, 6), hit: false });
});
test('方向ごとの的中判定', () => {
  const histories = { A: { symbol: 'A', dates: ['d0', 'd1'], closes: [100, 101] }, B: { symbol: 'B', dates: ['d0', 'd1'], closes: [100, 100.4] }, C: { symbol: 'C', dates: ['d0', 'd1'], closes: [100, 100.6] } };
  const ev = evaluate([entry('d0', [asset('A', 'd0', 100, 'down'), asset('B', 'd0', 100, 'flat'), asset('C', 'd0', 100, 'flat')])], histories).filter((e) => e.horizon === '1d');
  expect(ev.map((e) => [e.symbol, e.hit])).toEqual([['A', false], ['B', true], ['C', false]]);
});
test('期限前の 1m は評価しない', () => {
  const histories = { A: { symbol: 'A', dates: ['d0', 'd1'], closes: [100, 101] } };
  expect(evaluate([entry('d0', [asset('A', 'd0', 100, 'up')])], histories).map((e) => e.horizon)).toEqual(['1d']);
});
test('同じ date は後ろの entry だけ（Review Focus 5）', () => {
  const histories = { A: { symbol: 'A', dates: ['d0', 'd1'], closes: [100, 101] } };
  const ev = evaluate([entry('d0', [asset('A', 'd0', 100, 'down')]), entry('d0', [asset('A', 'd0', 100, 'up')])], histories);
  expect(ev).toHaveLength(1); expect(ev[0].hit).toBe(true);
});
test('summarize', () => {
  const e = (date, hit) => ({ date, symbol: 'A', horizon: '1d', direction: 'up', expectedPct: 0, rangePct: [-1, 1], actualPct: 0.5, hit, inRange: true });
  const a = summarize([e('2026-11-01', true), e('2026-11-03', false)], '2026-11-04T00:00:00Z');
  expect(a.byHorizon['1d']).toEqual({ n: 2, hits: 1, hitRate: 0.5, inRangeRate: 1 });
  expect(a.byHorizon['1m']).toEqual({ n: 0, hits: 0, hitRate: null, inRangeRate: null });
  expect(a.bySymbol.A['1d'].n).toBe(2);
  expect(a.recent.map((x) => x.date)).toEqual(['2026-11-03', '2026-11-01']);
  expect(a.updatedAt).toBe('2026-11-04T00:00:00Z');
});
