# 株価予想アプリ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日米の指数と登録銘柄について、テクニカル指標と Google ニュース検索（単語辞書で点数化）を組み合わせ、翌日・1週間・1か月の予測を表示する静的 HTML サイトを作る。

**Architecture:** 毎日 GitHub Actions が Yahoo Finance の株価と Google ニュース RSS の見出しから `data/*.json` を作り、GitHub Pages が `site/` と `data/` を配信する。計算はすべて Actions 側で行い、サイトは JSON を表示するだけ。

**Tech Stack:** Node.js 22, ES Modules, vitest, yahoo-finance2, fast-xml-parser, Chart.js 4.4.1（CDN）, Playwright（環境に導入済みのものを使う）, GitHub Actions / Pages

**Spec:** `docs/superpowers/specs/2026-11-01-stock-predictor-design.md`

## Global Constraints

- `src/core/` は純粋な関数だけにする（通信・ファイル・現在時刻の取得をしない。時刻は引数 `now` で受け取る）。
- 価格の配列はすべて古い順→新しい順の `number[]`。
- 点数はすべて −1〜+1、確信度（confidence）は 0〜1。
- 期間のキーは `"1d"`（1営業日）・`"1w"`（5営業日）・`"1m"`（21営業日）。ニュースの窓は `short`（直近2日）・`medium`（7日）。
- 方向は `"up" | "flat" | "down"`、確信度の段階は `"high" | "mid" | "low"`。
- 画面の文言は日本語。フッターの免責表示は「投資助言ではありません。投資の判断はご自身の責任で行ってください。」と一字一句そのまま。
- 日付は JST の `YYYY-MM-DD`。
- テストでは実際の Yahoo / Google に通信しない（`yf`・`fetch`・`sleep` は引数で注入する）。
- API キーや秘密情報は使わない・コミットしない（リポジトリは public）。

## Review Focus

1. **上場して間もない銘柄（終値が30日分しかない）**：SMA200・SMA75・回帰の傾きは null になり、残った指標で重みが按分し直され、予測は出る → Task 2・3 のテスト
2. **Yahoo の終値に null が混じる・日米で休場日が違う**：null の日は捨てる。的中率は銘柄ごとの日付の並びで「h 営業日後」を数える → Task 6・8 のテスト
3. **英単語の誤一致と媒体名の混入**：`war` は `Warning` や `award` に一致しない。見出し末尾の「 - 媒体名」は判定の前に取り除く → Task 4 のテスト
4. **同じ記事が日本語版・英語版や複数の検索語で重複して返る**：リンクか見出しが同じなら1件として数える → Task 5 のテスト
5. **同じ日に自動処理が2回動く**：`history/当日.json` は上書きになり、的中率は二重に数えない → Task 8・9 のテスト

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `package.json` | `"type": "module"`、scripts: `test`（vitest run）, `test:e2e`（playwright test）, `collect`（node src/collector/run.js）, `build:site`（node scripts/build-site.js） |
| `config/watchlist.json` | 指数・世界の指標・登録銘柄 |
| `config/weights.json` | 期間ごとの重みなど |
| `config/news.json` | テーマ・検索語・影響の対応表 |
| `config/lexicon.json` | 単語辞書 |
| `src/core/indicators.js` | 指標の計算 |
| `src/core/scoring.js` | 指標 → 点数 |
| `src/core/predict.js` | 点数 → 期間ごとの予測 |
| `src/core/sentiment.js` | 見出し → 点数 |
| `src/core/newsAggregate.js` | 見出し → テーマ・市場・銘柄の点数 |
| `src/core/pipeline.js` | 銘柄データの組み立て、ニュースの分析、予測 |
| `src/collector/prices.js` | Yahoo Finance から取得 |
| `src/collector/news.js` | Google ニュース RSS の取得と読み込み |
| `src/collector/accuracy.js` | 的中率 |
| `src/collector/run.js` | 毎日の処理 |
| `scripts/build-site.js` | `_site/` に `site/*` と `<dataDir>`（→ `_site/data/`）をコピー |
| `site/index.html`, `site/style.css`, `site/app.js` | 画面 |
| `tests/core/*.test.js`, `tests/collector/*.test.js`, `tests/e2e/*.test.js`, `tests/fixtures/` | テスト |
| `.github/workflows/daily.yml` | 自動実行と Pages の公開 |

---

### Task 1: プロジェクトの準備と指標の計算

**Files:**
- Create: `package.json`, `.gitignore`（`node_modules/`, `_site/`, `test-results/`）, `vitest.config.js`（`include: ['tests/core/**/*.test.js', 'tests/collector/**/*.test.js']`）, `src/core/indicators.js`
- Test: `tests/core/indicators.test.js`

**Interfaces:**
- Produces（すべて `values: number[]` を受け取り、データ不足なら `null`）:
  - `sma(values, n) -> number|null` … 末尾 n 個の平均
  - `smaSeries(values, n) -> (number|null)[]` … 同じ長さ、先頭 n−1 個は null
  - `emaSeries(values, n) -> (number|null)[]` … 先頭 n−1 個は null、n−1 番目は最初の n 個の SMA、以降 α = 2/(n+1)
  - `rsi(values, n = 14) -> number|null` … Wilder の平滑化。n+1 個必要。上昇・下落とも0なら 50、下落だけ0なら 100
  - `macd(values, fast = 12, slow = 26, signal = 9) -> {macd, signal, hist}|null` … macd 系列 = EMA12 − EMA26、signal = その EMA9。slow+signal−1 個必要
  - `bollinger(values, n = 20, k = 2) -> {mid, upper, lower, percentB}|null` … 母標準偏差。幅0なら percentB = 0.5
  - `regressionSlope(values, n = 60) -> number|null` … 末尾 n 個の ln(価格) を 0..n−1 に最小二乗で当てはめた傾き
  - `volatility(values, n = 20) -> number|null` … 末尾 n 個の日次対数収益率（n+1 個の価格が必要）の標本標準偏差

