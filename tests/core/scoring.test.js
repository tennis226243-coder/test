import { computeFeatures, scoreTechnicals } from '../../src/core/scoring.js';
const grow = (n, g) => Array.from({ length: n }, (_, i) => 100 * Math.exp(g * i));
const wave = (n) => Array.from({ length: n }, (_, i) => 100 + 5 * Math.sin(i / 3) + i * 0.05);

test('値はすべて -1..1 で、260日あれば null はない', () => {
  const s = scoreTechnicals(computeFeatures(wave(260)));
  for (const v of Object.values(s)) { expect(v).not.toBeNull(); expect(Math.abs(v)).toBeLessThanOrEqual(1); }
});
test('上昇トレンドでは流れ系の点数が正', () => {
  const s = scoreTechnicals(computeFeatures(grow(260, 0.003).map((p, i) => p * (1 + 0.01 * Math.sin(i)))));
  expect(s.maShort).toBeGreaterThan(0); expect(s.maLong).toBeGreaterThan(0); expect(s.slope).toBeGreaterThan(0);
});
test('rsi と bollinger の式', () => {
  const f = computeFeatures(wave(260));
  expect(scoreTechnicals({ ...f, rsi14: 25 }).rsi).toBe(0.5);
  expect(scoreTechnicals({ ...f, bb: { ...f.bb, percentB: 1.5 } }).bollinger).toBe(-1);
});
test('上場30日の銘柄（Review Focus 1）', () => {
  const s = scoreTechnicals(computeFeatures(wave(30)));
  expect(s.maLong).toBeNull(); expect(s.ma75).toBeNull(); expect(s.slope).toBeNull();
  expect(s.maShort).not.toBeNull(); expect(s.rsi).not.toBeNull();
});
