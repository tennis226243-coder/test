// Yahoo Finance から日足の終値を取得する
import YahooFinance from 'yahoo-finance2';

export function defaultYf() {
  return new YahooFinance({ suppressNotices: ['yahooSurvey'] });
}

function localDate(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export async function fetchHistory(symbol, { yf, period1 }) {
  const res = await yf.chart(symbol, { period1, interval: '1d' });
  const tz = res?.meta?.exchangeTimezoneName;
  const dates = [];
  const closes = [];
  for (const row of res?.quotes ?? []) {
    if (typeof row.close !== 'number' || !Number.isFinite(row.close)) continue;
    const d = localDate(new Date(row.date), tz);
    if (dates.at(-1) === d) { closes[closes.length - 1] = row.close; continue; }
    dates.push(d);
    closes.push(row.close);
  }
  return { symbol, dates, closes };
}

export async function fetchAll(symbols, { yf, period1 }) {
  const ok = {};
  const failed = [];
  for (const s of symbols) {
    try {
      const h = await fetchHistory(s, { yf, period1 });
      if (h.closes.length) ok[s] = h;
      else failed.push(s);
    } catch (e) {
      console.warn(`[prices] ${s}: ${e.message}`);
      failed.push(s);
    }
  }
  return { ok, failed };
}