- [ ] **Step 1: `package.json` を作り、`npm i -D vitest` を実行する**
- [ ] **Step 2: 失敗するテストを書く**

```js
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
```

- [ ] **Step 3: `npx vitest run tests/core/indicators.test.js` で FAIL（import できない）を確認する**
- [ ] **Step 4: `src/core/indicators.js` を実装する**
- [ ] **Step 5: PASS を確認する**
- [ ] **Step 6: コミット** `feat(core): テクニカル指標の計算`

---

### Task 2: 指標を点数にする

**Files:**
- Create: `src/core/scoring.js`
- Test: `tests/core/scoring.test.js`

**Interfaces:**
- Consumes: Task 1 の関数
- Produces:
  - `computeFeatures(closes: number[]) -> Features`
    `Features = { last, sma5, sma25, sma50, sma75, sma200, rsi14, macd: {macd,signal,hist}|null, bb: {mid,upper,lower,percentB}|null, slope60, vol20 }`（足りないものは null）
  - `scoreTechnicals(f: Features) -> TechScores`
    `TechScores = { maShort, maLong, ma75, rsi, macd, bollinger, slope }`（number または null）

変換式は設計書 3.1 の表どおり（v = max(vol20 ?? 0.02, 1e-6)。入力に null があればその点数は null）。

- [ ] **Step 1: 失敗するテストを書く**

```js
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
```

- [ ] **Step 2: `npx vitest run tests/core/scoring.test.js` で FAIL を確認する**
- [ ] **Step 3: 実装する**
- [ ] **Step 4: PASS を確認する**
- [ ] **Step 5: コミット** `feat(core): 指標の点数化`

---

### Task 3: 期間ごとの予測

**Files:**
- Create: `config/weights.json`, `src/core/predict.js`
- Test: `tests/core/predict.test.js`

**`config/weights.json`:**

```json
{
  "k": 1.0,
  "flatThreshold": 0.15,
  "confidence": { "high": 0.75, "mid": 0.5 },
  "horizons": {
    "1d": { "days": 1,  "tech": 0.5, "news": 0.5, "techWeights": { "rsi": 0.35, "bollinger": 0.35, "maShort": 0.15, "macd": 0.15 }, "newsMix": { "short": 1.0, "medium": 0.0 } },
    "1w": { "days": 5,  "tech": 0.5, "news": 0.5, "techWeights": { "macd": 0.35, "maShort": 0.35, "rsi": 0.15, "bollinger": 0.15 }, "newsMix": { "short": 0.5, "medium": 0.5 } },
    "1m": { "days": 21, "tech": 0.6, "news": 0.4, "techWeights": { "maLong": 0.35, "slope": 0.35, "ma75": 0.30 }, "newsMix": { "short": 0.0, "medium": 1.0 } }
  }
}
```

**Interfaces:**
- Consumes: `TechScores`（Task 2）
- Produces:
  - `predict({ techScores, news: {short: number|null, medium: number|null}|null, vol20: number|null, weights }) -> { "1d": Horizon, "1w": Horizon, "1m": Horizon }`
  - `Horizon = { days, score, direction, expectedPct, rangePct: [lo, hi], confidence, contributions: [{ key, weight, score }] }`
    - contributions の key は techWeights のキー、またはニュースの `"news"`。weight はその期間の合計点に対する実効の重み（合計1）

**計算手順**（1つの期間について）:
1. 計算式：techWeights のうち点数が null でないものだけで重みを按分し、加重平均 T。全部 null なら計算式なし
2. ニュース：newsMix のうち重みが0より大きく、値が null でないものだけで按分した加重平均 N。該当なし（または news が null）ならニュースなし
3. 片方しかなければその重みを1にする。両方なければ score = 0、contributions = []
4. S = tech·T + news·N（按分後）
5. σh = (vol20 ?? 0.02)·√days、expectedPct = S·σh·k·100、rangePct = [expectedPct − σh·100, expectedPct + σh·100]
6. direction：S ≥ flatThreshold → up、S ≤ −flatThreshold → down、それ以外 flat
7. 確信度：S = 0 なら low。それ以外は「符号が S と同じ（0 ではない）要素の実効の重みの合計」が ≥0.75 → high、≥0.5 → mid、それ未満 → low

- [ ] **Step 1: 失敗するテストを書く**

```js
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
```

- [ ] **Step 2: `npx vitest run tests/core/predict.test.js` で FAIL を確認する**
- [ ] **Step 3: 実装する**
- [ ] **Step 4: PASS を確認する**
- [ ] **Step 5: コミット** `feat(core): 期間ごとの予測`

---

### Task 4: 見出しの点数化（単語辞書）

**Files:**
- Create: `config/lexicon.json`, `src/core/sentiment.js`
- Test: `tests/core/sentiment.test.js`

**`config/lexicon.json`（初期値）:**

