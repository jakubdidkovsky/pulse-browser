// Address autocomplete (Settings → General → Autocomplete addresses): typing the start of an address fills in
// the rest of a pinned page or a site you visit often, like Chrome. Typing a pinned page's name ("gma" for Gmail)
// suggests it too, though only as the first row of the command bar, since its address doesn't start that way.
// Pure: callers pass the pinned pages and history in, so it can be unit tested.

const HISTORY_SCAN = 4000; // most recent history entries counted
const MIN_CHARS = 2; // a single letter is too likely the start of a search
const LABEL_MIN_CHARS = 3; // a name match takes over Enter without showing in the field, so it needs a bit more
const SCHEME = /^https?:\/\//i;
const WWW = /^www\./i;
const WORD_START = /[\s|·:,()-]+/;

function parse(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.host.replace(WWW, '').toLowerCase();
  // Exactly the page's address (the start page opens what the field says), minus a bare "/" at the end.
  const path = u.pathname === '/' && !u.search && !u.hash ? '' : u.pathname;
  return { host, origin: `${u.protocol}//${u.host}`, address: host + path + u.search + u.hash };
}

const busier = (a, b) => b.visits - a.visits || b.ts - a.ts || a.address.length - b.address.length;

function count(map, key, entry) {
  const cur = map.get(key);
  if (!cur) { map.set(key, { ...entry, visits: 1 }); return; }
  cur.visits += 1;
  if (!cur.favicon && entry.favicon) cur.favicon = entry.favicon;
}

// pinned: [{ id, url, label, favicon }], history: [{ url, title, favicon, ts }] (newest first).
export function linkIndex({ pinned = [], history = [] } = {}) {
  const hosts = new Map();
  const pages = new Map();
  for (const e of history.slice(0, HISTORY_SCAN)) {
    const a = parse(e?.url);
    if (!a) continue;
    count(hosts, a.host, { address: a.host, url: `${a.origin}/`, favicon: e.favicon || null, title: a.host, ts: e.ts || 0 });
    count(pages, a.address, { address: a.address, url: e.url, favicon: e.favicon || null, title: e.title || a.address, ts: e.ts || 0 });
  }
  const pins = pinned.flatMap((p) => {
    const a = parse(p?.url);
    return a ? [{ address: a.address, url: p.url, id: p.id ?? null, label: String(p.label || ''), favicon: p.favicon || null, pinned: true }] : [];
  });
  return { pins, hosts: [...hosts.values()].sort(busier), pages: [...pages.values()].sort(busier) };
}

const siteOf = (url) => parse(url)?.host ?? null;

// A pinned tab that browsed off to another site: its title and icon now belong to that site, not the pinned page.
export const leftPinnedSite = (pinnedUrl, tabUrl) => !!pinnedUrl && siteOf(tabUrl) !== siteOf(pinnedUrl);

// Choosing a pinned page's suggestion switches to its tab as it is (an open Gmail mail stays open), but takes the tab
// back to the pinned page when it has left for another site, or when it is the tab being typed in.
export const returnsToPin = ({ pinnedUrl, tabUrl, active }) =>
  leftPinnedSite(pinnedUrl, tabUrl) || (active && tabUrl !== pinnedUrl);

const labelMatches = (label, q) => label.toLowerCase().split(WORD_START).some((w) => w && w.startsWith(q));

// The link to suggest for what was typed, or null. `rest` is what to add after the typed text in the field;
// it's '' when only the pinned page's name matched (shown in the command bar, never typed into the field).
export function completeLink(index, typed) {
  const raw = String(typed ?? '');
  if (!raw || /\s/.test(raw)) return null;
  const q = raw.toLowerCase().replace(SCHEME, '').replace(WWW, '');
  if (q.length < MIN_CHARS) return null;
  const starts = (c) => c.address.length > q.length && c.address.toLowerCase().startsWith(q);
  const fill = (c) => ({ ...c, rest: c.address.slice(q.length) });

  const pin = index.pins.find(starts);
  if (pin) return fill(pin);
  if (!q.includes('/')) {
    const host = index.hosts.find(starts);
    if (host) return fill(host);
  } else {
    const page = index.pages.find(starts);
    if (page) return fill(page);
  }
  if (q.length < LABEL_MIN_CHARS || SCHEME.test(raw) || q.includes('.') || q.includes('/')) return null;
  const named = index.pins.find((p) => labelMatches(p.label, q));
  return named ? { ...named, rest: '' } : null;
}
