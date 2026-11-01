// 指標の値 → −1〜+1 の点数（設計書 3.1）
import { sma, rsi, macd, bollinger, regressionSlope, volatility } from './indicators.js';

export function computeFeatures(closes) {
  return {
    last: closes.length ? closes.at(-1) : null,
    sma5: sma(closes, 5),
    sma25: sma(closes, 25),
    sma50: sma(closes, 50),
    sma75: sma(closes, 75),
    sma200: sma(closes, 200),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    bb: bollinger(closes, 20, 2),
    slope60: regressionSlope(closes, 60),
    vol20: volatility(closes, 20),
  };
}

const ok = (...xs) => xs.every((x) => x !== null && x !== undefined && Number.isFinite(x));
const clamp = (x) => Math.max(-1, Math.min(1, x));

export function scoreTechnicals(f) {
  const v = Math.max(f.vol20 ?? 0.02, 1e-6);
  const rel = (a, b) => (a - b) / b;
  return {
    maShort: ok(f.sma5, f.sma25) ? Math.tanh(rel(f.sma5, f.sma25) / (2 * v)) : null,
    maLong: ok(f.sma50, f.sma200) ? Math.tanh(rel(f.sma50, f.sma200) / (5 * v)) : null,
    ma75: ok(f.last, f.sma75) ? Math.tanh(rel(f.last, f.sma75) / (3 * v)) : null,
    rsi: ok(f.rsi14) ? (50 - f.rsi14) / 50 : null,
    macd: f.macd && ok(f.macd.macd, f.macd.signal, f.last)
      ? Math.tanh((f.macd.macd - f.macd.signal) / f.last / (0.5 * v)) : null,
    bollinger: f.bb && ok(f.bb.percentB) ? clamp(1 - 2 * f.bb.percentB) : null,
    slope: ok(f.slope60) ? Math.tanh((f.slope60 * Math.sqrt(60)) / v) : null,
  };
}