```json
{
  "ja": {
    "上方修正": 1.0, "増益": 0.8, "最高益": 0.9, "最高値": 0.6, "黒字": 0.5, "増配": 0.6, "好調": 0.5, "回復": 0.4,
    "上昇": 0.4, "反発": 0.4, "利下げ": 0.5, "緩和": 0.4, "受注": 0.5, "提携": 0.4, "買収": 0.3, "停戦": 0.6, "合意": 0.4,
    "下方修正": -1.0, "減益": -0.8, "赤字": -0.6, "減配": -0.6, "急落": -0.8, "暴落": -1.0, "株価下落": -0.6, "下落": -0.4,
    "最安値": -0.6, "利上げ": -0.4, "引き締め": -0.4, "懸念": -0.4, "警戒": -0.3, "景気後退": -0.8, "紛争": -0.7,
    "攻撃": -0.7, "制裁": -0.5, "関税": -0.4, "不祥事": -0.8, "リコール": -0.5, "提訴": -0.4, "破綻": -1.0
  },
  "en": {
    "beat": 0.6, "beats": 0.6, "surge": 0.6, "surges": 0.6, "rally": 0.5, "rallies": 0.5, "soar": 0.7, "soars": 0.7,
    "upgrade": 0.6, "record high": 0.6, "rate cut": 0.5, "growth": 0.3, "partnership": 0.4, "contract": 0.4, "ceasefire": 0.6,
    "miss": -0.6, "misses": -0.6, "plunge": -0.8, "plunges": -0.8, "slump": -0.6, "tumble": -0.6, "tumbles": -0.6,
    "downgrade": -0.6, "recession": -0.8, "rate hike": -0.4, "war": -0.7, "attack": -0.7, "sanctions": -0.5,
    "tariff": -0.4, "tariffs": -0.4, "layoffs": -0.5, "lawsuit": -0.4, "selloff": -0.6, "sell-off": -0.6, "fears": -0.4,
    "bankruptcy": -1.0
  },
  "negators": { "ja": ["回避", "撤回", "免れ", "否定"], "en": ["avoid", "avoids", "eases", "ease", "not"] }
}
```

**Interfaces:**
- Produces:
  - `stripSource(title: string) -> string` … 最後の `" - "` より前を返す（無ければそのまま）。前後の空白は除く
  - `scoreHeadline(title: string, lang: 'ja'|'en', lexicon, topicLexicon?: {ja?, en?}) -> { score: number|null, matched: string[] }`
    1. stripSource した見出しで判定する
    2. 辞書 = lexicon[lang] に topicLexicon?.[lang] を上書きで重ねたもの
    3. 長い語から順に探し、見つかった部分は空白に置き換える（「株価下落」に当たったら「下落」を二重に数えない）
    4. ja は部分一致。en は大文字小文字を区別せず、前後が英字でないこと（`(?<![A-Za-z])語(?![A-Za-z])`）
    5. 1つも当たらなければ `{ score: null, matched: [] }`。当たれば tanh(点数の合計)。negators[lang] のどれかを含めば −0.5 倍（en の打ち消し語も単語の境界で判定する）

- [ ] **Step 1: 失敗するテストを書く**

```js
import { stripSource, scoreHeadline } from '../../src/core/sentiment.js';
import lex from '../../config/lexicon.json' with { type: 'json' };

test('媒体名を除く', () => { expect(stripSource('A - B - Reuters')).toBe('A - B'); expect(stripSource('見出しだけ')).toBe('見出しだけ'); });
test('日本語の一致', () => {
  expect(scoreHeadline('トヨタ、通期予想を上方修正 - 日本経済新聞', 'ja', lex)).toEqual({ score: Math.tanh(1), matched: ['上方修正'] });
});
test('長い語を優先し二重に数えない', () => {
  expect(scoreHeadline('株価下落が続く', 'ja', lex).matched).toEqual(['株価下落']);
});
test('英語は単語の境界で一致（Review Focus 3）', () => {
  expect(scoreHeadline('Warning signs as award season begins', 'en', lex).score).toBeNull();
  const r = scoreHeadline('War fears hit stocks - Reuters', 'en', lex);
  expect(r.matched.sort()).toEqual(['fears', 'war']); expect(r.score).toBeCloseTo(Math.tanh(-1.1));
});
test('媒体名の単語は数えない（Review Focus 3）', () => {
  expect(scoreHeadline('Stocks open flat - Growth Weekly', 'en', lex).score).toBeNull();
});
test('打ち消し', () => { expect(scoreHeadline('景気後退を回避', 'ja', lex).score).toBeCloseTo(Math.tanh(-0.8) * -0.5); });
test('テーマ専用の辞書', () => {
  expect(scoreHeadline('円安が進行', 'ja', lex).score).toBeNull();
  expect(scoreHeadline('円安が進行', 'ja', lex, { ja: { '円安': 0.5 } }).score).toBeCloseTo(Math.tanh(0.5));
});
```

- [ ] **Step 2: `npx vitest run tests/core/sentiment.test.js` で FAIL を確認する**
- [ ] **Step 3: 実装する**
- [ ] **Step 4: PASS を確認する**
- [ ] **Step 5: コミット** `feat(core): 単語辞書による見出しの点数化`

---

### Task 5: ニュースのまとめ方と検索の設定

**Files:**
- Create: `config/news.json`, `src/core/newsAggregate.js`
- Test: `tests/core/newsAggregate.test.js`

**`config/news.json`:**

