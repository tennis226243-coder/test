// data/*.json を読み込んで表示する（計算は GitHub Actions 側で済んでいる）

const HORIZONS = [['1d', '翌日'], ['1w', '1週間'], ['1m', '1か月']];
const ARROW = { up: '▲', down: '▼', flat: '▶' };
const CONF = { high: '高', mid: '中', low: '低' };
const LABEL = {
  maShort: '短期移動平均（5/25日）', maLong: '長期移動平均（50/200日）', ma75: '75日線との位置',
  rsi: 'RSI（14日）', macd: 'MACD', bollinger: 'ボリンジャーバンド', slope: '回帰の傾き（60日）', news: 'ニュース・世界動向',
};
const $ = (id) => document.getElementById(id);

// --- 小さな DOM ヘルパー（外部の文字列は必ず textContent で入れる） ---
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
  return node;
}
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const fmtPct = (x, digits = 1) => (isNum(x) ? `${x > 0 ? '+' : ''}${x.toFixed(digits)}%` : '—');
const fmtNum = (x) => (isNum(x) ? x.toLocaleString('ja-JP', { maximumFractionDigits: x >= 1000 ? 0 : 2 }) : '—');
const tone = (s) => (!isNum(s) ? 'flat' : s >= 0.15 ? 'up' : s <= -0.15 ? 'down' : 'flat');

function highlight(text, matched = []) {
  const terms = [...matched].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!terms.length) return [text];
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? el('mark', { text: part }) : part));
}

function headlineItem(h) {
  const title = (h.title ?? '').replace(/ - [^-]*$/, '');
  const url = safeUrl(h.link);
  const body = url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, highlight(title, h.matched)) : el('span', {}, highlight(title, h.matched));
  return el('li', {}, body, el('span', { class: 'tag', text: `${h.source ?? ''} ${isNum(h.score) ? (h.score > 0 ? '+' : '') + h.score.toFixed(2) : ''}` }));
}

// --- 各セクション ---
function renderNotice(latest) {
  const msgs = [];
  if (latest.reanalyzed) msgs.push('再分析の結果（保存されていません）');
  if (!latest.newsAvailable) msgs.push('ニュースの分析なし：ニュースを取得・判定できなかったため、計算式だけで予測しています。');
  if (latest.assets?.some((a) => a.stale)) msgs.push('⚠️ 一部の銘柄は株価を取得できず、前回のデータを表示しています。');
  const n = $('notice') ?? document.querySelector('[data-testid=notice]');
  n.replaceChildren(...msgs.map((m) => el('div', { text: m })));
  n.hidden = msgs.length === 0;
}

function renderWorld(topics = []) {
  $('world').replaceChildren(...topics.map((t) => {
    const s = t.medium?.score;
    return el('article', { class: `card ${tone(s)}`, 'data-testid': 'world-card' },
      el('h3', {}, el('span', { text: t.name }), el('span', { class: tone(s), text: isNum(s) ? `${s > 0 ? '+' : ''}${s.toFixed(2)}` : 'データなし' })),
      el('div', { class: 'muted small', text: `短期 ${isNum(t.short?.score) ? t.short.score.toFixed(2) : '—'} ／ 記事 ${t.medium?.n ?? 0}件` }),
      el('ul', {}, (t.headlines ?? []).slice(0, 3).map(headlineItem)));
  }));
}

function renderIndicators(list = []) {
  $('indicators').replaceChildren(...list.map((i) => el('div', { class: 'indicator', 'data-testid': 'indicator' },
    el('div', { class: 'muted small', text: i.name + (i.stale ? '（⚠️データが古い）' : '') }),
    el('div', { class: 'value', text: fmtNum(i.last) }),
    el('div', { class: tone((i.changePct ?? 0) * 10), text: `前日比 ${fmtPct(i.changePct, 2)}` }))));
}

function predictionCell(p) {
  if (!p) return el('td', { text: '—' });
  return el('td', { class: p.direction }, `${ARROW[p.direction] ?? ''} ${fmtPct(p.expectedPct)}`);
}

let current = null;

function renderAssets(assets = []) {
  $('assets').replaceChildren(...assets.map((a) => {
    const row = el('tr', { 'data-testid': 'asset-row', 'data-symbol': a.symbol, tabindex: '0' },
      el('td', {}, el('strong', { text: a.name }), el('span', { class: 'tag', text: a.symbol }),
        a.note ? el('span', { class: 'tag', text: a.note }) : null,
        a.stale ? el('span', { class: 'tag', text: '⚠️データが古い' }) : null),
      el('td', {}, fmtNum(a.last), el('div', { class: `small ${tone((a.changePct ?? 0) * 10)}`, text: fmtPct(a.changePct, 2) })),
      HORIZONS.map(([k]) => predictionCell(a.prediction?.[k])),
      el('td', { text: CONF[a.prediction?.['1w']?.confidence] ?? '—' }));
    const open = () => renderDetail(a, row);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    return row;
  }));
}

