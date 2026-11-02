// Bootstrap: layout, toolbar, start page, find bar, downloads, shortcuts.
import { S, loadAll, onChange, changed, setSetting, logActivity, PRIVATE } from './state.js';
import { h, $, favicon, hostOf, isStart, prettyUrl, toUrl, clamp, fmtBytes, avatarFor } from './util.js';
import { icon } from './icons.js';
import { toast, showMenu, topModal, closeMenu, popover } from './ui.js';
import * as Tabs from './tabs.js';
import { renderSidebar, editGroup, modKey, tidyMenu, AI_TASKS, fitFavbar } from './sidebar.js';
import { openPalette, closePalette, isPaletteOpen, registerAction } from './palette.js';
import { openHistory } from './history.js';
import { openSettings } from './settings.js';
import { initAI, toggleAI, ask, askAboutElement } from './ai.js';
import { searchImage, rectOfPoint } from './lens.js';
import { renderStartSections, startMenu } from './start.js';
import { initExtensions } from './extensions.js';
import { initSplit, layoutMenu, setLayout, exitSplit } from './split.js';
import { openWelcome, needsSetup } from './welcome.js';
import { initUsage } from './usage.js';
import { initBoards, newBoard } from './board-model.js';
import { initBoardView, boardButton, showBoard } from './board-view.js';

const isMac = window.lumen.platform === 'darwin';

// ---------------------------------------------------------------- layout chrome

const MAX_ICON = '<svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" rx="1.2"/></svg>';
const RESTORE_ICON = '<svg viewBox="0 0 10 10"><rect x="1.2" y="3" width="5.8" height="5.8" rx="1.1"/><path d="M3.2 3V2.2a1 1 0 0 1 1-1h3.6a1 1 0 0 1 1 1v3.6a1 1 0 0 1-1 1H7"/></svg>';

// Minimize / maximize / close on the right (macOS keeps its native traffic lights).
function windowControls() {
  if (isMac) return null;
  return h('div', { class: 'win-controls' },
    h('button', { class: 'wc', title: 'Minimize', onclick: () => window.lumen.win.minimize(), html: '<svg viewBox="0 0 10 10"><path d="M1.5 5h7"/></svg>' }),
    h('button', { class: 'wc', id: 'wc-max', title: 'Maximize', onclick: () => window.lumen.win.maximize(), html: MAX_ICON }),
    h('button', { class: 'wc close', title: 'Close', onclick: () => window.lumen.win.close(), html: '<svg viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6"/></svg>' }));
}

function updateMaxButton() {
  const b = $('#wc-max');
  if (!b) return;
  b.innerHTML = S.win.maximized ? RESTORE_ICON : MAX_ICON;
  b.title = S.win.maximized ? 'Restore' : 'Maximize';
}