```json
{
  "lookbackDays": 7, "shortDays": 2, "halfLifeDays": 2, "confidenceFull": 5, "stockMarketWeight": 0.5,
  "topics": [
    { "id": "us", "name": "米国", "queries": [{ "q": "米国 景気 株価", "lang": "ja" }, { "q": "US economy stocks", "lang": "en" }], "impact": { "JP": 0.5, "US": 1.0 } },
    { "id": "japan", "name": "日本", "queries": [{ "q": "日本 景気 株価", "lang": "ja" }, { "q": "Japan economy stocks", "lang": "en" }], "impact": { "JP": 1.0, "US": 0.1 } },
    { "id": "europe", "name": "欧州", "queries": [{ "q": "欧州 経済 ECB", "lang": "ja" }, { "q": "Europe economy ECB", "lang": "en" }], "impact": { "JP": 0.3, "US": 0.3 } },
    { "id": "china", "name": "中国", "queries": [{ "q": "中国 経済", "lang": "ja" }, { "q": "China economy", "lang": "en" }], "impact": { "JP": 0.5, "US": 0.3 } },
    { "id": "middle_east", "name": "中東", "queries": [{ "q": "中東 情勢", "lang": "ja" }, { "q": "Middle East tensions", "lang": "en" }], "impact": { "JP": 0.4, "US": 0.3 } },
    { "id": "emerging", "name": "新興国", "queries": [{ "q": "新興国 経済", "lang": "ja" }, { "q": "emerging markets", "lang": "en" }], "impact": { "JP": 0.2, "US": 0.2 } },
    { "id": "monetary_policy", "name": "金融政策", "queries": [{ "q": "日銀 FRB 金利", "lang": "ja" }, { "q": "Fed interest rates", "lang": "en" }], "impact": { "JP": 0.6, "US": 1.0 } },
    { "id": "fx", "name": "為替", "queries": [{ "q": "円相場", "lang": "ja" }, { "q": "yen dollar", "lang": "en" }], "impact": { "JP": 0.5, "US": 0.0 },
      "lexicon": { "ja": { "円安": 0.5, "円高": -0.5 }, "en": { "weaker yen": 0.5, "yen weakens": 0.5, "stronger yen": -0.5, "yen strengthens": -0.5 } } },
    { "id": "commodities", "name": "資源", "queries": [{ "q": "原油価格", "lang": "ja" }, { "q": "oil prices", "lang": "en" }], "impact": { "JP": 0.4, "US": 0.2 },
      "lexicon": { "ja": { "原油高": -0.5, "原油安": 0.5, "上昇": -0.3, "下落": 0.3 }, "en": { "oil prices rise": -0.5, "oil prices fall": 0.5, "surge": -0.4, "slump": 0.4 } } }
  ],
  "stockQueries": [{ "q": "{name} 株", "lang": "ja" }, { "q": "{name} stock", "lang": "en" }]
}
```

**Interfaces:**
- Consumes: `scoreHeadline`, `stripSource`（Task 4）
- Produces:
  - `type Headline = { title: string, link: string, source: string, pubDate: string /* ISO */, lang: 'ja'|'en' }`
  - `type Scored = Headline & { score: number|null, matched: string[], ageDays: number }`
  - `type Agg = { score: number|null, confidence: number, n: number }`
  - `dedupe(headlines: Headline[]) -> Headline[]` … 先に出たものを残す。link が同じ、または stripSource した見出しが同じなら重複
  - `scoreAll(headlines, { now: Date, lexicon, topicLexicon? }) -> Scored[]` … ageDays = (now − pubDate) / 1日（小数）
  - `aggregate(scored: Scored[], { maxAgeDays, halfLifeDays, confidenceFull }) -> Agg` … score が null でなく ageDays ≤ maxAgeDays のものだけ。重み 0.5^(ageDays/halfLifeDays)。n はその件数、confidence = min(1, n/confidenceFull)。n=0 なら score null
  - `summarizeTopic(scored, newsCfg) -> { short: Agg, medium: Agg }`（short は maxAgeDays = shortDays、medium は lookbackDays）
  - `marketNews(topics: { id, short: Agg, medium: Agg }[], market: 'JP'|'US', newsCfg) -> { short: number|null, medium: number|null }` … Σ(score·confidence·impact)/Σ(confidence·impact)。分母0なら null
  - `stockNews(stock: { short: Agg, medium: Agg }, market: { short, medium }, newsCfg) -> { short: number|null, medium: number|null }` … 窓ごとに、銘柄（重み 1·confidence）と市場（重み stockMarketWeight）の null でないものの加重平均。両方 null なら null

- [ ] **Step 1: 失敗するテストを書く**