// --- 詳細（チャート・内訳・見出し） ---
function sma(v, n) { return v.map((_, i) => (i < n - 1 ? null : v.slice(i - n + 1, i + 1).reduce((s, x) => s + x, 0) / n)); }
function bands(v, n = 20, k = 2) {
  const mid = sma(v, n);
  return v.map((_, i) => {
    if (mid[i] === null) return [null, null];
    const w = v.slice(i - n + 1, i + 1);
    const sd = Math.sqrt(w.reduce((s, x) => s + (x - mid[i]) ** 2, 0) / n);
    return [mid[i] + k * sd, mid[i] - k * sd];
  });
}

let chart = null;

function drawChart(canvas, a) {
  if (!window.Chart) {
    canvas.replaceWith(el('p', { class: 'muted', text: 'チャートを読み込めませんでした（Chart.js が使えません）' }));
    return;
  }
  const closes = a.history?.closes ?? [];
  const dates = a.history?.dates ?? [];
  const show = 120;
  const start = Math.max(0, closes.length - show);
  const cut = (arr) => arr.slice(start);
  const bb = bands(closes);
  const p = a.prediction?.['1m'];
  const ahead = p ? p.days : 0;
  const pad = Array(ahead).fill(null);
  const last = closes.at(-1);
  const futureLabels = Array.from({ length: ahead }, (_, i) => `+${i + 1}営業日`);
  const band = (pct) => [...Array(closes.length - start - 1).fill(null), last, ...Array.from({ length: ahead }, (_, i) => last * (1 + (pct * Math.sqrt((i + 1) / ahead)) / 100))];
  const css = getComputedStyle(document.documentElement);
  const c = (name) => css.getPropertyValue(name).trim();

  chart?.destroy();
  chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels: [...cut(dates), ...futureLabels],
      datasets: [
        { label: '終値', data: [...cut(closes), ...pad], borderColor: c('--text'), borderWidth: 2, pointRadius: 0 },
        { label: '25日線', data: [...cut(sma(closes, 25)), ...pad], borderColor: c('--accent'), borderWidth: 1, pointRadius: 0 },
        { label: '75日線', data: [...cut(sma(closes, 75)), ...pad], borderColor: c('--flat'), borderWidth: 1, pointRadius: 0 },
        { label: 'ボリンジャー上', data: [...cut(bb.map((b) => b[0])), ...pad], borderColor: c('--border'), borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
        { label: 'ボリンジャー下', data: [...cut(bb.map((b) => b[1])), ...pad], borderColor: c('--border'), borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
        ...(p ? [
          { label: '1か月予測の上限', data: band(p.rangePct[1]), borderColor: 'transparent', backgroundColor: c('--up-bg'), pointRadius: 0, fill: '+1' },
          { label: '1か月予測の下限', data: band(p.rangePct[0]), borderColor: 'transparent', pointRadius: 0, fill: false },
          { label: '1か月予測', data: band(p.expectedPct), borderColor: c(`--${p.direction === 'flat' ? 'flat' : p.direction}`), borderDash: [6, 3], borderWidth: 2, pointRadius: 0 },
        ] : []),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, spanGaps: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: c('--muted'), boxWidth: 12, filter: (i) => !i.text.includes('下限') && !i.text.includes('ボリンジャー下') } } },
      scales: {
        x: { ticks: { color: c('--muted'), maxTicksLimit: 6, maxRotation: 0 }, grid: { color: c('--border') } },
        y: { ticks: { color: c('--muted') }, grid: { color: c('--border') } },
      },
    },
  });
}

function contributionBars(p) {
  const rows = [...(p?.contributions ?? [])].sort((x, y) => Math.abs(y.weight * y.score) - Math.abs(x.weight * x.score));
  if (!rows.length) return el('p', { class: 'muted', text: '使える要素がありません' });
  const max = Math.max(...rows.map((r) => Math.abs(r.weight * r.score)), 1e-9);
  return el('div', { class: 'bars' }, rows.map((r) => {
    const v = r.weight * r.score;
    return el('div', { class: 'bar-row' },
      el('span', { text: LABEL[r.key] ?? r.key }),
      el('div', { class: 'bar-track' }, el('div', { class: `bar ${v >= 0 ? 'pos' : 'neg'}`, style: `width:${(Math.abs(v) / max) * 50}%` })),
      el('span', { class: v >= 0 ? 'up' : 'down', text: `${v >= 0 ? '+' : ''}${v.toFixed(3)}` }));
  }));
}

