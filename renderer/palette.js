// Spotlight-style command bar: open URLs, search, switch tabs, history, actions, ask AI.
import { S } from './state.js';
import { h, $, toUrl, looksLikeUrl, hostOf, prettyUrl, favicon, isStart, SEARCH_ENGINES, debounce } from './util.js';
import { icon } from './icons.js';
import { closeMenu } from './ui.js';
import * as Tabs from './tabs.js';
import { pinLabel } from './sidebar.js';
import { linkIndex, completeLink, leftPinnedSite, returnsToPin } from './link-complete.js';

let state = null;
const actions = [];

// Other modules register commands here: { id, label, icon, hint, run }
export function registerAction(a) {
  actions.push(a);
}

export function isPaletteOpen() {
  return !!state;
}

export function openPalette({ mode = 'newtab', groupId = null, query = '' } = {}) {
  closeMenu();
  if (state) closePalette();
  const tab = Tabs.activeTab();
  if (mode === 'navigate' && !query && tab && !isStart(tab.url)) query = tab.url;
  if (mode === 'navigate' && (!tab || isStart(tab.url))) mode = 'here';

  const input = h('input', { class: 'palette-input', placeholder: mode === 'navigate' ? 'Search or enter address' : 'Search, open a site, or ask AI…', spellcheck: 'false', autocomplete: 'off' });
  input.value = query;
  const list = h('div', { class: 'palette-list' });
  const engine = SEARCH_ENGINES[S.settings.engine]?.name || 'Google';
  const box = h('div', { class: 'palette' },
    h('div', { class: 'palette-field' }, h('span', { class: 'palette-glyph', html: icon('search', 18) }), input,
      h('span', { class: 'palette-mode' }, mode === 'navigate' ? 'Current tab' : groupId ? `New tab · ${S.groups.find((g) => g.id === groupId)?.name || ''}` : 'New tab')),
    list,
    h('div', { class: 'palette-foot' },
      h('span', {}, h('kbd', {}, '↵'), ' open'),
      h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' select'),
      mode === 'navigate' ? h('span', {}, h('kbd', {}, '⇧↵'), ' new tab') : null,
      h('span', {}, h('kbd', {}, 'Tab'), ' complete'),
      h('span', { class: 'grow' }),
      h('span', {}, `Searching with ${engine}`)));
  const layer = h('div', { class: 'palette-layer' }, box);
  layer.addEventListener('mousedown', (e) => { if (e.target === layer) closePalette(); });
  $('#overlay-root').append(layer);
  requestAnimationFrame(() => layer.classList.add('in'));

  state = { mode, groupId, input, list, layer, items: [], sel: 0, suggestions: [], suggestFor: '' };
  state.comp = bindLinkCompletion(input, () => { if (!state) return; state.sel = 0; render(); fetchSuggestions(); });
  input.addEventListener('keydown', onKey);
  render();
  setTimeout(() => { input.focus(); input.select(); }, 10);
}

export function closePalette() {
  if (!state) return;
  const { layer } = state;
  state = null;
  layer.classList.remove('in');
  setTimeout(() => layer.remove(), 150);
  Tabs.activeTab()?.wv?.focus();
}

// What the user typed, without the part autocomplete filled in.
const typedText = () => (state.comp.link ? state.comp.typed : state.input.value);

const fetchSuggestions = debounce(async () => {
  if (!state || !S.settings.suggestions) return;
  const q = typedText().trim();
  if (!q || looksLikeUrl(q) || q.length < 2) { state.suggestions = []; return; }
  const res = await window.lumen.suggest(q, S.settings.engine);
  if (!state || typedText().trim() !== q) return;
  state.suggestions = res.filter((s) => s.toLowerCase() !== q.toLowerCase());
  state.suggestFor = q;
  render();
}, 120);

function score(text, q) {
  text = (text || '').toLowerCase();
  const i = text.indexOf(q);
  if (i < 0) return 0;
  return i === 0 ? 3 : /[\s./-]/.test(text[i - 1]) ? 2 : 1;
}

