// Split view: two or four tabs side by side in the content area. The focused pane is the
// active tab (address bar, AI, shortcuts follow it); a tab opened from the sidebar takes the focused pane.
import { S, changed, onChange } from './state.js';
import { h, $, favicon, hostOf, isStart, toUrl } from './util.js';
import { icon } from './icons.js';
import { showMenu } from './ui.js';
import * as Tabs from './tabs.js';

export const LAYOUTS = {
  cols: { panes: 2, label: 'Two Side by Side', icon: 'splitCols' },
  rows: { panes: 2, label: 'Two Stacked', icon: 'splitRows' },
  grid: { panes: 4, label: 'Four in a Grid', icon: 'splitGrid' },
};
const GAP = 6; // px between panes
const HEAD = 28; // px pane header (title + show only / remove)
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

const clampRatio = (v) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, v));
const webTabs = () => Tabs.orderedTabs().filter((t) => !isStart(t.url));
const paneTab = (id) => { const t = Tabs.getTab(id); return t && !isStart(t.url) ? t : null; };

export const isSplit = () => !!S.split;

// ---------------------------------------------------------------- state changes

export function setLayout(layout) {
  if (!LAYOUTS[layout]) { exitSplit(); return; }
  const count = LAYOUTS[layout].panes;
  const active = Tabs.activeTab();
  const ids = [...new Set([active && !isStart(active.url) ? active.id : null, ...(S.split?.panes || [])].filter(Boolean))];
  const recent = webTabs().filter((t) => !ids.includes(t.id)).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
  while (ids.length < count && recent.length) ids.push(recent.shift().id);
  const panes = Array.from({ length: count }, (_, i) => ids[i] || null);
  S.split = { layout, panes, x: S.split?.x ?? 0.5, y: S.split?.y ?? 0.5, focus: 0 };
  for (const id of panes) { const t = paneTab(id); if (t) Tabs.ensureWebview(t); }
  if (panes[0] && panes[0] !== S.activeId) Tabs.activate(panes[0]);
  else changed();
}

// Shows exactly these tabs (2–4) in split view, e.g. when the agent arranges pages for the user.
export function showTabs(ids, layout) {
  const tabs = ids.map(paneTab).filter(Boolean).slice(0, 4);
  if (tabs.length < 2) return false;
  const kind = tabs.length > 2 ? 'grid' : layout === 'rows' ? 'rows' : 'cols';
  const panes = Array.from({ length: LAYOUTS[kind].panes }, (_, i) => tabs[i]?.id || null);
  S.split = { layout: kind, panes, x: S.split?.x ?? 0.5, y: S.split?.y ?? 0.5, focus: 0 };
  for (const t of tabs) Tabs.ensureWebview(t);
  Tabs.activate(tabs[0].id);
  return kind;
}

export function exitSplit() {
  if (!S.split) return;
  S.split = null;
  changed();
}

// Shows `tab` next to the current one: starts a two-pane split, or fills an empty / the other pane.
export function openInSplit(tab) {
  if (!tab || isStart(tab.url)) return;
  if (!S.split) setLayout('cols');
  const sp = S.split;
  if (sp.panes.includes(tab.id)) { Tabs.activate(tab.id); return; }
  let i = sp.panes.indexOf(null);
  if (i < 0) i = sp.panes.findIndex((id) => id !== S.activeId);
  sp.panes[i] = tab.id;
  Tabs.ensureWebview(tab);
  Tabs.activate(tab.id);
}

function fillPane(index, tab) {
  const sp = S.split;
  if (!sp || !tab) return;
  const old = sp.panes.indexOf(tab.id);
  if (old >= 0) sp.panes[old] = null;
  sp.panes[index] = tab.id;
  sp.focus = index;
  Tabs.ensureWebview(tab);
  Tabs.activate(tab.id);
}

export function swapPanes() {
  const sp = S.split;
  if (!sp) return;
  sp.panes = [...sp.panes.slice(1), sp.panes[0]];
  changed();
}

// Leaves split view showing just this tab.
export function showOnly(id) {
  if (!S.split) return;
  S.split = null;
  if (id && Tabs.getTab(id)) Tabs.activate(id);
  changed();
}

// Takes one page out of the split; with one page left the split closes.
export function removeFromSplit(index) {
  const sp = S.split;
  if (!sp) return;
  const left = sp.panes.filter((id, i) => i !== index && paneTab(id));
  if (left.length <= 1) { showOnly(left[0] || S.activeId); return; }
  if (left.length === 2) {
    S.split = { ...sp, layout: sp.layout === 'rows' ? 'rows' : 'cols', panes: left };
  } else {
    sp.panes = sp.panes.map((id, i) => (i === index ? null : id));
  }
  if (!S.split.panes.includes(S.activeId)) Tabs.activate(left[0]);
  else changed();
}

