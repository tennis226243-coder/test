import { readFileSync } from 'node:fs';
import { buildRssUrl, parseRss, fetchNews } from '../../src/collector/news.js';
const ja = readFileSync(new URL('../fixtures/rss-ja.xml', import.meta.url), 'utf8');
const en = readFileSync(new URL('../fixtures/rss-en.xml', import.meta.url), 'utf8');
const res = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body });

test('buildRssUrl', () => {
  const u = buildRssUrl('円相場', 'ja');
  expect(u).toContain('q=%E5%86%86%E7%9B%B8%E5%A0%B4%20when%3A7d'); expect(u).toContain('ceid=JP:ja');
  expect(buildRssUrl('IonQ stock', 'en')).toContain('hl=en-US&gl=US&ceid=US:en');
});
test('parseRss', () => {
  const a = parseRss(ja, 'ja');
  expect(a).toHaveLength(3);
  expect(a[0]).toEqual({ title: '円安が進行、1ドル155円台 - 日本経済新聞', link: 'https://news.google.com/rss/articles/AAA?oc=5', source: '日本経済新聞', pubDate: '2026-11-01T22:10:00.000Z', lang: 'ja' });
  const b = parseRss(en, 'en');
  expect(b).toHaveLength(1); expect(b[0].source).toBe('Reuters');
  expect(parseRss('<<<', 'ja')).toEqual([]);
});
test('同じ key の結果は連結し、失敗はやり直す', async () => {
  const sleeps = [];
  let n = 0;
  const fetch = async (url) => {
    if (url.includes('ceid=JP')) { n++; return n <= 2 ? res(503) : res(200, ja); }
    return res(200, en);
  };
  const r = await fetchNews([{ key: 'topic:fx', q: '円相場', lang: 'ja' }, { key: 'topic:fx', q: 'yen', lang: 'en' }], { fetch, sleep: async (ms) => sleeps.push(ms) });
  expect(r.results['topic:fx']).toHaveLength(4); expect(r.failed).toEqual([]);
  expect(sleeps).toEqual([2000, 4000, 1000]);
});
test('ずっと 429 なら failed に入り、ほかは取れる', async () => {
  const fetch = async (url) => (url.includes('ceid=JP') ? res(429) : res(200, en));
  const r = await fetchNews([{ key: 'a', q: 'x', lang: 'ja' }, { key: 'b', q: 'y', lang: 'en' }], { fetch, sleep: async () => {} });
  expect(r.failed).toEqual(['a']); expect(r.results.b).toHaveLength(1);
});
