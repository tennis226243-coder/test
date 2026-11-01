# 株価予想アプリ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日米の指数と登録銘柄について、テクニカル指標と Gemini（Google 検索付き）の世界動向分析を組み合わせ、翌日・1週間・1か月の予測を表示する静的 HTML サイトを作る。

**Architecture:** 毎日 GitHub Actions が Yahoo Finance の株価と Gemini の分析から `data/*.json` を作り、GitHub Pages が `site/` と `data/` を配信する。予測の中身（`src/core/`）は依存なしの ES Modules で、Node（自動処理）とブラウザ（再分析ボタン）の両方から同じコードを使う。

**Tech Stack:** Node.js 22, ES Modules, vitest, yahoo-finance2, @google/genai, Chart.js 4.4.1（CDN）, Playwright（環境に導入済みのものを使う）, GitHub Actions / Pages

**Spec:** `docs/superpowers/specs/2026-11-01-stock-predictor-design.md`

## Global Constraints

- `src/core/` は外部パッケージにも Node 専用 API（`fs`, `process` など）にも依存しない。import は相対パスと拡張子 `.js` 付きで書く（ブラウザでそのまま動かすため）。
- 価格の配列はすべて古い順→新しい順の `number[]`。
- 点数はすべて −1〜+1、confidence は 0〜1 に打ち切る。
- 期間のキーは `"1d"`（1営業日）・`"1w"`（5営業日）・`"1m"`（21営業日）。
- 方向は `"up" | "flat" | "down"`、確信度は `"high" | "mid" | "low"`。
- 画面の文言は日本語。フッターの免責表示は「投資助言ではありません。投資の判断はご自身の責任で行ってください。」と一字一句そのまま。
- 日付は JST の `YYYY-MM-DD`。
- テストでは実際の Yahoo / Gemini を呼ばない（依存は引数で注入する）。
- localStorage の読み書きは必ず try/catch で囲む。キー名は `geminiApiKey`。
- リポジトリは public。API キーをコミットしない。

## Review Focus

1. **上場して間もない銘柄（終値が30日分しかない）**：SMA200・SMA75・回帰の傾きは null になり、残った指標で重みが按分し直され、予測は出る → Task 2・3 のテスト
2. **Yahoo の終値に null が混じる・日米で休場日が違う**：null の日は捨てる。的中率の照合は、銘柄ごとの日付の並びで「h 営業日後」を数える → Task 5・7 のテスト
3. **Gemini の応答が JSON の前後に文章やコードフェンスを含む、または `ticker:ionq` のように小文字で返る**：JSON を抜き出し、target の銘柄記号を大文字に正規化する → Task 4 のテスト
4. **localStorage が使えないブラウザ（プライベートモードなど）**：設定画面も再分析ボタンも例外で止まらず、「API キーが設定されていません」と表示する → Task 10 のテスト
5. **同じ日に自動処理が2回動く**：`history/当日.json` は上書きになり、的中率は二重に数えない → Task 7・8 のテスト

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `package.json` | `"type": "module"`、scripts: `test`（vitest run）, `test:e2e`, `collect`（node src/collector/run.js）, `build:site` |
| `config/watchlist.json` | 指数・世界の指標・登録銘柄 |
| `config/weights.json` | 期間ごとの重みなど |
| `config/gemini.json` | `{"model": "gemini-2.5-flash"}` |
| `src/core/indicators.js` | 指標の計算 |
| `src/core/scoring.js` | 指標 → 点数 |
| `src/core/predict.js` | 点数 → 期間ごとの予測 |
| `src/core/newsSchema.js` | Gemini の応答の検査・集計・出典の抽出 |
| `src/core/prompts.js` | Gemini への指示文 |
| `src/core/analyze.js` | Gemini 呼び出しの手順（再試行つき）。`generate` 関数を注入する |
| `src/core/pipeline.js` | 銘柄データの組み立てと、ニュースの反映・予測のやり直し |
| `src/collector/prices.js` | Yahoo Finance から取得 |
| `src/collector/gemini.js` | Node 用の `generate` |
| `src/collector/accuracy.js` | 的中率 |
| `src/collector/run.js` | 毎日の処理 |
| `scripts/build-site.js` | `_site/` に `site/*`・`data/`・`src/core/`（→ `_site/core/`）・`config/`（→ `_site/config/`）をコピー |
| `site/index.html`, `site/style.css`, `site/app.js`, `site/gemini-browser.js` | 画面 |
| `tests/core/*.test.js`, `tests/collector/*.test.js`, `tests/e2e/site.test.js`, `tests/fixtures/` | テスト |
| `.github/workflows/daily.yml` | 自動実行と Pages の公開 |

---

### Task 1: プロジェクトの準備と指標の計算

**Files:**
- Create: `package.json`, `.gitignore`（`node_modules/`, `_site/`）, `vitest.config.js`（`include: ['tests/core/**', 'tests/collector/**']`）, `src/core/indicators.js`
- Test: `tests/core/indicators.test.js`