export const removeTabFromSplit = (tab) => { const i = S.split?.panes.indexOf(tab?.id) ?? -1; if (i >= 0) removeFromSplit(i); };

// Keeps panes pointing at live tabs and makes the active tab part of the split.
function reconcile() {
  const sp = S.split;
  if (!sp) return;
  const before = sp.panes.filter(Boolean).length;
  sp.panes = sp.panes.map((id) => (Tabs.getTab(id) ? id : null));
  const after = sp.panes.filter(Boolean).length;
  // Closing a page that leaves only one behind ends the split.
  if (after < before && after <= 1) { S.split = null; return; }
  const active = S.activeId;
  if (!active) return;
  const at = sp.panes.indexOf(active);
  if (at >= 0) { sp.focus = at; return; }
  // A tab opened from the sidebar, palette or a link takes the focused pane (or an empty one).
  const focus = (sp.focus ?? 0) < sp.panes.length ? (sp.focus ?? 0) : 0;
  sp.panes[focus] = active;
}

// ---------------------------------------------------------------- layout

function paneRects(sp, W, H) {
  const w1 = Math.round((W - GAP) * sp.x);
  const h1 = Math.round((H - GAP) * sp.y);
  const w2 = W - w1 - GAP;
  const h2 = H - h1 - GAP;
  if (sp.layout === 'cols') return [[0, 0, w1, H], [w1 + GAP, 0, w2, H]];
  if (sp.layout === 'rows') return [[0, 0, W, h1], [0, h1 + GAP, W, h2]];
  return [[0, 0, w1, h1], [w1 + GAP, 0, w2, h1], [0, h1 + GAP, w1, h2], [w1 + GAP, h1 + GAP, w2, h2]];
}