```js
import { dedupe, scoreAll, aggregate, summarizeTopic, marketNews, stockNews } from '../../src/core/newsAggregate.js';
import cfg from '../../config/news.json' with { type: 'json' };
const now = new Date('2026-11-02T00:00:00Z');
const h = (title, daysAgo, o = {}) => ({ title, link: 'https://x/' + title, source: 'S', lang: 'ja', pubDate: new Date(now - daysAgo * 864e5).toISOString(), ...o });
const s = (score, ageDays) => ({ ...h('t', ageDays), score, matched: [], ageDays });

test('重複を除く（Review Focus 4）', () => {
  const out = dedupe([h('A', 0), h('A', 0, { link: 'https://other' }), h('B', 0, { link: 'https://x/A' }), h('C', 0)]);
  expect(out.map((x) => x.title)).toEqual(['A', 'C']);
});
test('経過日数の重みと確信度', () => {
  const a = aggregate([s(1, 0), s(-1, 2), s(null, 0)], { maxAgeDays: 7, halfLifeDays: 2, confidenceFull: 5 });
  expect(a.score).toBeCloseTo(1 / 3); expect(a.n).toBe(2); expect(a.confidence).toBeCloseTo(0.4);
});
test('窓の外は除く', () => {
  const t = summarizeTopic([s(1, 1), s(-1, 3), s(-1, 8)], cfg);
  expect(t.short.score).toBe(1); expect(t.medium.n).toBe(2);
  expect(aggregate([], { maxAgeDays: 7, halfLifeDays: 2, confidenceFull: 5 })).toEqual({ score: null, confidence: 0, n: 0 });
});
test('scoreAll は経過日数を付ける', () => {
  expect(scoreAll([h('上方修正', 1.5)], { now, lexicon: { ja: { '上方修正': 1 }, en: {}, negators: { ja: [], en: [] } } })[0].ageDays).toBeCloseTo(1.5);
});
test('市場の点数は影響度で重み付け', () => {
  const A = (score, confidence) => ({ score, confidence, n: 5 });
  const topics = [{ id: 'us', short: A(null, 0), medium: A(1, 1) }, { id: 'middle_east', short: A(null, 0), medium: A(-1, 0.5) }];
  const m = marketNews(topics, 'US', cfg);
  expect(m.medium).toBeCloseTo((1 - 0.15) / 1.15); expect(m.short).toBeNull();
});
test('銘柄の点数は銘柄と市場の加重平均', () => {
  const r = stockNews({ short: { score: 1, confidence: 1, n: 5 }, medium: { score: null, confidence: 0, n: 0 } }, { short: -1, medium: 0.4 }, cfg);
  expect(r.short).toBeCloseTo((1 - 0.5) / 1.5); expect(r.medium).toBeCloseTo(0.4);
});
```

- [ ] **Step 2: `npx vitest run tests/core/newsAggregate.test.js` で FAIL を確認する**
- [ ] **Step 3: 実装する**
- [ ] **Step 4: PASS を確認する**
- [ ] **Step 5: コミット** `feat(core): ニュースのまとめ方と検索の設定`

---

### Task 6: 株価の取得と銘柄の設定

**Files:**
- Create: `config/watchlist.json`, `src/collector/prices.js`
- Test: `tests/collector/prices.test.js`

**`config/watchlist.json`:**

```json
{
  "indices": [
    { "symbol": "^N225",  "name": "日経平均", "market": "JP" },
    { "symbol": "1306.T", "name": "TOPIX（ETF 1306で代用）", "market": "JP", "note": "ETF の価格" },
    { "symbol": "^GSPC",  "name": "S&P500", "market": "US" },
    { "symbol": "^IXIC",  "name": "NASDAQ総合", "market": "US" },
    { "symbol": "^DJI",   "name": "ダウ平均", "market": "US" }
  ],
  "indicators": [
    { "symbol": "JPY=X", "name": "ドル円" },
    { "symbol": "CL=F",  "name": "WTI原油" },
    { "symbol": "^TNX",  "name": "米国10年債利回り" },
    { "symbol": "^VIX",  "name": "VIX" }
  ],
  "stocks": [
    { "symbol": "IONQ", "name": "IonQ", "market": "US" }
  ]
}
```

**Interfaces:**
- Produces:
  - `type History = { symbol: string, dates: string[], closes: number[] }`（dates は `YYYY-MM-DD`。終値が null・NaN の日は除く）
  - `fetchHistory(symbol, { yf, period1: Date }) -> Promise<History>` … `yf.chart(symbol, { period1, interval: '1d' })` の `quotes[]`（`date`, `close`）を使う
  - `fetchAll(symbols: string[], { yf, period1 }) -> Promise<{ ok: Record<string, History>, failed: string[] }>` … 順に取得。例外や0件は failed
  - `defaultYf()` … yahoo-finance2 のインスタンス（インストールしたバージョンの使い方に合わせる。v3 なら `new YahooFinance()`）

- [ ] **Step 1: `npm i yahoo-finance2` を実行する**
- [ ] **Step 2: 失敗するテストを書く**（yf は `{ chart: async (s) => ... }` の擬似オブジェクト）
  - `fetchHistory`：quotes に `close: null` を含めると、その日が dates と closes の両方から消えること（Review Focus 2）。dates が `/^\d{4}-\d{2}-\d{2}$/` に合うこと
  - `fetchAll`：1銘柄が例外を投げ、1銘柄が quotes 0件のとき、どちらも failed に入り、残りは ok に入ること
- [ ] **Step 3: `npx vitest run tests/collector/prices.test.js` で FAIL を確認する**
- [ ] **Step 4: 実装する**
- [ ] **Step 5: PASS を確認する**
- [ ] **Step 6: 手動で確認する** 実際に IONQ の約400日分を取得して、件数200以上と最新の終値が出ること（ネットワークに出られない環境では飛ばし、その旨を報告する）
- [ ] **Step 7: コミット** `feat(collector): 株価の取得と銘柄の設定`

---

### Task 7: Google ニュース RSS の取得

**Files:**
- Create: `src/collector/news.js`, `tests/fixtures/rss-ja.xml`, `tests/fixtures/rss-en.xml`
- Test: `tests/collector/news.test.js`