function buildChrome() {
  $('#sb-header').replaceChildren(
    ...(isMac ? [h('div', { class: 'mac-spacer' })] : []),
    h('button', { class: 'icon-btn', title: `Hide sidebar (${modKey('\\')})`, html: icon('sidebar', 17), onclick: () => toggleSidebar(false) }),
    h('div', { class: 'grow drag' }),
    PRIVATE ? h('span', { class: 'private-badge', title: 'Nothing from this window is saved' }, h('span', { html: icon('mask', 13) }), 'Private') : '');

  $('#sb-footer').replaceChildren(
    h('button', { class: 'icon-btn', title: `History (${modKey('Y')})`, html: icon('history', 16), onclick: () => openHistory() }),
    h('button', { class: 'icon-btn', id: 'dl-btn', title: 'Downloads', html: icon('download', 16), onclick: (e) => showDownloads(e.currentTarget) }),
    h('div', { class: 'grow' }),
    h('button', { class: 'icon-btn', title: 'New group', html: icon('folderPlus', 16), onclick: () => editGroup(null) }),
    h('button', { class: 'icon-btn', title: `Settings (${modKey(',')})`, html: icon('settings', 16), onclick: () => openSettings() }));

  $('#tabs-section .section-label').append(
    h('button', { class: 'tidy-btn', title: 'Tidy up tabs', onclick: (e) => tidyMenu(e.currentTarget) }, h('span', { html: icon('sparkles', 12) }), 'Tidy'));
  $('#new-tab-row').innerHTML = `${icon('plus', 14)}<span>New Tab</span><kbd>${modKey('T')}</kbd>`;
  $('#new-tab-row').addEventListener('click', () => openPalette({ mode: 'newtab' }));

  const address = h('button', { class: 'address', id: 'address', onclick: () => openPalette({ mode: 'navigate' }) });
  $('#toolbar').replaceChildren(
    h('div', { class: 'tb-left' },
      h('button', { class: 'icon-btn tb-sidebar', title: `Show sidebar (${modKey('\\')})`, html: icon('sidebar', 17), onclick: () => toggleSidebar(true) }),
      h('button', { class: 'icon-btn', id: 'btn-back', title: 'Back', html: icon('back', 18), onclick: () => Tabs.goBack() }),
      h('button', { class: 'icon-btn', id: 'btn-forward', title: 'Forward', html: icon('forward', 18), onclick: () => Tabs.goForward() }),
      h('button', { class: 'icon-btn', id: 'btn-reload', title: 'Reload', onclick: () => { const t = Tabs.activeTab(); t?.loading ? Tabs.stop(t) : Tabs.reload(t); } })),
    h('div', { class: 'tb-center drag' }, address),
    h('div', { class: 'tb-right' },
      h('div', { class: 'ext-actions empty', id: 'ext-actions' }),
      h('button', { class: 'icon-btn', id: 'btn-board', title: 'Whiteboard: draw, or let the AI sketch for you', html: icon('board', 17), onclick: (e) => boardButton(e.currentTarget) }),
      h('button', { class: 'icon-btn', id: 'btn-split', title: 'Split view: show 2 or 4 pages side by side', html: icon('splitCols', 17), onclick: (e) => layoutMenu(e.currentTarget) }),
      h('button', { class: 'icon-btn', id: 'btn-pin', title: `Pin tab (${modKey('D')})`, html: icon('pin', 16), onclick: () => togglePin() }),
      h('button', { class: 'icon-btn', id: 'btn-more', title: 'More', html: icon('more', 17), onclick: (e) => moreMenu(e.currentTarget) }),
      h('button', { class: 'ai-toggle', id: 'btn-ai', title: `AI assistant (${modKey('E')})`, onclick: () => toggleAI() }, h('span', { html: icon('sparkles', 15) }), h('span', {}, 'Ask')),
      windowControls()));
  updateMaxButton();

  $('#toolbar').addEventListener('dblclick', (e) => { if (e.target.closest('.drag') || e.target.id === 'toolbar') window.lumen.win.maximize(); });
  $('#sb-header').addEventListener('dblclick', (e) => { if (e.target.closest('.drag')) window.lumen.win.maximize(); });
}

function renderToolbar() {
  const tab = Tabs.activeTab();
  const ready = tab?.wv && tab.ready;
  $('#btn-back').disabled = !(ready && tab.wv.canGoBack());
  $('#btn-forward').disabled = !(ready && tab.wv.canGoForward());
  const reloadBtn = $('#btn-reload');
  reloadBtn.innerHTML = icon(tab?.loading ? 'x' : 'reload', tab?.loading ? 16 : 15);
  reloadBtn.title = tab?.loading ? 'Stop' : 'Reload';
  reloadBtn.disabled = !tab || isStart(tab.url);
  const pin = $('#btn-pin');
  pin.classList.toggle('on', !!tab?.pinned);
  pin.disabled = !tab || isStart(tab.url);

  const addr = $('#address');
  addr.replaceChildren();
  if (!tab || isStart(tab.url)) {
    addr.append(h('span', { class: 'addr-icon', html: icon('search', 14) }), h('span', { class: 'addr-placeholder' }, 'Search or enter website'));
  } else {
    let secure = false;
    let host = tab.url;
    let rest = '';
    try {
      const u = new URL(tab.url);
      secure = u.protocol === 'https:';
      host = /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : tab.url;
      rest = /^https?:$/.test(u.protocol) ? (u.pathname === '/' ? '' : u.pathname) + u.search : '';
    } catch {}
    addr.append(
      h('span', { class: `addr-icon${secure ? '' : ' insecure'}`, html: icon(secure ? 'lock' : 'globe', 13) }),
      h('span', { class: 'addr-host' }, host),
      rest ? h('span', { class: 'addr-path' }, rest) : '');
    if (tab.zoom) {
      addr.append(h('span', { class: 'addr-badge', title: 'Reset zoom', onclick: (e) => { e.stopPropagation(); Tabs.setZoom(tab, 0); } }, `${Math.round(1.2 ** tab.zoom * 100)}%`));
    }
  }
  addr.title = tab?.url && !isStart(tab.url) ? tab.url : '';
  $('#btn-ai').classList.toggle('on', S.settings.aiVisible);
}

