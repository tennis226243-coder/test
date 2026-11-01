import { predict } from '../../src/core/predict.js';
import weights from '../../config/weights.json' with { type: 'json' };
const all = (v) => ({ maShort: v, maLong: v, ma75: v, rsi: v, macd: v, bollinger: v, slope: v });

test('全部 +1、ニュース +1 → 上昇・確信度高', () => {
  const p = predict({ techScores: all(1), news: { short: 1, medium: 1 }, vol20: 0.02, weights });
  expect(p['1d'].score).toBeCloseTo(1); expect(p['1d'].direction).toBe('up'); expect(p['1d'].confidence).toBe('high');
  expect(p['1d'].expectedPct).toBeCloseTo(2); expect(p['1d'].rangePct[0]).toBeCloseTo(0); expect(p['1d'].rangePct[1]).toBeCloseTo(4);
  expect(p['1w'].expectedPct).toBeCloseTo(2 * Math.sqrt(5));
});
test('ニュースなしは計算式のみ', () => {
  const p = predict({ techScores: all(0.5), news: null, vol20: 0.02, weights });
  expect(p['1m'].score).toBeCloseTo(0.5);
  expect(p['1m'].contributions.find((c) => c.key === 'news')).toBeUndefined();
});
test('null の指標は按分し直す（Review Focus 1）', () => {
  const p = predict({ techScores: { ...all(null), rsi: 1, bollinger: -1 }, news: null, vol20: 0.02, weights });
  expect(p['1d'].score).toBeCloseTo(0); expect(p['1d'].direction).toBe('flat'); expect(p['1d'].confidence).toBe('low');
  expect(p['1m'].score).toBe(0); expect(p['1m'].contributions).toEqual([]);
});
test('1w のニュースは short と medium を半分ずつ', () => {
  const p = predict({ techScores: all(0), news: { short: 1, medium: 0 }, vol20: 0.02, weights });
  expect(p['1w'].score).toBeCloseTo(0.25);
});
test('符号が割れると確信度が下がる', () => {
  const p = predict({ techScores: all(0.4), news: { short: -0.6, medium: -0.6 }, vol20: 0.02, weights });
  expect(p['1d'].score).toBeCloseTo(-0.1);
  expect(p['1d'].direction).toBe('flat'); expect(p['1d'].confidence).toBe('mid');
});