**Interfaces:**
- Consumes: `Headline`（Task 5）
- Produces:
  - `buildRssUrl(q: string, lang: 'ja'|'en', lookbackDays = 7) -> string` … `https://news.google.com/rss/search?q=<encodeURIComponent(q + ' when:' + lookbackDays + 'd')>` に、ja なら `&hl=ja&gl=JP&ceid=JP:ja`、en なら `&hl=en-US&gl=US&ceid=US:en`
  - `parseRss(xml: string, lang) -> Headline[]` … `fast-xml-parser` で `rss.channel.item` を読む（1件だけのときはオブジェクトなので配列に直す）。source は `<source>` の文字列（属性つきでも文字列部分）。pubDate が日付として読めない item は捨てる。XML が壊れていれば `[]`
  - `fetchNews(queries: { key: string, q: string, lang }[], { fetch, sleep, lookbackDays = 7, retries = 2, intervalMs = 1000 }) -> Promise<{ results: Record<key, Headline[]>, failed: string[] }>` … 1件ずつ順に、間に intervalMs 待つ。ヘッダー `User-Agent: Mozilla/5.0 (personal stock-predictor)`。HTTP エラーや例外は 2000ms·2^(試行−1) 待ってやり直し、それでもだめなら failed に key を入れる。同じ key の結果は連結する（1つのテーマに日本語と英語の2つの検索がある）。0件は失敗ではない

- [ ] **Step 1: `npm i fast-xml-parser` を実行し、テスト用の XML を作る**（Google ニュース RSS の形：`<rss><channel><item><title>見出し - 媒体名</title><link>…</link><pubDate>Sun, 01 Nov 2026 22:10:00 GMT</pubDate><source url="…">媒体名</source></item>…`。ja は3件、en は1件だけ）
- [ ] **Step 2: 失敗するテストを書く**
  - `buildRssUrl('円相場', 'ja')` が `q=%E5%86%86%E7%9B%B8%E5%A0%B4%20when%3A7d` と `ceid=JP:ja` を含むこと
  - `parseRss(rss-ja)` が3件、`parseRss(rss-en)` が1件（1件だけの item でも配列になる）。source が `媒体名`、pubDate が ISO 形式
  - `parseRss('<<<')` が `[]`
  - `fetchNews`：同じ key の ja と en の結果が連結されること。1つめの検索が 503 を2回返して3回目に成功するとき、sleep が 2000・4000 と intervalMs で呼ばれること。ずっと 429 なら failed に入り、ほかの key は取れていること
- [ ] **Step 3: `npx vitest run tests/collector/news.test.js` で FAIL を確認する**
- [ ] **Step 4: 実装する**
- [ ] **Step 5: PASS を確認する**
- [ ] **Step 6: 手動で確認する** 実際に「円相場」で検索して、見出しが数件以上取れること（ネットワークに出られなければ飛ばして報告する）
- [ ] **Step 7: コミット** `feat(collector): Google ニュース RSS の取得`

---

### Task 8: 的中率

**Files:**
- Create: `src/collector/accuracy.js`
- Test: `tests/collector/accuracy.test.js`

**Interfaces:**
- Consumes: `History`（Task 6）、`Horizon`（Task 3）
- Produces:
  - `type HistoryEntry = { date: string, assets: { symbol, asOf: string, last: number, vol20: number|null, prediction: Record<'1d'|'1w'|'1m', Horizon> }[] }`
  - `evaluate(entries: HistoryEntry[], histories: Record<symbol, History>) -> Evaluation[]`
    `Evaluation = { date, symbol, horizon, direction, expectedPct, rangePct, actualPct, hit: boolean, inRange: boolean }`
    asOf が histories[symbol].dates の何番目かを探し、その days 個あとの終値で actualPct = (実際/last − 1)·100。まだその日がなければ評価しない。的中：up → actualPct > 0、down → actualPct < 0、flat → |actualPct| ≤ (vol20 ?? 0.02)·√days·100·0.25
    同じ date の entries が複数あれば、後ろのものだけを使う（Review Focus 5）
  - `summarize(evals: Evaluation[], now: string) -> Accuracy`
    `Accuracy = { updatedAt, byHorizon: Record<h, Stat>, bySymbol: Record<symbol, Record<h, Stat>>, recent: Evaluation[] }`、`Stat = { n, hits, hitRate: number|null, inRangeRate: number|null }`。byHorizon には3つの期間すべてを入れる（n=0 でも）。recent は date の新しい順に最大100件

- [ ] **Step 1: 失敗するテストを書く**
  - 日米で日付の並びが違う2銘柄（JP は 11/3 が休み）で、`"1d"` がそれぞれ自分の次の取引日の終値で評価されること（Review Focus 2）
  - up で +1% → hit、down で +1% → 外れ、flat（vol20 0.02・1d）で +0.4% → hit、+0.6% → 外れ
  - 21営業日後がまだない `"1m"` は評価されないこと
  - 同じ date の entry が2つあっても1件しか数えないこと
  - `summarize`：n=0 の期間の hitRate が null、recent が新しい順
- [ ] **Step 2: `npx vitest run tests/collector/accuracy.test.js` で FAIL を確認する**
- [ ] **Step 3: 実装する**
- [ ] **Step 4: PASS を確認する**
- [ ] **Step 5: コミット** `feat(collector): 的中率の照合と集計`

---

### Task 9: 毎日の処理の組み立て

**Files:**
- Create: `src/core/pipeline.js`, `src/collector/run.js`, `tests/fixtures/histories.js`（擬似の History を作る関数）
- Test: `tests/core/pipeline.test.js`, `tests/collector/run.test.js`

**Interfaces:**
- Consumes: Task 2〜8
- Produces:
  - `Latest`（`data/latest.json` の形。サイトはこの形を読む）