function buildItems() {
  const raw = typedText();
  const q = raw.trim().toLowerCase();
  const { link } = state.comp;
  const sections = [];
  const push = (title, items) => { if (items.length) sections.push({ title, items }); };

  if (!q) {
    const recentTabs = Tabs.orderedTabs().filter((t) => t.id !== S.activeId && !isStart(t.url)).slice(0, 5);
    push('Open Tabs', recentTabs.map(tabItem));
    const seen = new Set();
    const recent = [];
    for (const e of S.history) {
      if (seen.has(e.url)) continue;
      seen.add(e.url);
      recent.push(histItem(e));
      if (recent.length >= 6) break;
    }
    push('Recently Visited', recent);
    return sections;
  }

  const top = link ? [linkItem(link)] : [];
  if (looksLikeUrl(raw)) {
    top.push({ kind: 'url', title: prettyUrl(toUrl(raw, S.settings.engine)), sub: 'Open website', iconName: 'globe', run: (alt) => go(toUrl(raw, S.settings.engine), alt) });
  } else {
    top.push({ kind: 'search', title: raw.trim(), sub: `Search ${SEARCH_ENGINES[S.settings.engine]?.name || 'Google'}`, iconName: 'search', run: (alt) => go(toUrl(raw, S.settings.engine), alt) });
  }
  top.push({ kind: 'ai', title: `Ask AI: “${raw.trim()}”`, sub: 'With this page as context', iconName: 'sparkles', run: () => { closePalette(); window.dispatchEvent(new CustomEvent('lumen:ask', { detail: { text: raw.trim() } })); } });
  push('', top);

  const tabs = S.tabs
    .map((t) => ({ t, s: Math.max(score(t.title, q), score(t.url, q), t.pinned ? score(pinLabel(t), q) : 0) }))
    .filter((x) => x.s > 0 && x.t.id !== S.activeId && x.t.id !== link?.id)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => tabItem(x.t));
  push('Switch to Tab', tabs);

  const acts = actions
    .map((a) => ({ a, s: score(a.label, q) + (a.keywords ? score(a.keywords, q) : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map(({ a }) => ({ kind: 'action', title: a.label, iconName: a.icon || 'bolt', hint: a.hint, run: () => { closePalette(); a.run(); } }));
  push('Actions', acts);

  // History: score by match quality + visit frequency + recency.
  const agg = new Map();
  for (const e of S.history.slice(0, 4000)) {
    const s = Math.max(score(e.title, q), score(e.url.replace(/^https?:\/\/(www\.)?/, ''), q) + 0.5);
    if (!s) continue;
    const cur = agg.get(e.url);
    if (cur) cur.visits++;
    else agg.set(e.url, { e, s, visits: 1 });
  }
  const hist = [...agg.values()]
    .filter((x) => !S.tabs.some((t) => t.url === x.e.url))
    .sort((a, b) => (b.s + Math.log2(1 + b.visits)) - (a.s + Math.log2(1 + a.visits)) || b.e.ts - a.e.ts)
    .slice(0, 6)
    .map((x) => histItem(x.e));
  push('History', hist);

  const archived = S.archive
    .filter((e) => score(e.title, q) || score(e.url, q))
    .filter((e) => !S.tabs.some((t) => t.url === e.url))
    .slice(0, 3)
    .map((e) => ({ kind: 'history', title: e.title || e.url, sub: `Archived · ${prettyUrl(e.url)}`, entry: e, hint: 'Reopen', run: () => { closePalette(); Tabs.restoreEntry(e); } }));
  push('Archived Tabs', archived);

  if (state.suggestions.length && state.suggestFor) {
    push('Suggestions', state.suggestions.slice(0, 4).map((s) => ({ kind: 'search', title: s, iconName: 'search', run: (alt) => go(toUrl(s, S.settings.engine), alt) })));
  }
  return sections;
}

const tabItem = (t) => ({ kind: 'tab', title: t.title || hostOf(t.url), sub: prettyUrl(t.url), tab: t, hint: 'Switch', run: () => { closePalette(); Tabs.activate(t.id); } });
const histItem = (e) => ({ kind: 'history', title: e.title || e.url, sub: prettyUrl(e.url), entry: e, run: (alt) => go(e.url, alt) });

// The autocompleted link: a pinned page switches to its tab (Shift opens a fresh copy), anything else opens.
function linkItem(link) {
  const pin = link.pinned && Tabs.getTab(link.id);
  return {
    kind: 'url',
    title: link.pinned ? link.label || link.address : link.address,
    sub: link.pinned ? `Pinned page · ${link.address}` : link.title !== link.address ? link.title : 'Open website',
    entry: { favicon: link.favicon, title: link.label || link.address, url: link.url },
    hint: pin && pin.id !== S.activeId ? 'Switch' : null,
    run: (alt) => {
      if (!pin || alt) { go(link.url, alt); return; }
      const back = returnsToPin({ pinnedUrl: link.url, tabUrl: pin.url, active: pin.id === S.activeId });
      closePalette();
      Tabs.activate(pin.id);
      if (back) Tabs.navigate(pin, link.url);
    },
  };
}

function go(url, alt) {
  const { mode, groupId } = state;
  closePalette();
  const tab = Tabs.activeTab();
  if ((mode === 'navigate' && !alt) || (mode === 'here' && tab && isStart(tab.url))) {
    Tabs.navigate(tab, url);
  } else {
    Tabs.open(url, { groupId });
  }
}

function render() {
  if (!state) return;
  const sections = buildItems();
  state.items = sections.flatMap((s) => s.items);
  state.sel = Math.min(state.sel, Math.max(0, state.items.length - 1));
  const frag = document.createDocumentFragment();
  let i = 0;
  for (const sec of sections) {
    if (sec.title) frag.append(h('div', { class: 'palette-section' }, sec.title));
    for (const it of sec.items) {
      const idx = i++;
      const lead = it.tab ? favicon(it.tab, 18) : it.entry ? favicon(it.entry, 18) : h('span', { class: `palette-icon ${it.kind}`, html: icon(it.iconName, 16) });
      const row = h('div', { class: `palette-item${idx === state.sel ? ' sel' : ''}`, dataset: { idx } },
        h('span', { class: 'palette-lead' }, lead),
        h('span', { class: 'palette-text' }, h('span', { class: 'palette-title' }, it.title), it.sub ? h('span', { class: 'palette-sub' }, it.sub) : null),
        it.hint ? h('span', { class: 'palette-hint' }, it.hint) : null);
      row.addEventListener('mousemove', () => {
        if (state.sel === idx) return;
        state.sel = idx;
        state.list.querySelectorAll('.palette-item').forEach((r) => r.classList.toggle('sel', +r.dataset.idx === idx));
      });
      row.addEventListener('click', (e) => it.run(e.shiftKey || e.metaKey || e.ctrlKey));
      frag.append(row);
    }
  }
  state.list.replaceChildren(frag);
  state.list.classList.toggle('empty', !state.items.length);
}

function onKey(e) {
  if (!state) return;
  const n = state.items.length;
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); state.sel = (state.sel + 1) % Math.max(1, n); render(); scrollSel(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); state.sel = (state.sel - 1 + n) % Math.max(1, n); render(); scrollSel(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const it = state.items[state.sel];
    if (it) it.run(e.shiftKey || e.metaKey || e.ctrlKey);
    else if (state.input.value.trim()) go(toUrl(state.input.value, S.settings.engine), e.shiftKey);
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const it = state.items[state.sel];
    const { link } = state.comp;
    if (link && state.sel === 0) {
      if (!link.rest) state.input.value = link.address; // a pinned page found by its name
      state.input.setSelectionRange(state.input.value.length, state.input.value.length);
    } else if (it?.sub && (it.kind === 'history' || it.kind === 'tab')) state.input.value = it.sub;
    else if (it && it.kind === 'search') state.input.value = it.title;
    state.comp.typed = state.input.value;
    state.comp.link = null;
    render();
  }
}

// ---------------------------------------------------------------- address autocomplete (Settings → General)

// A pin that left for another site is named after its pinned site (or its custom name) and shows that site's icon,
// so a GitHub pin now on Drive isn't offered as "ROS Bags" and typing "ros" doesn't pull it back to GitHub.
function pinSource(t) {
  const url = t.pinnedUrl || t.url;
  const away = leftPinnedSite(t.pinnedUrl, t.url);
  const host = hostOf(url);
  const favicon = away ? S.history.find((e) => e.favicon && hostOf(e.url) === host)?.favicon || null : t.favicon;
  return { id: t.id, url, label: pinLabel(away ? { ...t, title: '' } : t), favicon };
}

const linkSources = () => ({
  pinned: S.tabs.filter((t) => t.pinned).map(pinSource),
  history: S.history,
});

// Fills in the rest of a pinned page or an often visited address while typing at the end of the field. The added part
// stays selected, so typing on replaces it and Backspace removes it; → or End keeps it. Used by the command bar and the
// start page. Returns its live state: { typed: what was typed, link: the suggestion or null }.
export function bindLinkCompletion(input, onUpdate = () => {}) {
  const comp = { typed: input.value, link: null };
  let index = null;
  input.addEventListener('focus', () => { index = null; }); // pins and history may have changed since
  input.addEventListener('input', (e) => {
    comp.typed = input.value;
    comp.link = null;
    const atEnd = input.selectionEnd === input.value.length;
    if (S.settings.autocomplete !== false && e.inputType === 'insertText' && !e.isComposing && atEnd) {
      index ??= linkIndex(linkSources());
      comp.link = completeLink(index, input.value);
      if (comp.link?.rest) {
        input.value = comp.typed + comp.link.rest;
        input.setSelectionRange(comp.typed.length, input.value.length);
      }
    }
    onUpdate(comp);
  });
  input.addEventListener('keydown', (e) => {
    if (comp.link?.rest && (e.key === 'ArrowRight' || e.key === 'End')) comp.typed = input.value;
  });
  return comp;
}

function scrollSel() {
  state?.list.querySelector('.palette-item.sel')?.scrollIntoView({ block: 'nearest' });
}
