// What the user visited before: browsing history and closed/archived tabs, searchable by the
// agent (browser_history) and summarized in every AI request so "that form" can be found.
import { S } from './state.js';
import { timeAgo } from './util.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DAY = 86400e3;

// Lowercase without diacritics, so "formulář" matches "formular".
const fold = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// One entry per URL: latest visit, visit count, and whether it came from a closed tab.
function pages({ days } = {}) {
  const since = Number.isFinite(days) && days > 0 ? Date.now() - days * DAY : 0;
  const byUrl = new Map();
  const add = (url, title, ts, closed) => {
    if (!url || !/^https?:/i.test(url) || ts < since) return;
    const cur = byUrl.get(url);
    if (cur) {
      cur.visits++;
      if (ts > cur.ts) Object.assign(cur, { ts, title: title || cur.title });
      cur.closed ||= closed;
    } else {
      byUrl.set(url, { url, title: title || url, ts, visits: 1, closed });
    }
  };
  for (const e of S.history) add(e.url, e.title, e.ts, false);
  for (const e of S.archive) add(e.url, e.title, e.at || 0, true);
  return [...byUrl.values()];
}

// A word matches as is or by its stem, so "formular" finds "forms" and "objednavky" finds "objednavka".
const stem = (w) => (w.length >= 5 ? w.slice(0, Math.max(4, Math.floor(w.length * 0.6))) : w);
const matches = (hay, words) => words.filter((w) => hay.includes(w) || hay.includes(stem(w))).length;

export function searchHistory(query = '', { days, limit = DEFAULT_LIMIT } = {}) {
  const words = fold(query).split(/[\s/.,:;|–-]+/).filter((w) => w.length > 1);
  const n = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
  const list = pages({ days });
  if (!words.length) return list.sort((a, b) => b.ts - a.ts).slice(0, n);
  // Most matched words first, title matches before URL-only ones, then the most recent.
  return list
    .map((p) => ({ p, hits: matches(fold(`${p.title} ${p.url}`), words), inTitle: matches(fold(p.title), words) }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.inTitle - a.inTitle || b.p.ts - a.p.ts)
    .slice(0, n)
    .map((x) => x.p);
}

export function formatPages(list) {
  return list.map((p) => `- ${short(p.title, 90)} - ${short(p.url, 160)} · ${timeAgo(p.ts)}${p.visits > 1 ? ` · ${p.visits} visits` : ''}${p.closed ? ' · closed tab' : ''}`).join('\n');
}

// The latest distinct pages, for the context sent with every AI request.
export function recentHistoryBlock(count = DEFAULT_LIMIT) {
  const list = pages().sort((a, b) => b.ts - a.ts).slice(0, count);
  return list.length ? `<recent_history note="Pages the user visited recently, newest first. Search further with browser_history.">\n${formatPages(list)}\n</recent_history>` : '';
}