```
{ generatedAt: ISO, date: 'YYYY-MM-DD', newsAvailable: boolean, failedQueries: string[],
  topics: [{ id, name, short: Agg, medium: Agg, headlines: Scored[] /* score が null でないもの、|score| の大きい順に最大10件 */ }],
  indicators: [{ symbol, name, last, changePct, stale }],
  assets: [{ symbol, name, market, kind: 'index'|'stock', note?, stale, asOf, last, changePct,
             history: { dates, closes } /* 末尾260件 */, features, techScores,
             news: { short: number|null, medium: number|null, headlines: Scored[] /* 銘柄のみ、上と同じ選び方 */ },
             prediction: { '1d': Horizon, '1w': Horizon, '1m': Horizon } }] }
```

  - `src/core/pipeline.js`:
    - `buildAsset(def: {symbol, name, market, note?}, kind, history: History) -> Asset`（news と prediction はまだ入れない。changePct は直近2つの終値から）
    - `newsQueries(newsCfg, stocks) -> { key, q, lang }[]` … テーマは key `topic:<id>`、銘柄は key `stock:<symbol>`（stockQueries の `{name}` を銘柄名に置き換える）
    - `analyzeNews(results: Record<key, Headline[]>, { now, newsCfg, lexicon, stocks }) -> NewsAnalysis`
      `NewsAnalysis = { newsAvailable, topics: Latest['topics'], markets: { JP: {short, medium}, US: {short, medium} }, stocks: Record<symbol, { short: Agg, medium: Agg, headlines: Scored[] }> }`
      各 key の見出しを dedupe → scoreAll（テーマは topic.lexicon を topicLexicon に）→ summarizeTopic。newsAvailable は score が null でない見出しが1件でもあれば true
    - `finalizeAssets(assets, analysis, weights, newsCfg) -> Asset[]` … 指数の news は `analysis.markets[market]`、銘柄は `stockNews(...)`。newsAvailable が false なら news は null として predict
  - `src/collector/run.js`:
    - `runDaily({ now: Date, yf, fetch, sleep, store: { read(path) -> obj|null, write(path, obj), list(dir) -> string[] }, config: { watchlist, weights, news, lexicon } }) -> Promise<Latest>`（path は `data/` からの相対）
      1. 指数・銘柄・指標を fetchAll（period1 は now の400日前）
      2. 指数と銘柄が1つも取れなければ例外を投げる（何も書かない）
      3. 取れなかったものは前回の `latest.json` の同じ symbol を使い `stale: true`。前回にもなければ外す
      4. `newsQueries` → `fetchNews` → `analyzeNews` → `finalizeAssets`
      5. `latest.json` と `history/<date>.json`（HistoryEntry の形。上書き）を書く
      6. `history/` を全部読み、`evaluate` → `summarize` → `accuracy.json`
    - ファイルが直接実行されたときだけ、実際の fs（`data/` 以下）・`defaultYf()`・グローバルの `fetch`・`setTimeout` の sleep・`config/*.json` で runDaily を呼ぶ
    - date は now を JST に直した `YYYY-MM-DD`

- [ ] **Step 1: 失敗するテストを書く（pipeline）**
  - `newsQueries`：テーマ9つ × 2 ＋ IONQ × 2 ＝ 20件。IONQ の q が `IonQ 株` と `IonQ stock`
  - `analyzeNews` → `finalizeAssets`：IONQ に「上方修正」の見出しがあると、IONQ の news.short が正で、prediction['1d'].contributions に `news` が入ること。見出しが全部中立なら newsAvailable が false で、contributions に `news` が入らないこと
- [ ] **Step 2: 失敗するテストを書く（run）**（store はメモリ上の Map、fetch は fixtures の XML を返す擬似関数）
  - 1銘柄の株価が失敗：前回の latest にあればその値で `stale: true`、ほかは false
  - 株価が全部失敗：例外になり、store.write が呼ばれないこと
  - fetch が全部 503：`newsAvailable: false` で、latest・history・accuracy の3つが書かれること。failedQueries が20件
  - 同じ now で2回実行：`history/` のファイルが1つのままで、accuracy の n が増えないこと（Review Focus 5）
- [ ] **Step 3: `npx vitest run tests/core/pipeline.test.js tests/collector/run.test.js` で FAIL を確認する**
- [ ] **Step 4: 実装する**
- [ ] **Step 5: PASS を確認する。続けて `npm test` で全体が PASS することを確認する**
- [ ] **Step 6: 手動で確認する** `npm run collect` で `data/latest.json` ができること（ネットワークに出られなければ飛ばして報告する）。ここで作った data/ はコミットしない
- [ ] **Step 7: コミット** `feat: 毎日の処理の組み立て`

---

### Task 10: サイトの表示

**Files:**
- Create: `site/index.html`, `site/style.css`, `site/app.js`, `scripts/build-site.js`, `scripts/make-fixture-data.js`, `tests/fixtures/site-data/latest.json`, `tests/fixtures/site-data/accuracy.json`, `tests/e2e/server.js`, `tests/e2e/site.test.js`, `playwright.config.js`

**Interfaces:**
- Consumes: `Latest`・`Accuracy` の JSON（Task 8・9）
- Produces:
  - `scripts/build-site.js [dataDir]` … `_site/` を作り直し、`site/*` → `_site/`、`<dataDir>`（既定 `data`）→ `_site/data/` をコピー
  - `tests/e2e/server.js` … Node 標準の `http` で `_site/` を配信する。Playwright の `webServer` から起動する
  - Playwright 用の `data-testid`：`updated-at`, `reanalyze`, `world-card`, `indicator`, `asset-row`（`data-symbol` 属性つき）, `asset-detail`, `accuracy`, `notice`, `error`, `disclaimer`

