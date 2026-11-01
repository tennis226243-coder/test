// e2e テスト用の JSON を作る（IONQ は株価取得に失敗し、前回の値で stale になる）
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { runDaily, fileStore } from '../src/collector/run.js';
import { makeHistory, fakeYf } from '../tests/fixtures/histories.js';

const root = resolve(import.meta.dirname, '..');
const cfg = (n) => JSON.parse(readFileSync(resolve(root, 'config', n), 'utf8'));
const config = { watchlist: cfg('watchlist.json'), weights: cfg('weights.json'), news: cfg('news.json'), lexicon: cfg('lexicon.json') };
const ja = readFileSync(resolve(root, 'tests/fixtures/rss-ja.xml'), 'utf8');
const en = readFileSync(resolve(root, 'tests/fixtures/rss-en.xml'), 'utf8');
const fetch = async (url) => ({ ok: true, status: 200, text: async () => (url.includes('ceid=JP') ? ja : en) });
const symbols = [...config.watchlist.indices, ...config.watchlist.indicators, ...config.watchlist.stocks].map((x) => x.symbol);
const histories = Object.fromEntries(symbols.map((s, i) => [s, makeHistory(s, 300, { base: 100 + i * 50 })]));
const out = resolve(root, 'tests/fixtures/site-data');
rmSync(out, { recursive: true, force: true });
const store = fileStore(out);
const now = new Date('2026-11-01T22:00:00Z');
const sleep = async () => {};
await runDaily({ now, yf: fakeYf(histories), fetch, sleep, store, config });
await runDaily({ now, yf: fakeYf(histories, ['IONQ']), fetch, sleep, store, config });
console.log('wrote', out);