**Interfaces:**
- Produces（すべて `values: number[]` を受け取り、データ不足なら `null` を返す）:
  - `sma(values, n) -> number|null` … 末尾 n 個の平均
  - `smaSeries(values, n) -> (number|null)[]` … 同じ長さ、先頭 n−1 個は null
  - `emaSeries(values, n) -> (number|null)[]` … 先頭 n−1 個は null、n−1 番目は最初の n 個の SMA、以降 α = 2/(n+1)
  - `rsi(values, n = 14) -> number|null` … Wilder の平滑化。必要な長さは n+1 個。上昇・下落とも0なら 50、下落だけ0なら 100
  - `macd(values, fast = 12, slow = 26, signal = 9) -> {macd, signal, hist}|null` … macd 系列 = EMA12 − EMA26、signal = その EMA9。必要な長さは slow+signal−1
  - `bollinger(values, n = 20, k = 2) -> {mid, upper, lower, percentB}|null` … 母標準偏差。幅が0のとき percentB = 0.5
  - `regressionSlope(values, n = 60) -> number|null` … 末尾 n 個の ln(価格) を 0..n−1 に最小二乗で当てはめた傾き（1日あたりの対数収益率）
  - `volatility(values, n = 20) -> number|null` … 末尾 n 個の日次対数収益率（n+1 個の価格が必要）の標本標準偏差

- [ ] **Step 1: `npm init` 相当の `package.json` を作り、`npm i -D vitest` を実行する**

- [ ] **Step 2: 失敗するテストを書く**

```js
import { sma, smaSeries, emaSeries, rsi, macd, bollinger, regressionSlope, volatility } from '../../src/core/indicators.js';
const r = (n) => Array.from({ length: n }, (_, i) => i + 1); // [1..n]
const flat = (n, v = 100) => Array(n).fill(v);
const grow = (n, g = 0.01) => Array.from({ length: n }, (_, i) => 100 * Math.exp(g * i));

test('sma', () => { expect(sma(r(10), 5)).toBe(8); expect(sma(r(3), 5)).toBeNull(); });
test('smaSeries', () => { expect(smaSeries(r(4), 3)).toEqual([null, null, 2, 3]); });
test('emaSeries', () => { expect(emaSeries(r(5), 3)).toEqual([null, null, 2, 3, 4]); });
test('rsi', () => {
  expect(rsi(r(15))).toBe(100);
  expect(rsi(r(15).reverse())).toBe(0);
  expect(rsi(flat(15))).toBe(50);
  expect(rsi(r(14))).toBeNull();
});
test('macd', () => {
  expect(macd(flat(34))).toEqual({ macd: 0, signal: 0, hist: 0 });
  expect(macd(grow(60)).macd).toBeGreaterThan(0);
  expect(macd(flat(33))).toBeNull();
});
test('bollinger', () => {
  expect(bollinger(flat(20)).percentB).toBe(0.5);
  const b = bollinger([...flat(19), 120]);
  expect(b.percentB).toBeGreaterThan(1);
  expect(bollinger(flat(19))).toBeNull();
});
test('regressionSlope', () => { expect(regressionSlope(grow(60))).toBeCloseTo(0.01, 10); });
test('volatility', () => {
  expect(volatility(grow(21))).toBeCloseTo(0, 12);
  expect(volatility(flat(20))).toBeNull();
  expect(volatility([100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100])).toBeCloseTo(0.09779, 4);
});
```

- [ ] **Step 3: `npx vitest run tests/core/indicators.test.js` を実行し、import できずに FAIL することを確認する**
- [ ] **Step 4: 上の Interfaces どおりに `src/core/indicators.js` を実装する**
- [ ] **Step 5: 同じコマンドで PASS することを確認する**
- [ ] **Step 6: コミット** `git add -A && git commit -m "feat(core): テクニカル指標の計算"`

---

### Task 2: 指標を点数にする

**Files:**
- Create: `src/core/scoring.js`
- Test: `tests/core/scoring.test.js`

**Interfaces:**
- Consumes: Task 1 の関数すべて
- Produces:
  - `computeFeatures(closes: number[]) -> Features`
    `Features = { last, sma5, sma25, sma50, sma75, sma200, rsi14, macd: {macd,signal,hist}|null, bb: {mid,upper,lower,percentB}|null, slope60, vol20 }`（足りないものは null）
  - `scoreTechnicals(f: Features) -> TechScores`
    `TechScores = { maShort, maLong, ma75, rsi, macd, bollinger, slope }`（各 number または null）

**変換式**（v = max(vol20 ?? 0.02, 1e-6)。入力に null があればその点数は null）:

