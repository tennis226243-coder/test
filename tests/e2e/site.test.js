import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const CHART = readFileSync(new URL('../../node_modules/chart.js/dist/chart.umd.js', import.meta.url), 'utf8');
const latest = JSON.parse(readFileSync(new URL('../fixtures/site-data/latest.json', import.meta.url), 'utf8'));
const DISCLAIMER = '投資助言ではありません。投資の判断はご自身の責任で行ってください。';

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: CHART }));
});

test('指数5つと IONQ の6行が出る', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('asset-row')).toHaveCount(6);
  await expect(page.getByTestId('indicator')).toHaveCount(4);
  await expect(page.getByTestId('world-card')).toHaveCount(9);
  await expect(page.getByTestId('updated-at')).toContainText('2026');
});
test('stale と ETF の注記', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid=asset-row][data-symbol="IONQ"]')).toContainText('⚠️データが古い');
  await expect(page.locator('[data-testid=asset-row][data-symbol="1306.T"]')).toContainText('ETF の価格');
});
test('行をクリックすると詳細とチャート', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid=asset-row][data-symbol="^N225"]').click();
  const d = page.getByTestId('asset-detail');
  await expect(d).toBeVisible();
  await expect(d.locator('canvas')).toHaveCount(1);
  await expect(d).toContainText('点数の内訳');
});
test('免責表示と再分析リンク', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('disclaimer')).toHaveText(DISCLAIMER);
  const a = page.getByTestId('reanalyze');
  await expect(a).toHaveAttribute('href', 'https://github.com/tennis226243-coder/test/actions/workflows/daily.yml');
  await expect(a).toHaveAttribute('target', '_blank');
});
test('的中率がまだないとき', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('accuracy')).toContainText('まだデータがありません');
});
test('ニュースなしの注意', async ({ page }) => {
  await page.route('**/data/latest.json', (r) => r.fulfill({ json: { ...latest, newsAvailable: false } }));
  await page.goto('/');
  await expect(page.getByTestId('notice')).toContainText('ニュースの分析なし');
});
test('latest.json が読めないとエラー', async ({ page }) => {
  await page.route('**/data/latest.json', (r) => r.fulfill({ status: 404, body: 'x' }));
  await page.goto('/');
  await expect(page.getByTestId('error')).toContainText('データを読み込めませんでした');
});
test('見出しの HTML は実行されない', async ({ page }) => {
  const evil = structuredClone(latest);
  evil.topics[0].headlines = [{ title: '<img src=x onerror=alert(1)> 上方修正', link: 'javascript:alert(1)', source: 'S', pubDate: '2026-11-01T00:00:00Z', lang: 'ja', score: 0.7, matched: ['上方修正'], ageDays: 1 }];
  await page.route('**/data/latest.json', (r) => r.fulfill({ json: evil }));
  await page.goto('/');
  await expect(page.getByTestId('world-card').first()).toContainText('<img src=x');
  await expect(page.locator('main img')).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
});
test('幅375pxで横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('asset-row')).toHaveCount(6);
  await page.locator('[data-testid=asset-row][data-symbol="^N225"]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
