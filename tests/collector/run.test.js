import { readFileSync } from 'node:fs';
import { runDaily } from '../../src/collector/run.js';
import { makeHistory, fakeYf } from '../fixtures/histories.js';
import watchlist from '../../config/watchlist.json' with { type: 'json' };
import weights from '../../config/weights.json' with { type: 'json' };
import news from '../../config/news.json' with { type: 'json' };
import lexicon from '../../config/lexicon.json' with { type: 'json' };

const config = { watchlist, weights, news, lexicon };
const ja = readFileSync(new URL('../fixtures/rss-ja.xml', import.meta.url), 'utf8');
const en = readFileSync(new URL('../fixtures/rss-en.xml', import.meta.url), 'utf8');
const okFetch = async (url) => ({ ok: true, status: 200, text: async () => (url.includes('ceid=JP') ? ja : en) });
const badFetch = async () => ({ ok: false, status: 503, text: async () => '' });
const sleep = async () => {};
const now = new Date('2026-11-01T22:00:00Z'); // JST 2026-11-02 07:00
const symbols = [...watchlist.indices, ...watchlist.indicators, ...watchlist.stocks].map((x) => x.symbol);
const histories = Object.fromEntries(symbols.map((s) => [s, makeHistory(s)]));

function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m, writes: 0,
    read(p) { return m.has(p) ? structuredClone(m.get(p)) : null; },
    write(p, o) { this.writes++; m.set(p, structuredClone(o)); },
    list(dir) { return [...m.keys()].filter((k) => k.startsWith(dir + '/')).map((k) => k.slice(dir.length + 1)); },
  };
}

test('正常系：3つのファイルを書き、ニュースが入る', async () => {
  const store = memStore();
  const latest = await runDaily({ now, yf: fakeYf(histories), fetch: okFetch, sleep, store, config });
  expect(latest.date).toBe('2026-11-02');
  expect(latest.assets.map((a) => a.symbol)).toEqual(['^N225', '1306.T', '^GSPC', '^IXIC', '^DJI', 'IONQ']);
  expect(latest.indicators).toHaveLength(4);
  expect(latest.newsAvailable).toBe(true);
  expect([...store.m.keys()].sort()).toEqual(['accuracy.json', 'history/2026-11-02.json', 'latest.json']);
  expect(store.read('history/2026-11-02.json').assets[0]).toHaveProperty('prediction');
});
test('1銘柄失敗：前回の値で stale', async () => {
  const store = memStore();
  await runDaily({ now, yf: fakeYf(histories), fetch: okFetch, sleep, store, config });
  const latest = await runDaily({ now, yf: fakeYf(histories, ['IONQ']), fetch: okFetch, sleep, store, config });
  expect(latest.assets.find((a) => a.symbol === 'IONQ').stale).toBe(true);
  expect(latest.assets.find((a) => a.symbol === '^N225').stale).toBe(false);
});
test('前回もない失敗銘柄は外す', async () => {
  const latest = await runDaily({ now, yf: fakeYf(histories, ['IONQ']), fetch: okFetch, sleep, store: memStore(), config });
  expect(latest.assets.map((a) => a.symbol)).not.toContain('IONQ');
});
test('株価が全部失敗なら例外で、何も書かない', async () => {
  const store = memStore();
  await expect(runDaily({ now, yf: fakeYf({}), fetch: okFetch, sleep, store, config })).rejects.toThrow();
  expect(store.writes).toBe(0);
});
test('ニュースが全部失敗：ニュースなしで書く', async () => {
  const store = memStore();
  const latest = await runDaily({ now, yf: fakeYf(histories), fetch: badFetch, sleep, store, config });
  expect(latest.newsAvailable).toBe(false);
  expect(latest.failedQueries).toHaveLength(10);
  expect(store.m.size).toBe(3);
});
test('同じ日に2回実行しても二重に数えない（Review Focus 5）', async () => {
  const past = makeHistory('x', 260, { end: '2026-10-29' }).dates.at(-1);
  const store = memStore();
  const yfOld = fakeYf(Object.fromEntries(symbols.map((s) => [s, makeHistory(s, 260, { end: '2026-10-29' })])));
  await runDaily({ now: new Date('2026-10-29T22:00:00Z'), yf: yfOld, fetch: okFetch, sleep, store, config });
  const a1 = (await runDaily({ now, yf: fakeYf(histories), fetch: okFetch, sleep, store, config }), store.read('accuracy.json'));
  await runDaily({ now, yf: fakeYf(histories), fetch: okFetch, sleep, store, config });
  const a2 = store.read('accuracy.json');
  expect(past).toBe('2026-10-29');
  expect(store.list('history').sort()).toEqual(['2026-10-30.json', '2026-11-02.json']);
  expect(a1.byHorizon['1d'].n).toBe(6);
  expect(a2.byHorizon['1d'].n).toBe(a1.byHorizon['1d'].n);
});