| キー | 式 |
|---|---|
| maShort | tanh(((sma5 − sma25) / sma25) / (2·v)) |
| maLong | tanh(((sma50 − sma200) / sma200) / (5·v)) |
| ma75 | tanh(((last − sma75) / sma75) / (3·v)) |
| rsi | (50 − rsi14) / 50 |
| macd | tanh(((macd − signal) / last) / (0.5·v)) |
| bollinger | clamp(1 − 2·percentB, −1, 1) |
| slope | tanh(slope60 · √60 / v) |

- [ ] **Step 1: 失敗するテストを書く**

```js
import { computeFeatures, scoreTechnicals } from '../../src/core/scoring.js';
const grow = (n, g) => Array.from({ length: n }, (_, i) => 100 * Math.exp(g * i));
const wave = (n) => Array.from({ length: n }, (_, i) => 100 + 5 * Math.sin(i / 3) + i * 0.05);

test('値はすべて -1..1 か null', () => {
  const s = scoreTechnicals(computeFeatures(wave(260)));
  for (const v of Object.values(s)) expect(v === null || (v >= -1 && v <= 1)).toBe(true);
  expect(Object.values(s).every((v) => v !== null)).toBe(true);
});
test('上昇トレンドでは流れ系の点数が正', () => {
  const s = scoreTechnicals(computeFeatures(grow(260, 0.003).map((p, i) => p * (1 + 0.01 * Math.sin(i)))));
  expect(s.maShort).toBeGreaterThan(0); expect(s.maLong).toBeGreaterThan(0); expect(s.slope).toBeGreaterThan(0);
});
test('rsi と bollinger の式', () => {
  expect(scoreTechnicals({ ...computeFeatures(wave(260)), rsi14: 25 }).rsi).toBe(0.5);
  expect(scoreTechnicals({ ...computeFeatures(wave(260)), bb: { percentB: 1.5 } }).bollinger).toBe(-1);
});
test('上場30日の銘柄（Review Focus 1）', () => {
  const s = scoreTechnicals(computeFeatures(wave(30)));
  expect(s.maLong).toBeNull(); expect(s.ma75).toBeNull(); expect(s.slope).toBeNull();
  expect(s.maShort).not.toBeNull(); expect(s.rsi).not.toBeNull();
});
```

- [ ] **Step 2: `npx vitest run tests/core/scoring.test.js` で FAIL を確認する**
- [ ] **Step 3: `src/core/scoring.js` を実装する**
- [ ] **Step 4: PASS を確認する**
- [ ] **Step 5: コミット** `feat(core): 指標の点数化`

---

### Task 3: 期間ごとの予測

**Files:**
- Create: `config/weights.json`, `src/core/predict.js`
- Test: `tests/core/predict.test.js`

**`config/weights.json`**（設計書 3.3・3.4 の値）:

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
    - `contributions` の key は techWeights のキー、またはニュースの `"news"`。weight はその期間の合計点に対する実効の重み（合計1）

**計算手順**（1つの期間について）:
1. 計算式：techWeights のうち点数が null でないものだけで重みを足して1になるように按分し、加重平均 T を出す。全部 null なら計算式なし
2. ニュース：newsMix の中で値が null でないものだけで按分した加重平均 N。全部 null（または news が null）ならニュースなし
3. 片方しかなければ、その片方の重みを1にする。両方なければ score = 0、contributions = []
4. S = tech·T + news·N（按分後）。四捨五入はしない
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
  expect(p['1d'].score).toBeCloseTo(-0.1); // 0.5×0.4 + 0.5×(-0.6)
  expect(p['1d'].direction).toBe('flat'); expect(p['1d'].confidence).toBe('mid'); // 同じ符号はニュースの0.5だけ
});
```

- [ ] **Step 2: FAIL を確認する** `npx vitest run tests/core/predict.test.js`
- [ ] **Step 3: `src/core/predict.js` を実装する**
- [ ] **Step 4: PASS を確認する**
- [ ] **Step 5: コミット** `feat(core): 期間ごとの予測`

---

### Task 4: Gemini の応答の検査・集計と指示文

**Files:**
- Create: `src/core/newsSchema.js`, `src/core/prompts.js`
- Test: `tests/core/newsSchema.test.js`, `tests/core/prompts.test.js`

**Interfaces:**
- Produces:
  - `type NewsItem = { target: string, score: number, confidence: number, horizon: 'short'|'medium', summary: string, reason: string }`
  - `parseNewsResponse(text: string) -> NewsItem[]` … 最初の `{` から最後の `}` までを JSON として読む。`items` 配列の各要素を検査する。target は `/^(region|market|ticker):[A-Za-z0-9_.^=-]+$/i` に合うもの。`ticker:` の後ろと `market:` の後ろは大文字にし、`region:` の後ろは小文字にする。score は −1..1、confidence は 0..1 に打ち切る。horizon がそれ以外の値なら捨てる。summary・reason は文字列で、空なら捨てる。読めなければ `[]`
  - `aggregateNews(items: NewsItem[], { target: string, market?: string }) -> { short: number|null, medium: number|null }` … horizon ごとに Σ(score·confidence·w)/Σ(confidence·w)。w は target に一致すれば 1、market（`market:JP` など）に一致すれば 0.5。該当がなく分母が0なら null
  - `extractSources(groundingMetadata) -> {title: string, uri: string}[]` … `groundingChunks[].web` から取り出し、uri の重複を除く。入力が undefined なら `[]`
  - `REGIONS = ['us', 'japan', 'europe', 'china', 'middle_east', 'emerging', 'monetary_policy', 'fx', 'commodities']`
  - `worldPrompt(date: string) -> string`
  - `marketPrompt(date: string, worldItems: NewsItem[]) -> string` … target は `market:JP` と `market:US` だけ。short と medium の両方を出させる
  - `tickerPrompt(date: string, stock: {symbol, name, market}) -> string` … target は `ticker:<symbol>`

指示文の共通の要件：日本語で答えること、Google 検索で直近（date から過去7日以内）の情報を調べること、出力は次の形の JSON だけにすること、score は株価への影響（−1 強い下落要因〜+1 強い上昇要因）であること。

```
{"items":[{"target":"region:middle_east","score":-0.5,"confidence":0.7,"horizon":"short","summary":"…","reason":"…"}]}
```

- [ ] **Step 1: 失敗するテストを書く**

```js
import { parseNewsResponse, aggregateNews, extractSources } from '../../src/core/newsSchema.js';
const item = (o) => ({ target: 'market:JP', score: 0.5, confidence: 1, horizon: 'short', summary: 's', reason: 'r', ...o });

