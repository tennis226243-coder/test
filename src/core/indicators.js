// テクニカル指標の計算。配列は古い順→新しい順。データが足りなければ null を返す。

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

export function sma(values, n) {
  if (values.length < n) return null;
  return mean(values.slice(-n));
}

export function smaSeries(values, n) {
  return values.map((_, i) => (i < n - 1 ? null : mean(values.slice(i - n + 1, i + 1))));
}

export function emaSeries(values, n) {
  const out = Array(values.length).fill(null);
  if (values.length < n) return out;
  const alpha = 2 / (n + 1);
  let prev = mean(values.slice(0, n));
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export function rsi(values, n = 14) {
  if (values.length < n + 1) return null;
  const diffs = values.slice(1).map((v, i) => v - values[i]);
  let gain = mean(diffs.slice(0, n).map((d) => Math.max(d, 0)));
  let loss = mean(diffs.slice(0, n).map((d) => Math.max(-d, 0)));
  for (let i = n; i < diffs.length; i++) {
    gain = (gain * (n - 1) + Math.max(diffs[i], 0)) / n;
    loss = (loss * (n - 1) + Math.max(-diffs[i], 0)) / n;
  }
  if (gain === 0 && loss === 0) return 50;
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  if (values.length < slow + signal - 1) return null;
  const f = emaSeries(values, fast);
  const s = emaSeries(values, slow);
  const line = values.map((_, i) => (s[i] === null ? null : f[i] - s[i])).filter((x) => x !== null);
  const sig = emaSeries(line, signal);
  const m = line.at(-1);
  const g = sig.at(-1);
  return { macd: m, signal: g, hist: m - g };
}

export function bollinger(values, n = 20, k = 2) {
  if (values.length < n) return null;
  const w = values.slice(-n);
  const mid = mean(w);
  const sd = Math.sqrt(mean(w.map((x) => (x - mid) ** 2)));
  const upper = mid + k * sd;
  const lower = mid - k * sd;
  const percentB = upper === lower ? 0.5 : (values.at(-1) - lower) / (upper - lower);
  return { mid, upper, lower, percentB };
}

export function regressionSlope(values, n = 60) {
  if (values.length < n) return null;
  const y = values.slice(-n).map(Math.log);
  const xm = (n - 1) / 2;
  const ym = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (y[i] - ym);
    den += (i - xm) ** 2;
  }
  return num / den;
}

export function volatility(values, n = 20) {
  if (values.length < n + 1) return null;
  const w = values.slice(-(n + 1));
  const r = w.slice(1).map((v, i) => Math.log(v / w[i]));
  const m = mean(r);
  return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
}
