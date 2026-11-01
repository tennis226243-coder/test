// 見出し → 点数（単語辞書。設計書 3.2）

export function stripSource(title) {
  const t = String(title ?? '');
  const i = t.lastIndexOf(' - ');
  return (i === -1 ? t : t.slice(0, i)).trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termRegex(term, lang) {
  return lang === 'en'
    ? new RegExp(`(?<![A-Za-z])${escapeRe(term)}(?![A-Za-z])`, 'gi')
    : new RegExp(escapeRe(term), 'g');
}

export function scoreHeadline(title, lang, lexicon, topicLexicon) {
  let text = stripSource(title);
  const dict = { ...(lexicon[lang] ?? {}), ...(topicLexicon?.[lang] ?? {}) };
  const terms = Object.keys(dict).sort((a, b) => b.length - a.length);

  const matched = [];
  let sum = 0;
  for (const term of terms) {
    const re = termRegex(term, lang);
    if (re.test(text)) {
      matched.push(term);
      sum += dict[term];
      text = text.replace(termRegex(term, lang), (m) => ' '.repeat(m.length));
    }
  }
  if (!matched.length) return { score: null, matched: [] };

  let score = Math.tanh(sum);
  const original = stripSource(title);
  const negated = (lexicon.negators?.[lang] ?? []).some((n) => termRegex(n, lang).test(original));
  if (negated) score *= -0.5;
  return { score, matched };
}
