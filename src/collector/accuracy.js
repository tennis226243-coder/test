// 過去の予測を実際の値動きと照合して的中率を出す（設計書 3.5）
const HORIZONS = ['1d', '1w', '1m'];

export function evaluate(entries, histories) {
  const byDate = new Map();
  for (const e of entries) byDate.set(e.date, e); // 同じ日付は後ろのものが残る
  // 休場日をはさむと、同じ基準日（asOf）の予測が複数の日付に残る。日付の新しいほうだけを数える
  const ordered = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const seen = new Set();
  const out = [];
  for (const entry of ordered) {
    for (const a of entry.assets ?? []) {
      const h = histories[a.symbol];
      if (!h || seen.has(`${a.symbol}|${a.asOf}`)) continue;
      seen.add(`${a.symbol}|${a.asOf}`);
      const i = h.dates.indexOf(a.asOf);
      if (i === -1) continue;
      for (const key of HORIZONS) {
        const p = a.prediction?.[key];
        if (!p) continue;
        const j = i + p.days;
        if (j >= h.closes.length) continue;
        const actualPct = (h.closes[j] / a.last - 1) * 100;
        const band = (a.vol20 ?? 0.02) * Math.sqrt(p.days) * 100 * 0.25;
        const hit = p.direction === 'up' ? actualPct > 0 : p.direction === 'down' ? actualPct < 0 : Math.abs(actualPct) <= band;
        const inRange = actualPct >= p.rangePct[0] && actualPct <= p.rangePct[1];
        out.push({ date: entry.date, symbol: a.symbol, horizon: key, direction: p.direction, expectedPct: p.expectedPct, rangePct: p.rangePct, actualPct, hit, inRange });
      }
    }
  }
  return out;
}

function stat(evals) {
  const n = evals.length;
  const hits = evals.filter((e) => e.hit).length;
  const inRange = evals.filter((e) => e.inRange).length;
  return { n, hits, hitRate: n ? hits / n : null, inRangeRate: n ? inRange / n : null };
}

export function summarize(evals, now) {
  const byHorizon = Object.fromEntries(HORIZONS.map((h) => [h, stat(evals.filter((e) => e.horizon === h))]));
  const bySymbol = {};
  for (const sym of new Set(evals.map((e) => e.symbol))) {
    bySymbol[sym] = Object.fromEntries(HORIZONS.map((h) => [h, stat(evals.filter((e) => e.symbol === sym && e.horizon === h))]));
  }
  const recent = [...evals].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 100);
  return { updatedAt: now, byHorizon, bySymbol, recent };
}