**画面の要件**（設計書 4 章）:
- `reanalyze` は `<a>` で、`https://github.com/tennis226243-coder/test/actions/workflows/daily.yml` を新しいタブで開く。横に「実行後2〜3分で更新されます。終わったらこのページを再読み込みしてください」
- 表の各期間セル：▲（up）・▼（down）・▶（flat）と expectedPct を小数1桁の `%` で表示（正の値には `+` を付ける）。up は緑、down は赤
- `stale` の行には「⚠️データが古い」。`newsAvailable: false` なら `notice` に「ニュースの分析なし」。`note` がある行（1306.T）にはその文言を表示する
- 行をクリックすると詳細を開く：Chart.js の折れ線（終値・SMA25・SMA75・ボリンジャーの上下。系列は history.closes から app.js で計算する）。最後の点から21営業日先までの `1m` の予測の幅を帯で出す。contributions を |weight × score| の大きい順に横棒で表示する。銘柄なら news.headlines を、当てはまった単語を `<mark>` で強調して一覧にする
- 世界動向のカード：topics ごとに medium.score で色を変える（≥0.15 緑、≤−0.15 赤、それ以外は灰色。null は「データなし」）。見出しは上位3件をリンクで出す
- 的中率：byHorizon の hitRate を%で出す。n が0なら「まだデータがありません」
- JSON が読めないときは `error` に「データを読み込めませんでした」と再読み込みボタン
- 色は `:root` の CSS 変数で定義し、`prefers-color-scheme: dark` で切り替える。幅375px で横にはみ出さない
- Chart.js は `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js` から読む
- 見出しなど外部から来た文字列は `textContent` で入れる（`innerHTML` に直接入れない）。リンクは `http:`/`https:` で始まるものだけを出す

- [ ] **Step 1: テスト用の JSON を作る** `scripts/make-fixture-data.js` で Task 9 の `runDaily` を擬似データ（IONQ だけ株価取得に失敗し前回の値あり、ニュースは fixtures の XML）で実行して `tests/fixtures/site-data/` に書き出し、その出力をコミットする
- [ ] **Step 2: 失敗する e2e テストを書く**（`npm run build:site tests/fixtures/site-data` の後に実行する）
  - 表に指数5つと IONQ の計6行が出ること
  - IONQ の行に「⚠️データが古い」、1306.T の行に「ETF の価格」が出ること
  - 行をクリックすると `asset-detail` が表示され、canvas があること
  - `disclaimer` の文言が Global Constraints の免責表示と一致すること
  - `reanalyze` の href が Actions の URL で、`target="_blank"` であること
  - accuracy.json がすべて n=0 のとき「まだデータがありません」が出ること
  - `page.route` で latest.json を 404 にすると `error` が出ること
  - 見出しに `<img src=x onerror=alert(1)>` を含む latest.json を route で返しても、img 要素が作られないこと
  - 幅375px で `document.documentElement.scrollWidth <= 375`
- [ ] **Step 3: `npm run test:e2e` で FAIL を確認する**
- [ ] **Step 4: 画面を実装する**
- [ ] **Step 5: PASS を確認する。スクリーンショット（明るい表示・ダークモード・幅375px）を撮って目で確かめる**
- [ ] **Step 6: コミット** `feat(site): 予測の表示画面`

---

### Task 11: 自動実行と公開

**Files:**
- Create: `.github/workflows/daily.yml`, `README.md`

**`daily.yml` の要件:**
- name は `daily`（Task 10 のリンク先 `daily.yml` と一致させる）
- トリガー：`schedule: cron '0 22 * * 1-5'`（UTC。日本時間の火〜土 7:00）、`workflow_dispatch`、`push`（branches: main、paths: `site/**`, `config/**`）
- `permissions: { contents: write, pages: write, id-token: write }`、`concurrency: { group: daily, cancel-in-progress: false }`
- job `collect`（`if: github.event_name != 'push'`）：checkout → setup-node（22, cache npm）→ `npm ci` → `npm test` → `npm run collect` → data/ に変更があれば `github-actions[bot]` として commit・push
- job `deploy`（`needs: collect`、`if: always() && needs.collect.result != 'failure'`）：checkout（ref: main）→ `npm run build:site` → `actions/upload-pages-artifact`（path `_site`）→ `actions/deploy-pages`。environment は `github-pages`
- アクションのメジャーバージョン（`actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`）は、実装時に最新のメジャーを確認して合わせる

**README.md**（日本語）：何をするサイトか、免責、初期設定（Settings → Pages の Source を「GitHub Actions」にし、main にマージして Actions タブから daily を手動で実行）、銘柄の追加方法（`config/watchlist.json` の stocks に `{symbol, name, market}` を足す。東証の銘柄は `7203.T` のように `.T` を付ける）、検索語と辞書の調整方法（`config/news.json`・`config/lexicon.json`）、重みの調整方法、ローカルでの実行（`npm ci && npm test && npm run collect && npm run build:site`）

- [ ] **Step 1: `daily.yml` と README を書く**
- [ ] **Step 2: YAML として読めることを確認する** `python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" .github/workflows/daily.yml` がエラーなく終わること
- [ ] **Step 3: `npm test` と `npm run test:e2e` が両方 PASS することを確認する**
- [ ] **Step 4: コミット** `ci: 毎日の自動実行と GitHub Pages への公開`