// ---------------------------------------------------------------- content states

function renderContent() {
  const tab = Tabs.activeTab();
  const start = !tab || isStart(tab.url);
  $('#start-page').classList.toggle('show', start);
  if (start) renderStart();
  const err = $('#error-page');
  if (tab?.error) {
    const e = tab.error;
    err.replaceChildren(h('div', { class: 'error-inner' },
      h('div', { class: 'error-glyph', html: icon('globe', 34) }),
      h('h2', {}, e.code === 'crashed' ? 'This page crashed' : 'Can’t reach this page'),
      h('p', {}, e.code === 'crashed' ? 'Something went wrong while displaying this page.' : `${hostOf(e.url) || e.url} isn’t responding.`),
      h('code', {}, e.description || String(e.code)),
      h('div', { class: 'error-actions' }, h('button', { class: 'btn primary', onclick: () => Tabs.reload(tab) }, 'Try Again'))));
    err.classList.add('show');
  } else {
    err.classList.remove('show');
  }
  progress(tab);
}

let progressTimer = null;
function progress(tab) {
  const bar = $('#progress');
  if (tab?.loading) {
    if (!bar.classList.contains('run')) {
      bar.classList.remove('done');
      bar.classList.add('run');
    }
  } else if (bar.classList.contains('run')) {
    bar.classList.remove('run');
    bar.classList.add('done');
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => bar.classList.remove('done'), 450);
  }
}

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

let startBuilt = false;
function renderStart() {
  const el = $('#start-page');
  if (!startBuilt) {
    startBuilt = true;
    const input = h('input', { class: 'start-input', placeholder: 'Search or enter website', spellcheck: 'false' });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      const url = toUrl(input.value, S.settings.engine);
      input.value = '';
      const tab = Tabs.activeTab();
      if (tab && isStart(tab.url)) Tabs.navigate(tab, url);
      else Tabs.open(url);
    });
    input.addEventListener('focus', () => { input.value = ''; });
    el.replaceChildren(h('div', { class: 'start-inner' },
      h('h1', { class: 'start-greeting' }),
      h('div', { class: 'start-search' }, h('span', { html: icon('search', 18) }), input,
        h('button', { class: 'start-ai', title: 'Ask AI instead', onclick: () => { const v = input.value.trim(); input.value = ''; ask(v, { send: !!v }); } }, h('span', { html: icon('sparkles', 14) }), 'Ask AI')),
      h('div', { class: 'start-section', id: 'start-favs' }),
      h('div', { class: 'start-section', id: 'start-top' })),
      h('button', { class: 'start-customize', title: 'Customize the start page', onclick: (e) => startMenu(e.currentTarget) }, h('span', { html: icon('settings', 13) }), 'Customize'));
  }
  el.querySelector('.start-greeting').textContent = PRIVATE ? 'Private Browsing' : greeting();
  if (PRIVATE && !el.querySelector('.start-private')) {
    el.querySelector('.start-greeting').after(h('p', { class: 'start-private' }, 'Pulse won’t remember pages you visit, cookies, downloads history or AI chats from this window. Closing it erases everything.'));
  }
  renderStartSections();
}

// ---------------------------------------------------------------- find in page

let findQuery = '';
function openFind() {
  const tab = Tabs.activeTab();
  if (!tab?.wv || !tab.ready) return;
  const bar = $('#find-bar');
  if (!bar.firstChild) {
    const input = h('input', { class: 'find-input', placeholder: 'Find in page', spellcheck: 'false' });
    const count = h('span', { class: 'find-count' });
    bar.append(h('span', { class: 'find-glyph', html: icon('search', 14) }), input, count,
      h('button', { class: 'icon-btn small', title: 'Previous', html: icon('up', 14), onclick: () => findNext(false) }),
      h('button', { class: 'icon-btn small', title: 'Next', html: icon('down', 14), onclick: () => findNext(true) }),
      h('button', { class: 'icon-btn small', title: 'Done', html: icon('x', 13), onclick: closeFind }));
    input.addEventListener('input', () => {
      findQuery = input.value;
      const t = Tabs.activeTab();
      if (!t?.ready) return;
      if (findQuery) t.wv.findInPage(findQuery);
      else { t.wv.stopFindInPage('clearSelection'); count.textContent = ''; }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); findNext(!e.shiftKey); }
      if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    });
  }
  bar.classList.add('show');
  const input = bar.querySelector('input');
  input.focus();
  input.select();
}