test('前後の文章とコードフェンスを除く（Review Focus 3）', () => {
  const t = 'はい。\n```json\n' + JSON.stringify({ items: [item({ target: 'ticker:ionq' })] }) + '\n```\n以上';
  expect(parseNewsResponse(t)[0].target).toBe('ticker:IONQ');
});
test('不正な要素は捨て、範囲外は打ち切る', () => {
  const t = JSON.stringify({ items: [item({ score: 3, confidence: -1 }), item({ horizon: 'long' }), item({ target: 'foo' }), item({ summary: '' }), { score: 1 }] });
  expect(parseNewsResponse(t)).toEqual([item({ score: 1, confidence: 0 })]);
});
test('JSON でなければ空配列', () => { expect(parseNewsResponse('申し訳ありません')).toEqual([]); });
test('集計：銘柄は重み1、市場は0.5', () => {
  const items = [item({ target: 'ticker:IONQ', score: 1 }), item({ target: 'market:US', score: -1 }), item({ target: 'market:JP', score: 1 })];
  expect(aggregateNews(items, { target: 'ticker:IONQ', market: 'market:US' }).short).toBeCloseTo(1 / 3);
  expect(aggregateNews(items, { target: 'market:JP' })).toEqual({ short: 1, medium: null });
});
test('出典', () => {
  const g = { groundingChunks: [{ web: { uri: 'https://a', title: 'A' } }, { web: { uri: 'https://a', title: 'A' } }] };
  expect(extractSources(g)).toEqual([{ title: 'A', uri: 'https://a' }]); expect(extractSources(undefined)).toEqual([]);
});
```

`tests/core/prompts.test.js`: `worldPrompt('2026-11-02')` に `REGIONS` のすべての文字列と `"items"` と日付が含まれること、`tickerPrompt('2026-11-02', {symbol:'IONQ', name:'IonQ', market:'US'})` に `ticker:IONQ` が含まれること、`marketPrompt` に渡した worldItems の summary が含まれること。

- [ ] **Step 2: FAIL を確認する** `npx vitest run tests/core/newsSchema.test.js tests/core/prompts.test.js`
- [ ] **Step 3: 2つのファイルを実装する**
- [ ] **Step 4: PASS を確認する**
- [ ] **Step 5: コミット** `feat(core): Gemini の応答の検査と指示文`

---

### Task 5: 株価の取得と銘柄の設定

**Files:**
- Create: `config/watchlist.json`, `config/gemini.json`, `src/collector/prices.js`
- Test: `tests/collector/prices.test.js`

**`config/watchlist.json`:**

```json
{
  "indices": [
    { "symbol": "^N225",  "name": "日経平均", "market": "JP" },
    { "symbol": "1306.T", "name": "TOPIX（ETF 1306で代用）", "market": "JP" },
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
  - `type History = { symbol: string, dates: string[], closes: number[] }`（dates は取引所の現地日付 `YYYY-MM-DD`、null の終値の日は除く）
  - `fetchHistory(symbol: string, { yf, period1: Date }) -> Promise<History>` … `yf.chart(symbol, { period1, interval: '1d' })` の `quotes[]`（`date`, `close`）を使う
  - `fetchAll(symbols: string[], { yf, period1 }) -> Promise<{ ok: Record<string, History>, failed: string[] }>` … 1銘柄ずつ順に取得する。例外や終値0件は failed に入れる
  - `defaultYf()` … yahoo-finance2 のインスタンスを返す（インストールしたバージョンの使い方に合わせる。v3 なら `new YahooFinance()`）

- [ ] **Step 1: `npm i yahoo-finance2` を実行する**
- [ ] **Step 2: 失敗するテストを書く**（yf は `{ chart: async (s) => ... }` の擬似オブジェクト）
  - `fetchHistory`：quotes に `close: null` を含めると、その日が dates と closes の両方から消えること（Review Focus 2）。dates が `'2026-10-30'` の形式であること
  - `fetchAll`：1銘柄が例外を投げ、1銘柄が quotes 0件のとき、どちらも `failed` に入り、残りは `ok` に入ること
- [ ] **Step 3: FAIL を確認する** `npx vitest run tests/collector/prices.test.js`
- [ ] **Step 4: 実装する**
- [ ] **Step 5: PASS を確認する**
- [ ] **Step 6: 手動で確認する** `node -e "import('./src/collector/prices.js').then(async m=>{const h=await m.fetchHistory('IONQ',{yf:m.defaultYf(),period1:new Date(Date.now()-400*864e5)});console.log(h.dates.length,h.closes.at(-1))})"` で 200 以上の件数と数値が出ること（ネットワークに出られない環境では飛ばし、その旨を報告する）
- [ ] **Step 7: コミット** `feat(collector): 株価の取得と銘柄の設定`

---

### Task 6: Gemini 呼び出しの手順

**Files:**
- Create: `src/core/analyze.js`, `src/collector/gemini.js`
- Test: `tests/core/analyze.test.js`

**Interfaces:**
- Consumes: Task 4 の関数すべて
- Produces:
  - `type Generate = (prompt: string) => Promise<{ text: string, sources: {title, uri}[] }>`
  - `withRetry(fn, { retries = 3, baseMs = 1000, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) -> Promise` … 最初の1回＋最大3回やり直す。待ち時間は baseMs·2^(試行回数−1)
  - `analyzeAll(generate: Generate, { date, stocks: {symbol,name,market}[], sleep? }) -> Promise<Analysis>`
    `Analysis = { newsAvailable: boolean, world: NewsItem[], markets: NewsItem[], tickers: Record<symbol, NewsItem[]>, sources: {title, uri}[], errors: string[] }`
    手順：worldPrompt → marketPrompt（world の結果を渡す）→ 銘柄ごとに tickerPrompt。各呼び出しを withRetry で包み、失敗した呼び出しは errors に記録してその部分を空にする。`newsAvailable` は items が1件以上あれば true。sources は全呼び出しの合計（uri の重複は除く）
  - `src/collector/gemini.js`: `makeNodeGenerate(apiKey: string, model: string) -> Generate` … `@google/genai` の `ai.models.generateContent({ model, contents: prompt, config: { tools: [{ googleSearch: {} }] } })`。text は `res.text`、sources は `extractSources(res.candidates?.[0]?.groundingMetadata)`

- [ ] **Step 1: `npm i @google/genai` を実行する**
- [ ] **Step 2: 失敗するテストを書く**（generate は擬似関数、sleep は即時に解決する関数を渡す）
  - 全部成功：world・markets・tickers.IONQ にそれぞれの items が入り、newsAvailable が true、generate が 3 回呼ばれる（stocks が1件のとき）
  - world が2回失敗して3回目に成功：結果が入り、sleep が 1000・2000 で呼ばれる
  - 全部失敗し続ける：newsAvailable が false、errors が3件、例外は外に投げない
  - sources は uri の重複が除かれる
- [ ] **Step 3: FAIL を確認する** `npx vitest run tests/core/analyze.test.js`
- [ ] **Step 4: `analyze.js` と `gemini.js` を実装する**
- [ ] **Step 5: PASS を確認する**
- [ ] **Step 6: 使うモデルを確認する** Google AI Studio の資料で、無料枠で使えて、Google 検索のグラウンディングに対応しているモデル名を確かめ、`config/gemini.json` を更新する。確認できなければ `gemini-2.5-flash` のままにして、その旨を報告する
- [ ] **Step 7: コミット** `feat: Gemini による世界動向の分析手順`

---

### Task 7: 的中率

**Files:**
- Create: `src/collector/accuracy.js`
- Test: `tests/collector/accuracy.test.js`

**Interfaces:**
- Consumes: `History`（Task 5）、`Horizon`（Task 3）
- Produces:
  - `type HistoryEntry = { date: string, assets: { symbol, asOf: string, last: number, vol20: number|null, prediction: Record<'1d'|'1w'|'1m', Horizon> }[] }`
  - `evaluate(entries: HistoryEntry[], histories: Record<symbol, History>) -> Evaluation[]`
    `Evaluation = { date, symbol, horizon, direction, expectedPct, rangePct, actualPct, hit: boolean, inRange: boolean }`
    asOf が histories[symbol].dates の何番目かを探し、その days 個あとの終値で actualPct = (実際/last − 1)·100 を出す。まだその日がなければ評価しない。的中：up → actualPct > 0、down → actualPct < 0、flat → |actualPct| ≤ (vol20 ?? 0.02)·√days·100·0.25
  - `summarize(evals: Evaluation[], now: string) -> Accuracy`
    `Accuracy = { updatedAt, byHorizon: Record<h, Stat>, bySymbol: Record<symbol, Record<h, Stat>>, recent: Evaluation[] }`、`Stat = { n, hits, hitRate: number|null, inRangeRate: number|null }`。recent は date の新しい順に最大100件
- 同じ date の entries が複数渡されたら、後ろのものだけを使う（Review Focus 5）

- [ ] **Step 1: 失敗するテストを書く**
  - 日米で日付の並びが違う2銘柄（例：JP は 11/3 が休み）で、`"1d"` がそれぞれ自分の次の取引日の終値で評価されること（Review Focus 2）
  - up 予測で +1% → hit、down 予測で +1% → 外れ、flat 予測で vol20 0.02・1d・+0.4% → hit、+0.6% → 外れ
  - 21営業日後がまだない `"1m"` は評価されないこと
  - 同じ date の entry が2つあっても1件しか数えないこと
  - `summarize`：n=0 の期間の hitRate が null、recent が新しい順
- [ ] **Step 2: FAIL を確認する** `npx vitest run tests/collector/accuracy.test.js`
- [ ] **Step 3: 実装する**
- [ ] **Step 4: PASS を確認する**
- [ ] **Step 5: コミット** `feat(collector): 的中率の照合と集計`

---

### Task 8: 毎日の処理の組み立て

**Files:**
- Create: `src/core/pipeline.js`, `src/collector/run.js`
- Test: `tests/core/pipeline.test.js`, `tests/collector/run.test.js`, `tests/fixtures/`（擬似の History を作る関数を `tests/fixtures/histories.js` に置く）

**Interfaces:**
- Consumes: Task 2・3・4・5・6・7
- Produces:
  - `Latest`（`data/latest.json` の形。サイトもこの形を読む）

```
{ generatedAt: ISO文字列, date: 'YYYY-MM-DD', newsAvailable: boolean, reanalyzed?: true,
  world: NewsItem[], markets: NewsItem[], sources: {title, uri}[],
  indicators: [{ symbol, name, last, changePct, stale }],
  assets: [{ symbol, name, market, kind: 'index'|'stock', stale, asOf, last, changePct,
             history: { dates, closes },        // 末尾260件
             features, techScores,
             news: { short, medium, items: NewsItem[] },
             prediction: { '1d': Horizon, '1w': Horizon, '1m': Horizon } }] }
```

  - `src/core/pipeline.js`:
    - `buildAsset(def: {symbol,name,market}, kind, history: History) -> Asset`（news は `{short:null, medium:null, items:[]}`、prediction はまだ入れない）
    - `applyAnalysis(latest: Latest, analysis: Analysis, weights) -> Latest` … 新しいオブジェクトを返す（元は変更しない）。world・markets・sources・newsAvailable を置き換え、各 asset について news を aggregateNews で求め（指数は target `market:<market>`、銘柄は target `ticker:<symbol>` と market `market:<market>`）、items には対象の items を入れ、predict をやり直す。`newsAvailable` が false なら news は null として predict する
  - `src/collector/run.js`:
    - `runDaily({ now: Date, yf, generate: Generate|null, readJson, writeJson, dataDir, config: {watchlist, weights} }) -> Promise<Latest>`
      1. 指数・銘柄・指標を fetchAll（period1 は now の400日前）
      2. 指数と銘柄が1つも取れなければ例外を投げる（何も書き込まない）
      3. 取れなかったものは前回の latest.json の同じ symbol のデータを使い、`stale: true` にする。前回にもなければ外す
      4. generate が null なら analysis は newsAvailable false の空のもの。そうでなければ analyzeAll
      5. applyAnalysis → `latest.json`、`history/<date>.json`（HistoryEntry の形、上書き）を書く
      6. `history/` を全部読み、evaluate → summarize → `accuracy.json`
    - ファイルの先頭で直接実行されたときだけ、実際の fs・defaultYf・`GEMINI_API_KEY`（無ければ generate は null で、警告を出す）を使って runDaily を呼ぶ
    - date は now を JST に直した `YYYY-MM-DD`

- [ ] **Step 1: 失敗するテストを書く（pipeline）**
  - `applyAnalysis`：IONQ の news.short が `ticker:IONQ` と `market:US` から集計され、prediction の contributions に `news` が入ること。元の latest オブジェクトが変わっていないこと
  - newsAvailable false の analysis では contributions に `news` が入らないこと
- [ ] **Step 2: 失敗するテストを書く（run）**（メモリ上のオブジェクトで readJson/writeJson を擬似化）
  - 1銘柄失敗：前回の latest にあればその値で `stale: true`、ほかは false
  - 全部失敗：例外になり、writeJson が呼ばれないこと
  - generate が null：`newsAvailable: false` で latest・history・accuracy の3つが書かれること
  - 同じ now で2回実行：`history/<date>.json` が1つのままで、accuracy の n が増えないこと（Review Focus 5）
- [ ] **Step 3: FAIL を確認する** `npx vitest run tests/core/pipeline.test.js tests/collector/run.test.js`
- [ ] **Step 4: 実装する**
- [ ] **Step 5: PASS を確認する。続けて `npm test` で全体が PASS することを確認する**
- [ ] **Step 6: 手動で確認する** `GEMINI_API_KEY= npm run collect` で `data/latest.json` ができること（ネットワークに出られなければ飛ばして報告する）。できた data/ はコミットしない
- [ ] **Step 7: コミット** `feat: 毎日の処理の組み立て`

---

### Task 9: サイトの表示

**Files:**
- Create: `site/index.html`, `site/style.css`, `site/app.js`, `scripts/build-site.js`, `tests/fixtures/site-data/latest.json`, `tests/fixtures/site-data/accuracy.json`, `tests/e2e/site.test.js`, `playwright.config.js`
- Modify: `package.json`（scripts の `build:site` = `node scripts/build-site.js`、`test:e2e` = `playwright test`）

**Interfaces:**
- Consumes: `Latest`・`Accuracy` の JSON（Task 7・8）、`_site/core/*.js`
- Produces:
  - `scripts/build-site.js [dataDir]` … `_site/` を作り直し、`site/*` → `_site/`、`<dataDir>`（既定 `data`）→ `_site/data/`、`src/core/` → `_site/core/`、`config/` → `_site/config/` をコピーする
  - `site/app.js` は ES Module。`render(latest, accuracy)` を export する（Task 10 が再分析後に呼ぶ）
  - Playwright 用の `data-testid`：`updated-at`, `reanalyze`, `settings`, `world-card`, `indicator`, `asset-row`（`data-symbol` 属性つき）, `asset-detail`, `accuracy`, `notice`（stale・ニュースなし・再分析などの注意表示）, `error`, `disclaimer`

**画面の要件**（設計書 4 章）:
- 表の各期間セル：▲（up）・▼（down）・▶（flat）と `expectedPct` を小数1桁の `%` で表示する。up は緑、down は赤
- `stale` の行には「⚠️データが古い」、`newsAvailable: false` なら上部に「ニュースの分析なし」
- 1306.T の行には「ETF の価格」と表示する
- 行をクリックすると詳細を開く：Chart.js の折れ線（終値・SMA25・SMA75・ボリンジャーの上下）。最後の点の右側に `1m` の予測の幅を帯で出す。contributions を、重み × 点数の大きい順に横棒で表示する。news.items を一覧にする
- 世界動向のカード：region ごとに score で色を変え（＋は緑、−は赤、0付近は灰色）、summary と reason を出す。sources はページ下部にリンクの一覧で出す
- 的中率：byHorizon の hitRate を%で出す。n が0なら「まだデータがありません」
- JSON が読めないときは `error` に「データを読み込めませんでした」と再読み込みボタンを出す
- 色は `:root` の CSS 変数で定義し、`prefers-color-scheme: dark` で切り替える。幅 375px でも横にはみ出さない
- Chart.js は `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js` から読む

- [ ] **Step 1: テスト用の JSON を用意する** Task 8 の `runDaily` を擬似データで実行して `tests/fixtures/site-data/` に書き出す小さなスクリプトを作り、出力をコミットする。中身には「IONQ が stale」「^N225 は ETF でない通常の行」を含める
- [ ] **Step 2: 失敗する e2e テストを書く**（`build:site tests/fixtures/site-data` の後、`_site` を `npx http-server` 相当の簡易サーバーで配信する。サーバーは Node 標準の `http` で `tests/e2e/server.js` に書く）
  - 表に指数5つと IONQ の計6行が出ること
  - IONQ の行に「⚠️データが古い」が出ること
  - 行をクリックすると `asset-detail` が表示され、canvas があること
  - `disclaimer` の文言が Global Constraints の免責表示と一致すること
  - accuracy.json の byHorizon がすべて n=0 のとき「まだデータがありません」が出ること
  - latest.json を 404 にすると `error` が出ること
  - 幅 375px で `document.documentElement.scrollWidth <= 375`
- [ ] **Step 3: FAIL を確認する** `npm run test:e2e`
- [ ] **Step 4: 画面を実装する**
- [ ] **Step 5: PASS を確認する。スクリーンショットを撮って（明るい表示・ダークモード・幅375px）目で確かめる**
- [ ] **Step 6: コミット** `feat(site): 予測の表示画面`

---

### Task 10: 再分析ボタンと設定

**Files:**
- Create: `site/gemini-browser.js`
- Modify: `site/app.js`, `site/index.html`
- Test: `tests/e2e/reanalyze.test.js`

**Interfaces:**
- Consumes: `analyzeAll`（Task 6）、`applyAnalysis`（Task 8）、`render`（Task 9）、`config/weights.json`・`config/gemini.json`（`_site/config/` から fetch する）
- Produces:
  - `makeBrowserGenerate(apiKey: string, model: string) -> Generate` … `fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }) })`。text は `candidates[0].content.parts[].text` をつなげたもの、sources は `extractSources(candidates[0].groundingMetadata)`。HTTP エラーは例外にする
  - 設定：`settings` を押すとダイアログで API キーを入力・保存・削除できる。保存先は localStorage の `geminiApiKey`（try/catch。使えないときは、そのページを開いている間だけメモリに保持し、「このブラウザでは保存できません」と表示する）
  - 再分析：キーがなければ `notice` に「API キーが設定されていません」。あれば、ボタンを無効にして「分析中…」と表示し、`analyzeAll` → `applyAnalysis(latest, analysis, weights)` → 結果に `reanalyzed: true` を付けて `render`。`notice` に「再分析の結果（保存されていません）」。analysis.newsAvailable が false なら表示はそのままにして、`notice` に「再分析に失敗しました：」と errors の先頭を出す

- [ ] **Step 1: 失敗する e2e テストを書く**（Playwright の `page.route` で Gemini の URL を擬似の応答に差し替える）
  - キーなしでボタンを押すと「API キーが設定されていません」
  - localStorage が例外を投げるようにしても（`addInitScript` で `Storage.prototype.getItem` と `setItem` を throw にする）、ページが表示され、ボタンを押すと同じ文言が出ること（Review Focus 4）
  - キーを保存してボタンを押すと、擬似応答の `ticker:IONQ` score 1 を反映して IONQ の `1d` の表示が変わり、「再分析の結果（保存されていません）」が出ること。リクエストに `x-goog-api-key` が付いていること
  - 擬似応答を 429 にすると「再分析に失敗しました」が出て、表は変わらないこと（このテストでは sleep を短くするため、`analyzeAll` に `sleep: () => Promise.resolve()` を渡せるよう、app.js の再分析処理は `window.__testFastRetry` が true なら即時の sleep を使う）
- [ ] **Step 2: FAIL を確認する** `npm run test:e2e`
- [ ] **Step 3: 実装する**
- [ ] **Step 4: PASS を確認する。`npm test` も PASS すること**
- [ ] **Step 5: コミット** `feat(site): ブラウザからの再分析と API キーの設定`

---

### Task 11: 自動実行と公開

**Files:**
- Create: `.github/workflows/daily.yml`, `README.md`

**`daily.yml` の要件:**
- トリガー：`schedule: cron '0 22 * * 1-5'`（UTC。日本時間の火〜土 7:00）、`workflow_dispatch`、`push`（branches: main、paths: `site/**`, `src/core/**`, `config/**`）
- `permissions: { contents: write, pages: write, id-token: write }`、`concurrency: { group: daily, cancel-in-progress: false }`
- job `collect`（push 以外のとき）：checkout → setup-node（22, cache npm）→ `npm ci` → `npm test` → `npm run collect`（env `GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}`）→ data/ に変更があれば `github-actions[bot]` として commit・push
- job `deploy`（`needs: collect`、`if: always() && needs.collect.result != 'failure'`）：checkout（ref は main。collect がコミットした最新を取るため）→ setup-node → `npm run build:site` → `actions/upload-pages-artifact`（path `_site`）→ `actions/deploy-pages`。environment は `github-pages`
- アクションはメジャーバージョンを固定して書く（`actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`）。実装時に最新のメジャーバージョンを確認して合わせる

**README.md**（日本語）：何をするサイトか、免責、初期設定の手順（下の Step 3 の3つ）、銘柄の追加方法（`config/watchlist.json` の `stocks` に `{symbol, name, market}` を足す。東証の銘柄は `7203.T` のように `.T` を付ける）、重みの調整方法、ローカルでの実行（`npm ci && npm test && GEMINI_API_KEY=... npm run collect && npm run build:site`）

- [ ] **Step 1: `daily.yml` と README を書く**
- [ ] **Step 2: YAML として読めることを確認する** `node -e "require('fs').readFileSync('.github/workflows/daily.yml','utf8')"` に加えて、`npx --yes yaml-lint .github/workflows/daily.yml`（使えなければ `python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" .github/workflows/daily.yml`）でエラーが出ないこと
- [ ] **Step 3: ユーザーの作業を README と完了報告に書く**
  1. Google AI Studio で Gemini の API キーを無料で発行する
  2. GitHub のリポジトリの Settings → Secrets and variables → Actions に `GEMINI_API_KEY` を登録する
  3. Settings → Pages の Source を「GitHub Actions」にする。そのあと main にマージし、Actions タブから「daily」を手動で実行する
- [ ] **Step 4: コミット** `ci: 毎日の自動実行と GitHub Pages への公開`
