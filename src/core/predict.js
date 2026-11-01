// 点数と重み → 期間ごとの予測（設計書 3.3・3.4）

const HORIZONS = ['1d', '1w', '1m'];
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function horizonPrediction(h, { techScores, news, vol20, weights }) {
  const techParts = Object.entries(h.techWeights)
    .filter(([key]) => isNum(techScores?.[key]))
    .map(([key, w]) => ({ key, w, score: techScores[key] }));
  const newsParts = Object.entries(h.newsMix)
    .filter(([key, w]) => w > 0 && news && isNum(news[key]))
    .map(([key, w]) => ({ key, w, score: news[key] }));

  const sumW = (parts) => parts.reduce((s, p) => s + p.w, 0);
  let techShare = techParts.length ? h.tech : 0;
  let newsShare = newsParts.length ? h.news : 0;
  const total = techShare + newsShare;

  const contributions = [];
  if (total > 0) {
    techShare /= total;
    newsShare /= total;
    const tw = sumW(techParts);
    for (const p of techParts) contributions.push({ key: p.key, weight: (techShare * p.w) / tw, score: p.score });
    if (newsParts.length) {
      const nw = sumW(newsParts);
      const n = newsParts.reduce((s, p) => s + p.w * p.score, 0) / nw;
      contributions.push({ key: 'news', weight: newsShare, score: n });
    }
  }

  const score = contributions.reduce((s, c) => s + c.weight * c.score, 0);
  const v = vol20 ?? 0.02;
  const sigma = v * Math.sqrt(h.days);
  const expectedPct = score * sigma * weights.k * 100;
  const rangePct = [expectedPct - sigma * 100, expectedPct + sigma * 100];

  const direction = score >= weights.flatThreshold ? 'up' : score <= -weights.flatThreshold ? 'down' : 'flat';

  let confidence = 'low';
  if (score !== 0) {
    const agree = contributions
      .filter((c) => c.score !== 0 && Math.sign(c.score) === Math.sign(score))
      .reduce((s, c) => s + c.weight, 0);
    if (agree >= weights.confidence.high) confidence = 'high';
    else if (agree >= weights.confidence.mid) confidence = 'mid';
  }

  return { days: h.days, score, direction, expectedPct, rangePct, confidence, contributions };
}

export function predict({ techScores, news, vol20, weights }) {
  const out = {};
  for (const key of HORIZONS) out[key] = horizonPrediction(weights.horizons[key], { techScores, news, vol20, weights });
  return out;
}