function findNext(forward) {
  const t = Tabs.activeTab();
  if (t?.ready && findQuery) t.wv.findInPage(findQuery, { forward, findNext: true });
}

function closeFind() {
  const bar = $('#find-bar');
  if (!bar.classList.contains('show')) return false;
  bar.classList.remove('show');
  const t = Tabs.activeTab();
  if (t?.ready) { t.wv.stopFindInPage('clearSelection'); t.wv.focus(); }
  return true;
}

Tabs.on('onFound', (r) => {
  const c = $('#find-bar .find-count');
  if (c) c.textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : 'No results';
});

// ---------------------------------------------------------------- status bubble (hovered link)

let statusTimer = null;
Tabs.on('onTargetUrl', (url) => {
  const el = $('#status-bubble');
  clearTimeout(statusTimer);
  if (url) {
    el.textContent = prettyUrl(url);
    el.classList.add('show');
  } else {
    statusTimer = setTimeout(() => el.classList.remove('show'), 300);
  }
});

Tabs.on('onActivate', () => { closeFind(); $('#status-bubble').classList.remove('show'); });

// ---------------------------------------------------------------- sidebar / AI layout

function applyLayout() {
  const b = document.body;
  b.classList.toggle('sidebar-hidden', !S.settings.sidebarVisible);
  b.classList.toggle('ai-open', !!S.settings.aiVisible);
  document.documentElement.style.setProperty('--sidebar-w', `${S.settings.sidebarWidth}px`);
  document.documentElement.style.setProperty('--ai-w', `${S.settings.aiWidth}px`);
}

let sidebarAnim = null;
function toggleSidebar(force) {
  const on = force ?? !S.settings.sidebarVisible;
  const body = document.body;
  if (on === S.settings.sidebarVisible && !body.classList.contains('sidebar-peek')) return;
  // Keep the page at its wider size while the card animates, so the web page
  // doesn't re-layout on every frame; it settles once the slide is done.
  const views = $('#views');
  if (!body.classList.contains('sidebar-peek')) {
    const startW = $('#content').clientWidth;
    const delta = S.settings.sidebarWidth - 8;
    views.style.width = `${Math.max(startW, on ? startW - delta : startW + delta)}px`;
    views.style.right = 'auto';
  }
  body.classList.add('sidebar-animating');
  body.classList.remove('sidebar-peek');
  setSetting('sidebarVisible', on);
  applyLayout();
  clearTimeout(sidebarAnim);
  sidebarAnim = setTimeout(() => {
    views.style.width = '';
    views.style.right = '';
    body.classList.remove('sidebar-animating');
  }, 320);
}