const place = (el, [x, y, w, hgt]) => Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hgt}px`, right: 'auto', bottom: 'auto' });
const unplace = (el) => { for (const k of ['left', 'top', 'width', 'height', 'right', 'bottom']) el.style[k] = ''; };

let emptySig = '';

function emptyPane(index) {
  const sp = S.split;
  const choices = webTabs().filter((t) => !sp.panes.includes(t.id)).slice(0, 8);
  const input = h('input', { class: 'input pane-url', placeholder: 'Search or enter address', spellcheck: 'false' });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const tab = Tabs.open(toUrl(input.value.trim(), S.settings.engine), { background: true, afterId: S.activeId });
    fillPane(index, tab);
  });
  return h('div', { class: 'pane-empty', dataset: { pane: String(index) } },
    h('div', { class: 'pane-empty-inner' },
      h('div', { class: 'pane-empty-glyph', html: icon(LAYOUTS[sp.layout].icon, 22) }),
      h('h3', {}, 'Choose a page for this side'),
      input,
      choices.length ? h('div', { class: 'pane-choices' }, ...choices.map((t) =>
        h('button', { class: 'pane-choice', title: t.url, onclick: () => fillPane(index, t) },
          favicon(t, 16), h('span', {}, t.title || hostOf(t.url))))) : null,
      h('button', { class: 'btn small pane-close', onclick: () => setLayout(sp.layout === 'grid' ? 'cols' : null) }, sp.layout === 'grid' ? 'Use Two Panes' : 'Close Split View')));
}

function paneHead(id, index) {
  const t = Tabs.getTab(id);
  const focused = !!t && id === S.activeId;
  const tool = (iconName, title, run) => h('button', { class: 'pane-tool', title, html: icon(iconName, 13), onclick: (e) => { e.stopPropagation(); run(); } });
  return h('div', { class: `pane-head${focused ? ' focused' : ''}`, onclick: () => { if (t && !focused) Tabs.activate(t.id); } },
    t && !isStart(t.url) ? favicon(t, 14) : h('span', { class: 'pane-head-dot', html: icon('square', 12) }),
    h('span', { class: 'pane-title' }, t ? (isStart(t.url) ? 'New Tab' : t.title || hostOf(t.url)) : 'Empty'),
    t ? tool('square', 'Show only this page', () => showOnly(t.id)) : null,
    tool('x', 'Remove from split view', () => removeFromSplit(index)));
}

function divider(kind, rect) {
  const el = h('div', { class: `split-divider ${kind}` });
  place(el, rect);
  el.addEventListener('mousedown', (e) => startResize(e, kind));
  el.addEventListener('dblclick', () => { S.split[kind === 'v' ? 'x' : 'y'] = 0.5; changed(); });
  return el;
}

function startResize(e, kind) {
  e.preventDefault();
  const views = $('#views');
  const box = views.getBoundingClientRect();
  const shield = h('div', { class: 'drag-shield', style: { cursor: kind === 'v' ? 'col-resize' : 'row-resize' } });
  document.body.append(shield);
  const move = (ev) => {
    if (kind === 'v') S.split.x = clampRatio((ev.clientX - box.left) / box.width);
    else S.split.y = clampRatio((ev.clientY - box.top) / box.height);
    render();
  };
  const up = () => {
    shield.remove();
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    changed();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function render() {
  const views = $('#views');
  const sp = S.split;
  const overlays = [$('#start-page'), $('#error-page')];
  views.classList.toggle('split', !!sp);
  for (const wv of views.querySelectorAll('webview.page')) {
    const on = !!sp && sp.panes.includes(wv.dataset.tab);
    wv.classList.toggle('in-pane', on);
    wv.classList.toggle('focused', on && wv.dataset.tab === S.activeId);
    if (!on) unplace(wv);
  }
  views.querySelectorAll('.split-divider, .pane-ring, .pane-head').forEach((el) => el.remove());
  const btn = $('#btn-split');
  if (btn) {
    btn.classList.toggle('on', !!sp);
    btn.innerHTML = icon(sp ? LAYOUTS[sp.layout].icon : 'splitCols', 17);
  }
  if (!sp) {
    views.querySelectorAll('.pane-empty').forEach((el) => el.remove());
    emptySig = '';
    overlays.forEach(unplace);
    return;
  }
  const { width: W, height: H } = views.getBoundingClientRect();
  const rects = paneRects(sp, W, H);
  // Empty panes hold an input, so they are only rebuilt when something they show changed.
  const sig = JSON.stringify([sp.layout, sp.panes, S.activeId, webTabs().map((t) => [t.id, t.title])]);
  if (sig !== emptySig) {
    views.querySelectorAll('.pane-empty').forEach((el) => el.remove());
    sp.panes.forEach((id, i) => { if (!paneTab(id) && id !== S.activeId) views.append(emptyPane(i)); });
    emptySig = sig;
  }
  // Each pane: a slim header on top, the page below it.
  const body = ([x, y, w, hgt]) => [x, y + HEAD, w, Math.max(0, hgt - HEAD)];
  for (const el of views.querySelectorAll('.pane-empty')) place(el, body(rects[+el.dataset.pane]));
  sp.panes.forEach((id, i) => {
    const t = paneTab(id);
    if (t) place(Tabs.ensureWebview(t), body(rects[i]));
    const head = paneHead(id, i);
    place(head, [rects[i][0], rects[i][1], rects[i][2], HEAD]);
    views.append(head);
  });
  const focus = body(rects[sp.panes.indexOf(S.activeId)] || rects[0]);
  overlays.forEach((el) => place(el, focus));
  // Only the pane the agent is working in gets a ring; idle panes stay unmarked.
  const agentAt = sp.panes.findIndex((id) => Tabs.getTab(id)?.agent);
  if (agentAt >= 0) {
    const ring = h('div', { class: 'pane-ring agent' });
    place(ring, rects[agentAt]);
    views.append(ring);
  }
  const [, , w1] = rects[0];
  const [, , , h1] = rects[0];
  if (sp.layout !== 'rows') views.append(divider('v', [w1, 0, GAP, H]));
  if (sp.layout !== 'cols') views.append(divider('h', [0, h1, W, GAP]));
}

// ---------------------------------------------------------------- menu

export function layoutMenu(anchor) {
  const cur = S.split?.layout || 'single';
  showMenu(0, 0, [
    S.split ? { label: 'Close Split View', icon: 'x', action: exitSplit } : null,
    S.split ? { type: 'separator' } : null,
    { label: 'Single Page', icon: 'square', checked: cur === 'single', action: exitSplit },
    ...Object.entries(LAYOUTS).map(([id, l]) => ({ label: l.label, icon: l.icon, checked: cur === id, action: () => setLayout(id) })),
    S.split ? { type: 'separator' } : null,
    S.split ? { label: 'Swap Pages', icon: 'reload', action: swapPanes } : null,
  ].filter(Boolean), { anchor, align: 'right' });
}

export function initSplit() {
  const views = $('#views');
  // Clicking into a page makes its pane the focused one.
  views.addEventListener('focusin', (e) => {
    const id = e.target?.dataset?.tab;
    if (S.split && id && id !== S.activeId && S.split.panes.includes(id)) Tabs.activate(id);
  });
  Tabs.on('onActivate', reconcile);
  onChange(() => { reconcile(); render(); });
  new ResizeObserver(() => { if (S.split) render(); }).observe(views);
  render();
}