function renderDetail(a, row) {
  current = a.symbol;
  document.querySelectorAll('[data-testid=asset-row]').forEach((r) => r.classList.toggle('selected', r === row));
  const d = $('detail');
  const canvas = el('canvas', { 'aria-label': `${a.name} の価格チャート` });
  d.replaceChildren(
    el('h3', { text: `${a.name}（${a.symbol}）` }),
    el('p', { class: 'muted small', text: `データの日付: ${a.asOf ?? '—'}${a.stale ? '（⚠️データが古い）' : ''}` }),
    el('div', { class: 'chart-box' }, canvas),
    el('h4', { text: '点数の内訳' }),
    ...HORIZONS.map(([k, label]) => {
      const p = a.prediction?.[k];
      return el('div', {},
        el('p', {}, el('strong', { text: `${label}: ` }),
          el('span', { class: p?.direction, text: p ? `${ARROW[p.direction]} ${fmtPct(p.expectedPct)}（幅 ${fmtPct(p.rangePct[0])} 〜 ${fmtPct(p.rangePct[1])}、合計点 ${p.score.toFixed(2)}、確信度 ${CONF[p.confidence]}）` : '—' })),
        contributionBars(p));
    }),
    a.kind === 'stock' ? el('h4', { text: '関係する見出し' }) : null,
    a.kind === 'stock' ? ((a.news?.headlines ?? []).length ? el('ul', {}, a.news.headlines.map(headlineItem)) : el('p', { class: 'muted', text: '判定できた見出しはありません' })) : null,
  );
  d.hidden = false;
  drawChart(canvas, a);
}

function renderAccuracy(acc) {
  const box = $('accuracy');
  const stats = acc?.byHorizon ?? {};
  if (!HORIZONS.some(([k]) => stats[k]?.n > 0)) {
    box.replaceChildren(el('p', { class: 'muted', text: 'まだデータがありません（予測の期限が来ると、ここに的中率が出ます）' }));
    return;
  }
  box.replaceChildren(el('div', { class: 'acc' }, HORIZONS.map(([k, label]) => {
    const s = stats[k] ?? { n: 0 };
    return el('div', { class: 'indicator' },
      el('div', { class: 'muted small', text: label }),
      el('div', { class: 'value', text: isNum(s.hitRate) ? `${(s.hitRate * 100).toFixed(0)}%` : '—' }),
      el('div', { class: 'muted small', text: `${s.n}件中 ${s.hits ?? 0}件的中／幅の中 ${isNum(s.inRangeRate) ? (s.inRangeRate * 100).toFixed(0) + '%' : '—'}` }));
  })));
}

function renderSources(latest) {
  const all = [...(latest.topics ?? []).flatMap((t) => t.headlines ?? []), ...(latest.assets ?? []).flatMap((a) => a.news?.headlines ?? [])];
  const seen = new Set();
  const items = all.filter((h) => safeUrl(h.link) && !seen.has(h.link) && seen.add(h.link));
  $('sources').replaceChildren(...(items.length ? items.map((h) => el('li', {}, el('a', { href: safeUrl(h.link), target: '_blank', rel: 'noopener noreferrer', text: h.title }))) : [el('li', { class: 'muted', text: 'なし' })]));
}

export function render(latest, accuracy) {
  const t = new Date(latest.generatedAt);
  document.querySelector('[data-testid=updated-at]').textContent = Number.isNaN(t.getTime()) ? '—' : t.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  renderNotice(latest);
  renderWorld(latest.topics);
  renderIndicators(latest.indicators);
  renderAssets(latest.assets);
  renderAccuracy(accuracy);
  renderSources(latest);
  const keep = latest.assets?.find((a) => a.symbol === current);
  if (keep) renderDetail(keep, document.querySelector(`[data-testid=asset-row][data-symbol="${CSS.escape(keep.symbol)}"]`));
}

function showError() {
  const e = document.querySelector('[data-testid=error]');
  const btn = el('button', { type: 'button', text: '再読み込み' });
  btn.addEventListener('click', () => location.reload());
  e.replaceChildren('データを読み込めませんでした。', btn);
  e.hidden = false;
}

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  let latest;
  try {
    latest = await getJson('data/latest.json');
  } catch (e) {
    console.error(e);
    showError();
    return;
  }
  const accuracy = await getJson('data/accuracy.json').catch(() => null);
  render(latest, accuracy);
}

main();
