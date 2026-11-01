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