function bindResizer(handle, key, min, max, sign) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = S.settings[key];
    const shield = h('div', { class: 'drag-shield' });
    document.body.append(shield);
    document.body.classList.add('resizing');
    const move = (ev) => {
      const w = clamp(startW + sign * (ev.clientX - startX), min, max);
      S.settings[key] = w;
      document.documentElement.style.setProperty(key === 'sidebarWidth' ? '--sidebar-w' : '--ai-w', `${w}px`);
    };
    const up = () => {
      shield.remove();
      document.body.classList.remove('resizing');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setSetting(key, S.settings[key]);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function bindPeek() {
  const zone = $('#peek-zone');
  const sb = $('#sidebar');
  let t = null;
  zone.addEventListener('mouseenter', () => {
    if (S.settings.sidebarVisible || !S.settings.sidebarPeek) return;
    clearTimeout(t);
    document.body.classList.add('sidebar-peek');
  });
  sb.addEventListener('mouseenter', () => clearTimeout(t));
  sb.addEventListener('mouseleave', () => {
    if (S.settings.sidebarVisible) return;
    t = setTimeout(() => { if (!document.querySelector('.menu-layer')) document.body.classList.remove('sidebar-peek'); }, 280);
  });
}

// ---------------------------------------------------------------- menus & actions

function togglePin() {
  const tab = Tabs.activeTab();
  if (!tab || isStart(tab.url)) return;
  Tabs.setPinned(tab, !tab.pinned);
  toast(tab.pinned ? 'Pinned to top' : 'Unpinned', { iconName: 'pin', timeout: 1400 });
}

function toggleFavbar() {
  if (S.settings.pinsLocation === 'sidebar') {
    setSetting('pinsLocation', 'bar');
    setSetting('favbar', true);
  } else {
    setSetting('favbar', S.settings.favbar === false);
  }
}

function copyUrl() {
  const tab = Tabs.activeTab();
  if (!tab || isStart(tab.url)) return;
  navigator.clipboard.writeText(tab.url);
  toast('Link copied', { iconName: 'link', timeout: 1400 });
}

async function lensFromMenu(point) {
  const tab = Tabs.tabByWebContents(point.id);
  try {
    const rect = tab ? await rectOfPoint(tab, point.x, point.y) : null;
    await searchImage({ src: point.srcURL, tab, rect, afterId: tab?.id || S.activeId });
  } catch (err) {
    toast(err.message || 'Google Lens search failed', { iconName: 'warn' });
  }
}

function moreMenu(anchor) {
  const tab = Tabs.activeTab();
  const has = tab && !isStart(tab.url);
  showMenu(0, 0, [
    { label: 'New Tab', icon: 'plus', hint: modKey('T'), action: () => openPalette({ mode: 'newtab' }) },
    { label: 'New Private Window', icon: 'mask', hint: modKey('⇧N'), action: () => window.lumen.win.newPrivate() },
    { label: 'Reopen Closed Tab', icon: 'undo', hint: modKey('⇧T'), action: () => Tabs.reopenClosed(), disabled: !S.archive.length },
    { type: 'separator' },
    { label: 'Find in Page…', icon: 'search', hint: modKey('F'), action: openFind, disabled: !has },
    { label: 'Copy Link', icon: 'link', hint: modKey('⇧C'), action: copyUrl, disabled: !has },
    { label: 'Open in Floating Window', icon: 'float', action: () => window.lumen.float(tab.url), disabled: !has },
    { label: 'Open in Default Browser', icon: 'external', action: () => window.lumen.openExternal(tab.url), disabled: !has },
    { label: 'Extensions…', icon: 'puzzle', action: () => openSettings('extensions'), disabled: PRIVATE },
    {
      label: 'Zoom', icon: 'zoom', disabled: !tab?.ready, submenu: [
        { label: 'Zoom In', hint: modKey('+'), action: () => Tabs.setZoom(tab, tab.zoom + 0.5) },
        { label: 'Zoom Out', hint: modKey('−'), action: () => Tabs.setZoom(tab, tab.zoom - 0.5) },
        { label: 'Actual Size', hint: modKey('0'), action: () => Tabs.setZoom(tab, 0) },
      ],
    },
    { type: 'separator' },
    { label: 'Keep Window on Top', icon: 'window', checked: S.settings.alwaysOnTop, action: () => { setSetting('alwaysOnTop', !S.settings.alwaysOnTop); window.lumen.win.setOnTop(S.settings.alwaysOnTop); } },
    { label: S.settings.sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar', icon: 'sidebar', hint: modKey('\\'), action: () => toggleSidebar() },
    { label: 'Show Favorites Bar', icon: 'pin', hint: modKey('⇧B'), checked: S.settings.favbar !== false && S.settings.pinsLocation !== 'sidebar', action: toggleFavbar },
    { type: 'separator' },
    { label: 'History', icon: 'history', hint: modKey('Y'), action: openHistory },
    { label: 'Settings', icon: 'settings', hint: modKey(','), action: () => openSettings() },
    { label: 'Developer Tools', icon: 'terminal', hint: 'F12', action: () => tab?.wv?.openDevTools(), disabled: !tab?.ready },
  ], { anchor, align: 'right' });
}

// ---------------------------------------------------------------- downloads

function onDownload(d) {
  const prev = S.downloads.get(d.id);
  S.downloads.set(d.id, { ...d, toast: prev?.toast });
  const entry = S.downloads.get(d.id);
  const pct = d.total ? d.received / d.total : 0;
  if (!prev) {
    entry.toast = toast(`Downloading ${d.filename}`, { iconName: 'download', timeout: 0, progress: pct });
  } else if (d.state === 'progressing') {
    entry.toast?.update({ text: `${d.filename} · ${fmtBytes(d.received)}${d.total ? ` of ${fmtBytes(d.total)}` : ''}`, progress: pct });
  } else if (d.state === 'completed') {
    entry.toast?.update({ text: `Downloaded ${d.filename}`, progress: null, action: { label: 'Show', fn: () => window.lumen.downloads.show(d.path) }, timeout: 5000 });
  } else {
    entry.toast?.update({ text: `Download ${d.state}: ${d.filename}`, progress: null, timeout: 3000 });
  }
  $('#dl-btn')?.classList.toggle('busy', [...S.downloads.values()].some((x) => x.state === 'progressing'));
}

function showDownloads(anchor) {
  const items = [...S.downloads.values()].reverse();
  const list = h('div', { class: 'dl-list' });
  if (!items.length) list.append(h('div', { class: 'empty-note' }, 'No downloads in this session.'));
  for (const d of items) {
    const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
    list.append(h('div', { class: 'dl-row' },
      h('span', { class: 'dl-icon', html: icon('download', 15) }),
      h('div', { class: 'dl-text' }, h('b', {}, d.filename),
        h('small', {}, d.state === 'progressing' ? `${pct}% · ${fmtBytes(d.received)}` : d.state === 'completed' ? fmtBytes(d.total || d.received) : d.state)),
      d.state === 'progressing'
        ? h('button', { class: 'icon-btn small', title: 'Cancel', html: icon('x', 12), onclick: () => window.lumen.downloads.cancel(d.id) })
        : d.state === 'completed'
          ? h('button', { class: 'icon-btn small', title: 'Show in folder', html: icon('folder', 13), onclick: () => window.lumen.downloads.show(d.path) })
          : null));
  }
  popover(anchor, h('div', {}, h('div', { class: 'popover-title' }, 'Downloads'), list), { width: 300 });
}

// ---------------------------------------------------------------- shortcuts

function handleShortcut(action) {
  const tab = Tabs.activeTab();
  if (action.startsWith('tab:')) return Tabs.selectIndex(+action.slice(4));
  switch (action) {
    case 'newTab': return openPalette({ mode: 'newtab' });
    case 'palette': return isPaletteOpen() ? closePalette() : openPalette({ mode: 'newtab' });
    case 'focusAddress': return openPalette({ mode: 'navigate' });
    case 'closeTab': return tab ? Tabs.closeTab(tab.id) : null;
    case 'reopenTab': return Tabs.reopenClosed();
    case 'reload': return Tabs.reload(tab);
    case 'hardReload': return Tabs.reload(tab, true);
    case 'back': return Tabs.goBack();
    case 'forward': return Tabs.goForward();
    case 'nextTab': return Tabs.cycle(1);
    case 'prevTab': return Tabs.cycle(-1);
    case 'toggleAI': return toggleAI();
    case 'toggleSidebar': return toggleSidebar();
    case 'history': return openHistory();
    case 'settings': return openSettings();
    case 'pinTab': return togglePin();
    case 'find': return openFind();
    case 'findNext': return findNext(true);
    case 'copyUrl': return copyUrl();
    case 'toggleFavbar': return toggleFavbar();
    case 'zoomIn': return tab && Tabs.setZoom(tab, tab.zoom + 0.5);
    case 'zoomOut': return tab && Tabs.setZoom(tab, tab.zoom - 0.5);
    case 'zoomReset': return tab && Tabs.setZoom(tab, 0);
    case 'devtools': return tab?.ready && tab.wv.openDevTools();
    default: return null;
  }
}

function registerActions() {
  const A = (label, iconName, run, hint, keywords) => registerAction({ label, icon: iconName, run, hint, keywords });
  A('New Group', 'folderPlus', () => editGroup(null), null, 'create folder space');
  A('New Private Window', 'mask', () => window.lumen.win.newPrivate(), modKey('⇧N'), 'incognito anonymous anonymni');
  A('Toggle AI Panel', 'sparkles', () => toggleAI(), modKey('E'), 'assistant chat claude gpt');
  A('Toggle Sidebar', 'sidebar', () => toggleSidebar(), modKey('\\'));
  A('Show History', 'history', openHistory, modKey('Y'));
  A('Open Settings', 'settings', () => openSettings(), modKey(','), 'preferences');
  A('AI Settings', 'key', () => openSettings('ai'), null, 'api key login claude chatgpt cursor');
  A('Pin / Unpin Current Tab', 'pin', togglePin, modKey('D'), 'favorite');
  A('Reopen Closed Tab', 'undo', () => Tabs.reopenClosed(), modKey('⇧T'));
  A('New Whiteboard', 'board', () => { newBoard(); showBoard(true); }, null, 'tabule kresleni draw sketch diagram board');
  A('New Temporary Whiteboard', 'eraser', () => { newBoard({ temporary: true }); showBoard(true); }, null, 'docasna tabule kresleni draw scratch');
  A('Welcome & Setup', 'sparkles', openWelcome, null, 'onboarding intro first run uvod prvni nastaveni pruvodce');
  A('Split View: Two Side by Side', 'splitCols', () => setLayout('cols'), null, 'split screen layout rozdelit pul dva vedle sebe');
  A('Split View: Two Stacked', 'splitRows', () => setLayout('rows'), null, 'split screen layout rozdelit nad sebou');
  A('Split View: Four in a Grid', 'splitGrid', () => setLayout('grid'), null, 'split screen layout grid ctyri 4');
  A('Exit Split View', 'square', exitSplit, null, 'single page layout jeden');
  A('Float Current Tab', 'float', () => { const t = Tabs.activeTab(); if (t && !isStart(t.url)) window.lumen.float(t.url); }, null, 'picture always on top window');
  A('Keep Window on Top', 'window', () => { setSetting('alwaysOnTop', !S.settings.alwaysOnTop); window.lumen.win.setOnTop(S.settings.alwaysOnTop); toast(S.settings.alwaysOnTop ? 'Window stays on top' : 'Window no longer on top', { iconName: 'window' }); }, null, 'pin always');
  A('Summarize This Page', 'page', () => ask('Summarize this page.', { send: true }), null, 'ai tldr');
  A('Copy Link', 'link', copyUrl, modKey('⇧C'), 'url');
  A('Find in Page', 'search', openFind, modKey('F'));
  A('Toggle Dark Mode', 'sun', () => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    setSetting('theme', next);
    window.lumen.setTheme(next);
  }, null, 'theme appearance light');
  A('Close Other Tabs', 'x', () => { const t = Tabs.activeTab(); if (t) Tabs.closeOthers(t); });
  const agentTask = (text) => window.dispatchEvent(new CustomEvent('lumen:agent', { detail: { text } }));
  A('Organize Tabs with AI', 'sparkles', () => agentTask(AI_TASKS.organize), null, 'tidy group sort clean');
  A('Close Tabs I Don’t Need (AI)', 'agent', () => agentTask(AI_TASKS.cleanup), null, 'tidy clean unused old');
  A('Close Duplicate Tabs', 'copy', () => {
    const ids = Tabs.duplicateSets().flatMap((list) => list.slice(1).filter((t) => !t.pinned).map((t) => t.id));
    if (ids.length) Tabs.closeMany(ids, { label: `Closed ${ids.length} duplicate tab${ids.length > 1 ? 's' : ''}` });
    else toast('No duplicate tabs', { iconName: 'check', timeout: 1500 });
  }, null, 'tidy clean');
  A('Sort Tabs by Last Used', 'layers', () => Tabs.sortTabs('last_used'), null, 'order');
  A('Sort Tabs by Website', 'layers', () => Tabs.sortTabs('site'), null, 'order domain');
  A('Tidy Up Tabs…', 'sparkles', () => tidyMenu(null), null, 'clean organize');
  A('Archived Tabs', 'folder', () => openHistory('archive'), null, 'closed restore');
}

// ---------------------------------------------------------------- boot

async function boot() {
  document.body.classList.add(`platform-${window.lumen.platform}`);
  if (PRIVATE) document.body.classList.add('private');
  const session = await loadAll();
  document.documentElement.dataset.accent = S.settings.accent;
  window.lumen.setTheme(S.settings.theme);
  const ws = await window.lumen.win.state();
  S.win.maximized = ws.maximized;
  document.body.classList.toggle('maximized', ws.maximized);

  buildChrome();
  applyLayout();
  registerActions();
  bindResizer($('#sidebar-resizer'), 'sidebarWidth', 200, 420, 1);
  bindResizer($('#ai-resizer'), 'aiWidth', 320, 760, -1);
  bindPeek();

  onChange(() => {
    renderSidebar();
    renderToolbar();
    renderContent();
    const base = PRIVATE ? 'Pulse Private' : 'Pulse';
    document.title = Tabs.activeTab()?.title ? `${Tabs.activeTab().title} - ${base}` : base;
  });
  Tabs.on('onLoadState', () => renderToolbar());

  Tabs.restore(session);
  if (!S.tabs.length) changed({ persist: false });

  await initUsage();
  await initBoards();
  await initAI({ openSettings });
  if (S.settings.aiVisible) toggleAI(true);
  initExtensions();
  initSplit();
  initBoardView();
  if (needsSetup() && !PRIVATE) setTimeout(openWelcome, 400);

  window.lumen.onShortcut((action) => handleShortcut(action));
  window.lumen.onOpenUrl(({ url, background, sourceId }) => {
    const src = sourceId ? Tabs.tabByWebContents(sourceId) : null;
    Tabs.open(url, { background: !!background, afterId: src?.id || S.activeId, groupId: src && !src.pinned ? src.groupId : null });
  });
  if (!PRIVATE) window.lumen.launchUrl().then((url) => { if (url) Tabs.open(url, { afterId: S.activeId }); });
  window.lumen.onMenuAction((action, data) => {
    if (action === 'ask-selection') ask('', { selection: data.text });
    else if (action === 'explain-selection') ask('Explain the selected text.', { send: true, selection: data.text });
    else if (action === 'search') Tabs.open(toUrl(data.text, S.settings.engine), { afterId: S.activeId });
    else if (action === 'summarize') ask('Summarize this page.', { send: true });
    else if (action === 'ask-page') ask('');
    else if (action === 'ask-link') {
      const t = Tabs.open(data.url, { background: true, afterId: S.activeId });
      Tabs.ensureWebview(t);
      ask(`What is this link about? ${data.url}`, { send: false });
    } else if (action === 'point') askAboutElement(data);
    else if (action === 'lens') lensFromMenu(data);
  });
  window.lumen.downloads.onUpdate(onDownload);
  window.lumen.win.onState((st) => {
    Object.assign(S.win, st);
    document.body.classList.toggle('maximized', !!S.win.maximized);
    document.body.classList.toggle('fullscreen', !!S.win.fullscreen);
    document.body.classList.toggle('blurred', S.win.focused === false);
    updateMaxButton();
  });
  window.addEventListener('lumen:sidebar', (e) => toggleSidebar(e.detail));
  window.addEventListener('lumen:history', (e) => openHistory(e.detail === 'archive' ? 'archive' : 'history'));
  setInterval(() => Tabs.housekeeping(), 60_000);
  let fitFrame = 0;
  new ResizeObserver(() => { cancelAnimationFrame(fitFrame); fitFrame = requestAnimationFrame(fitFavbar); }).observe($('#favbar'));
  window.addEventListener('lumen:ai', (e) => toggleAI(e.detail));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.menu-layer')) { closeMenu(); return; }
    if (isPaletteOpen()) return;
    const m = topModal();
    if (m?.dismissable) { m.close(); return; }
    if (closeFind()) return;
    if (document.body.classList.contains('sidebar-peek')) document.body.classList.remove('sidebar-peek');
  });

  logActivity(PRIVATE ? 'Opened a private window' : 'Opened Pulse');
  if (!session && !PRIVATE) firstRun();
}

function firstRun() {
  // Friendly defaults: a starter group with a routing rule.
  S.groups.push({ id: 'work', name: 'Work', color: 'blue', collapsed: false, rules: ['notion.so', 'notion.com', 'linear.app', 'figma.com'] });
  changed();
  if (!needsSetup()) setTimeout(() => toast('Welcome to Pulse ✦  Press ' + modKey('T') + ' to open anything, ' + modKey('E') + ' for AI', { timeout: 6000, iconName: 'sparkles' }), 600);
}

boot().catch((err) => {
  console.error(err);
  document.body.append(h('pre', { class: 'boot-error' }, String(err?.stack || err)));
});
