// テスト用の擬似の株価（平日のみ、ゆるやかな波）
export function weekdays(start, n) {
  const out = [];
  const d = new Date(start + 'T00:00:00Z');
  while (out.length < n) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
export function makeHistory(symbol, n = 260, { end = '2026-10-30', base = 100 } = {}) {
  const all = weekdays('2025-01-01', 2000);
  const endIdx = all.indexOf(end);
  const dates = all.slice(endIdx - n + 1, endIdx + 1);
  const closes = dates.map((_, i) => base * (1 + 0.05 * Math.sin(i / 7)) * (1 + 0.0004 * i));
  return { symbol, dates, closes };
}
// yahoo-finance2 の chart() の形に直す擬似 yf
export function fakeYf(histories, failing = []) {
  return {
    chart: async (symbol) => {
      if (failing.includes(symbol) || !histories[symbol]) throw new Error('fail ' + symbol);
      const h = histories[symbol];
      return { meta: { exchangeTimezoneName: 'UTC' }, quotes: h.dates.map((d, i) => ({ date: new Date(d + 'T12:00:00Z'), close: h.closes[i] })) };
    },
  };
}
