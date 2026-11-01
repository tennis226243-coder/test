import { sma, smaSeries, emaSeries, rsi, macd, bollinger, regressionSlope, volatility } from '../../src/core/indicators.js';
const r = (n) => Array.from({ length: n }, (_, i) => i + 1);
const flat = (n, v = 100) => Array(n).fill(v);
const grow = (n, g = 0.01) => Array.from({ length: n }, (_, i) => 100 * Math.exp(g * i));

test('sma', () => { expect(sma(r(10), 5)).toBe(8); expect(sma(r(3), 5)).toBeNull(); });
test('smaSeries', () => { expect(smaSeries(r(4), 3)).toEqual([null, null, 2, 3]); });
test('emaSeries', () => { expect(emaSeries(r(5), 3)).toEqual([null, null, 2, 3, 4]); });
test('rsi', () => {
  expect(rsi(r(15))).toBe(100); expect(rsi(r(15).reverse())).toBe(0);
  expect(rsi(flat(15))).toBe(50); expect(rsi(r(14))).toBeNull();
});
test('macd', () => {
  expect(macd(flat(34))).toEqual({ macd: 0, signal: 0, hist: 0 });
  expect(macd(grow(60)).macd).toBeGreaterThan(0); expect(macd(flat(33))).toBeNull();
});
test('bollinger', () => {
  expect(bollinger(flat(20)).percentB).toBe(0.5);
  expect(bollinger([...flat(19), 120]).percentB).toBeGreaterThan(1);
  expect(bollinger(flat(19))).toBeNull();
});
test('regressionSlope', () => { expect(regressionSlope(grow(60))).toBeCloseTo(0.01, 10); });
test('volatility', () => {
  expect(volatility(grow(21))).toBeCloseTo(0, 12);
  expect(volatility(flat(20))).toBeNull();
  const alt = Array.from({ length: 21 }, (_, i) => (i % 2 ? 110 : 100));
  expect(volatility(alt)).toBeCloseTo(0.09779, 4);
});
