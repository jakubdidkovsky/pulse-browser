// Tab lifecycle, <webview> management, navigation, and group auto-routing rules.
import { S, changed, addHistory, updateHistoryMeta, logActivity, PRIVATE } from './state.js';
import { h, $, uid, isStart, START_URL, hostOf, timeAgo } from './util.js';
import { toast } from './ui.js';

export const PARTITION = PRIVATE ? 'lumen-private' : 'persist:lumen';
const hooks = { onActivate: [], onNavigate: [], onFound: [], onTargetUrl: [], onLoadState: [] };

export function on(event, fn) {
  hooks[event].push(fn);
}
const fire = (event, ...args) => hooks[event].forEach((fn) => fn(...args));

export const getTab = (id) => S.tabs.find((t) => t.id === id) || null;
export const activeTab = () => getTab(S.activeId);
// Visible right now: the active tab or any tab shown in split view. Never slept or auto-closed.
export const onScreen = (t) => !!t && (t.id === S.activeId || !!S.split?.panes.includes(t.id));
export const tabByWebContents = (wcId) => S.tabs.find((t) => t.wcId === wcId) || null;

// Visual order: pinned → groups (in order) → loose tabs.
export function orderedTabs() {
  const pinned = S.tabs.filter((t) => t.pinned);
  const grouped = S.groups.flatMap((g) => S.tabs.filter((t) => !t.pinned && t.groupId === g.id));
  const loose = S.tabs.filter((t) => !t.pinned && !S.groups.some((g) => g.id === t.groupId));
  return [...pinned, ...grouped, ...loose];
}

// ---------------------------------------------------------------- group rules

export function matchRule(url, rule) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const r = rule.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^\*\./, '').replace(/^www\./, '');
  if (!r) return false;
  const [rhost, ...rest] = r.split('/');
  const rpath = rest.length ? `/${rest.join('/')}`.replace(/\*$/, '') : '';
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== rhost && !host.endsWith(`.${rhost}`)) return false;
  return !rpath || rpath === '/' || u.pathname.toLowerCase().startsWith(rpath);
}

export function groupForUrl(url) {
  return S.groups.find((g) => (g.rules || []).some((r) => matchRule(url, r))) || null;
}

function applyGroupRules(tab) {
  if (tab.pinned) return;
  const g = groupForUrl(tab.url);
  if (!g || tab.groupId === g.id) return;
  tab.groupId = g.id;
  g.collapsed = false;
  // Keep the tab at the end of its new group.
  S.tabs.splice(S.tabs.indexOf(tab), 1);
  S.tabs.push(tab);
  toast(`Moved to “${g.name}”`, { iconName: 'folder', timeout: 1800 });
}

// ---------------------------------------------------------------- creation / activation

export function createTab({ url = START_URL, title, groupId = null, pinned = false, background = false, afterId = null, favicon = null } = {}) {
  const tab = {
    id: uid(),
    url,
    title: title || (isStart(url) ? 'New Tab' : hostOf(url) || url),
    favicon,
    groupId,
    pinned,
    pinnedUrl: pinned ? url : null,
    loading: false,
    wv: null,
    ready: false,
    wcId: null,
    audible: false,
    muted: false,
    zoom: 0,
    error: null,
    created: Date.now(),
    lastActive: Date.now(),
  };
  if (!pinned && !groupId) {
    const g = groupForUrl(url);
    if (g) tab.groupId = g.id;
  }
  const after = afterId ? S.tabs.findIndex((t) => t.id === afterId) : -1;
  if (after >= 0) S.tabs.splice(after + 1, 0, tab);
  else S.tabs.push(tab);
  if (tab.groupId) {
    const g = S.groups.find((x) => x.id === tab.groupId);
    if (g) g.collapsed = false;
  }
  logActivity(`Opened new tab: ${isStart(url) ? 'blank' : url}`);
  if (!background) activate(tab.id);
  else changed();
  return tab;
}

export function open(url, opts = {}) {
  return createTab({ url, ...opts });
}

export function activate(id) {
  const tab = getTab(id);
  if (!tab) return;
  const prev = activeTab();
  const now = Date.now();
  if (prev) prev.lastActive = now;
  tab.lastActive = now;
  S.activeId = id;
  if (!isStart(tab.url)) ensureWebview(tab);
  for (const t of S.tabs) t.wv?.classList.toggle('active', t.id === id);
  if (prev?.id !== id) logActivity(`Switched to tab: ${tab.title} (${tab.url})`);
  fire('onActivate', tab, prev);
  changed();
  if (tab.wv && !document.activeElement?.closest('#ai-panel, .modal, .palette')) {
    requestAnimationFrame(() => tab.wv?.focus());
  }
}

export function ensureWebview(tab) {
  if (tab.wv) return tab.wv;
  const wv = document.createElement('webview');
  wv.setAttribute('partition', PARTITION);
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('webpreferences', 'contextIsolation=yes, spellcheck=yes');
  wv.className = 'page';
  wv.dataset.tab = tab.id;
  wv.src = tab.url;
  tab.wv = wv;
  tab.ready = false;
  bindWebview(tab, wv);
  $('#views').append(wv);
  wv.classList.toggle('active', tab.id === S.activeId);
  return wv;
}

export function sleepTab(tab) {
  if (!tab?.wv || onScreen(tab) || tab.audible || tab.agent || tab.keep) return false;
  destroyWebview(tab);
  if (tab.pinned && tab.pinnedUrl) tab.url = tab.url || tab.pinnedUrl;
  changed({ persist: false });
  return true;
}

function destroyWebview(tab) {
  if (!tab.wv) return;
  tab.wv.remove();
  tab.wv = null;
  tab.ready = false;
  tab.wcId = null;
  tab.loading = false;
  tab.audible = false;
}

function bindWebview(tab, wv) {
  const isActive = () => S.activeId === tab.id;
  wv.addEventListener('dom-ready', () => {
    const first = !tab.ready;
    tab.ready = true;
    tab.wcId = wv.getWebContentsId();
    if (first && tab.zoom) wv.setZoomLevel(tab.zoom);
    if (first && tab.muted) wv.setAudioMuted(true);
    fire('onLoadState', tab);
  });
  wv.addEventListener('did-start-loading', () => {
    tab.loading = true;
    tab.error = null;
    fire('onLoadState', tab);
    changed({ persist: false });
  });
  wv.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    fire('onLoadState', tab);
    changed({ persist: false });
  });
  wv.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    tab.error = null;
    addHistory(e.url, tab.title, tab.favicon);
    logActivity(`Navigated to ${e.url}`);
    applyGroupRules(tab);
    fire('onNavigate', tab);
    changed();
  });
  wv.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    tab.url = e.url;
    addHistory(e.url, tab.title, tab.favicon);
    fire('onNavigate', tab);
    changed();
  });
  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || tab.title;
    updateHistoryMeta(tab.url, { title: tab.title });
    changed();
  });
  wv.addEventListener('page-favicon-updated', (e) => {
    const fav = e.favicons?.[0];
    if (fav && fav !== tab.favicon) {
      tab.favicon = fav;
      updateHistoryMeta(tab.url, { favicon: fav });
      changed();
    }
  });
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return;
    tab.error = { code: e.errorCode, description: e.errorDescription, url: e.validatedURL };
    tab.loading = false;
    fire('onLoadState', tab);
    changed({ persist: false });
  });
  wv.addEventListener('update-target-url', (e) => { if (isActive()) fire('onTargetUrl', e.url); });
  wv.addEventListener('found-in-page', (e) => { if (isActive()) fire('onFound', e.result); });
  wv.addEventListener('media-started-playing', () => { tab.audible = true; changed({ persist: false }); });
  wv.addEventListener('media-paused', () => { tab.audible = false; changed({ persist: false }); });
  wv.addEventListener('enter-html-full-screen', () => document.body.classList.add('html-fullscreen'));
  wv.addEventListener('leave-html-full-screen', () => document.body.classList.remove('html-fullscreen'));
  wv.addEventListener('close', () => closeTab(tab.id));
  wv.addEventListener('render-process-gone', () => {
    tab.error = { code: 'crashed', description: 'This page crashed.', url: tab.url };
    changed({ persist: false });
  });
}

// ---------------------------------------------------------------- navigation

export function navigate(tab, url) {
  if (!tab) return open(url);
  tab.url = url;
  tab.error = null;
  if (!tab.wv) {
    ensureWebview(tab);
  } else if (tab.ready) {
    tab.wv.loadURL(url).catch(() => {});
  } else {
    tab.wv.src = url;
  }
  if (tab.id === S.activeId) tab.wv.classList.add('active');
  changed();
  return tab;
}

// Ready webview actions (no-ops before dom-ready).
const ready = (tab) => tab?.wv && tab.ready;
export const goBack = (tab = activeTab()) => { if (ready(tab) && tab.wv.canGoBack()) tab.wv.goBack(); };
export const goForward = (tab = activeTab()) => { if (ready(tab) && tab.wv.canGoForward()) tab.wv.goForward(); };
export function reload(tab = activeTab(), hard = false) {
  if (!tab) return;
  if (tab.error && !ready(tab)) return navigate(tab, tab.url);
  if (!ready(tab)) return;
  if (tab.error) { tab.error = null; tab.wv.loadURL(tab.url).catch(() => {}); return; }
  hard ? tab.wv.reloadIgnoringCache() : tab.wv.reload();
}
export const stop = (tab = activeTab()) => { if (ready(tab)) tab.wv.stop(); };

export function setZoom(tab, level) {
  if (!ready(tab)) return;
  tab.zoom = Math.max(-5, Math.min(5, level));
  tab.wv.setZoomLevel(tab.zoom);
  changed({ persist: false });
}

export function toggleMute(tab) {
  if (!ready(tab)) return;
  tab.muted = !tab.muted;
  tab.wv.setAudioMuted(tab.muted);
  changed({ persist: false });
}

// ---------------------------------------------------------------- closing / moving

function nextActiveAfterClose(tab) {
  // Prefer a loaded neighbour in the same group, then the visually nearest loaded tab.
  const full = orderedTabs();
  const idx = full.indexOf(tab);
  const loaded = full.filter((t) => t !== tab && (t.wv || !t.pinned));
  if (!loaded.length) return null;
  if (!tab.pinned) {
    const same = loaded.filter((t) => !t.pinned && t.groupId === tab.groupId);
    if (same.length) return same.find((t) => full.indexOf(t) > idx) || same.at(-1);
  }
  return loaded.find((t) => full.indexOf(t) > idx) || loaded.at(-1);
}

export function closeTab(id) {
  const tab = getTab(id);
  if (!tab) return;
  const wasActive = S.activeId === id;
  const next = wasActive ? nextActiveAfterClose(tab) : null;

  if (tab.pinned) {
    // Pinned tabs never disappear: closing just unloads them back to their pinned page.
    destroyWebview(tab);
    tab.url = tab.pinnedUrl || tab.url;
    if (wasActive) {
      S.activeId = null;
      const fallback = next && next.id !== tab.id ? next : null;
      if (fallback) activate(fallback.id); else { fire('onActivate', null, tab); changed(); }
    } else changed();
    return;
  }

  if (!isStart(tab.url)) archiveEntry(tab, 'closed');
  destroyWebview(tab);
  S.tabs = S.tabs.filter((t) => t.id !== id);
  logActivity(`Closed tab: ${tab.title}`);
  if (wasActive) {
    S.activeId = null;
    if (next) activate(next.id);
    else { fire('onActivate', null, tab); changed(); }
  } else {
    changed();
  }
}

function archiveEntry(tab, reason) {
  S.archive.unshift({ url: tab.url, title: tab.title, favicon: tab.favicon, groupId: tab.groupId, reason, at: Date.now(), lastActive: tab.lastActive || null });
  if (S.archive.length > 300) S.archive.length = 300;
}

export function reopenClosed() {
  const c = S.archive.shift();
  if (!c) return;
  restoreEntry(c);
}

export function restoreEntry(c, { background = false } = {}) {
  S.archive = S.archive.filter((x) => x !== c);
  const groupId = S.groups.some((g) => g.id === c.groupId) ? c.groupId : null;
  return createTab({ url: c.url, title: c.title, favicon: c.favicon, groupId, background });
}

// Closes several tabs at once (unpinned only) and offers Undo.
export function closeMany(ids, { reason = 'closed', label } = {}) {
  const set = new Set(ids);
  // Bulk and automatic closing never touches pinned tabs or tabs marked "Never close".
  const victims = S.tabs.filter((t) => set.has(t.id) && !t.pinned && !t.keep);
  for (const id of set) if (!victims.some((t) => t.id === id)) set.delete(id);
  if (!victims.length) return [];
  const entries = [];
  const activeGone = victims.some((t) => t.id === S.activeId);
  for (const t of victims) {
    if (!isStart(t.url)) {
      archiveEntry(t, reason);
      entries.push(S.archive[0]);
    }
    destroyWebview(t);
  }
  S.tabs = S.tabs.filter((t) => !set.has(t.id) || t.pinned);
  logActivity(`Closed ${victims.length} tabs (${reason})`);
  if (activeGone) {
    S.activeId = null;
    const next = orderedTabs().find((t) => t.wv) || orderedTabs()[0];
    if (next) activate(next.id); else { fire('onActivate', null, null); changed(); }
  } else changed();
  toast(label || `Closed ${victims.length} tab${victims.length > 1 ? 's' : ''}`, {
    iconName: 'x', timeout: 7000,
    action: entries.length ? { label: 'Undo', fn: () => entries.forEach((e) => restoreEntry(e, { background: true })) } : null,
  });
  return victims;
}

const normUrl = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');

// Groups of open tabs that show the same page; the first of each group is the one to keep.
export function duplicateSets() {
  const map = new Map();
  for (const t of orderedTabs()) {
    if (isStart(t.url)) continue;
    const k = normUrl(t.url);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return [...map.values()].filter((list) => list.length > 1)
    .map((list) => list.sort((a, b) => (b.pinned - a.pinned) || (b.id === S.activeId) - (a.id === S.activeId) || (b.lastActive || 0) - (a.lastActive || 0)));
}

export function staleTabs(ms) {
  const now = Date.now();
  return S.tabs.filter((t) => !t.pinned && !t.keep && !onScreen(t) && !t.audible && !t.agent && now - (t.lastActive || now) > ms);
}

export function sortTabs(by) {
  const key = {
    last_used: (t) => -(t.lastActive || 0),
    site: (t) => hostOf(t.url).split('.').slice(-2).join('.') + ' ' + hostOf(t.url),
    title: (t) => (t.title || '').toLowerCase(),
  }[by];
  if (!key) return;
  const pinned = S.tabs.filter((t) => t.pinned);
  const rest = S.tabs.filter((t) => !t.pinned);
  rest.sort((a, b) => { const x = key(a); const y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
  S.tabs = [...pinned, ...rest];
  changed();
}

export function lastUsedLabel(t) {
  if (t.id === S.activeId) return 'now';
  return t.lastActive ? timeAgo(t.lastActive) : 'unknown';
}

// Registrable domain, good enough for grouping (docs.notion.so → notion.so, bbc.co.uk stays bbc.co.uk).
export function siteOf(url) {
  const host = hostOf(url);
  if (!host || /^[\d.]+$/.test(host)) return host;
  const parts = host.split('.');
  const sld = parts.at(-2) || '';
  const n = parts.length > 2 && /^(co|com|org|net|gov|ac|edu)$/.test(sld) && parts.at(-1).length === 2 ? 3 : 2;
  return parts.slice(-n).join('.');
}

// Per-site tab limits: close the least recently used extras once they've been idle long enough.
function applyTabRules() {
  const rules = (S.settings.tabs?.rules || []).filter((r) => r.enabled && r.max > 0);
  if (!rules.length) return;
  const now = Date.now();
  const candidates = S.tabs.filter((t) => !t.pinned && !t.keep && !isStart(t.url) && /^https?:/.test(t.url));
  const specific = rules.filter((r) => r.site?.trim());
  const general = rules.find((r) => !r.site?.trim());
  const buckets = new Map(); // key -> { rule, label, tabs }
  for (const t of candidates) {
    const rule = specific.find((r) => matchRule(t.url, r.site)) || general;
    if (!rule) continue;
    const label = rule.site?.trim() ? rule.site.trim().toLowerCase() : siteOf(t.url);
    const key = `${rule.id}|${label}`;
    if (!buckets.has(key)) buckets.set(key, { rule, label, tabs: [] });
    buckets.get(key).tabs.push(t);
  }
  for (const { rule, label, tabs } of buckets.values()) {
    if (tabs.length <= rule.max) continue;
    const sorted = [...tabs].sort((a, b) => (b.id === S.activeId) - (a.id === S.activeId) || (b.lastActive || 0) - (a.lastActive || 0));
    const extras = sorted.slice(rule.max).filter((t) => !onScreen(t) && !t.audible && !t.agent && now - (t.lastActive || now) > rule.idle * 60e3);
    if (!extras.length) continue;
    closeMany(extras.map((t) => t.id), {
      reason: 'auto',
      label: `Closed ${extras.length} extra ${label} tab${extras.length > 1 ? 's' : ''}, kept the ${rule.max} you used last`,
    });
  }
}

// Background housekeeping: per-site limits, unload idle tabs, archive long-unused ones.
export function housekeeping() {
  const { sleepAfter, archiveAfter } = S.settings.tabs || {};
  const now = Date.now();
  applyTabRules();
  if (sleepAfter > 0) {
    for (const t of S.tabs) if (t.wv && now - (t.lastActive || now) > sleepAfter * 60e3) sleepTab(t);
  }
  if (archiveAfter > 0) {
    const stale = staleTabs(archiveAfter * 3600e3).filter((t) => !isStart(t.url));
    if (stale.length) {
      closeMany(stale.map((t) => t.id), {
        reason: 'archived',
        label: `Archived ${stale.length} tab${stale.length > 1 ? 's' : ''} you haven’t opened in ${archiveAfter >= 24 ? `${Math.round(archiveAfter / 24)} day${archiveAfter >= 48 ? 's' : ''}` : `${archiveAfter} h`}`,
      });
    }
  }
}

export function duplicateTab(tab) {
  createTab({ url: tab.url, title: tab.title, favicon: tab.favicon, groupId: tab.groupId, afterId: tab.id });
}

export function setPinned(tab, pinned) {
  tab.pinned = pinned;
  tab.pinnedUrl = pinned ? tab.url : null;
  if (pinned) tab.groupId = null;
  else applyGroupRules(tab);
  changed();
}

export function moveToGroup(tab, groupId) {
  tab.pinned = false;
  tab.pinnedUrl = null;
  tab.groupId = groupId;
  S.tabs.splice(S.tabs.indexOf(tab), 1);
  S.tabs.push(tab);
  const g = S.groups.find((x) => x.id === groupId);
  if (g) g.collapsed = false;
  changed();
}

// Reorder: put `tab` just before `target` (adopting target's group / pin state).
export function moveBefore(tab, target) {
  if (tab === target) return;
  S.tabs.splice(S.tabs.indexOf(tab), 1);
  S.tabs.splice(S.tabs.indexOf(target), 0, tab);
  tab.pinned = target.pinned;
  tab.pinnedUrl = target.pinned ? tab.pinnedUrl || tab.url : null;
  tab.groupId = target.pinned ? null : target.groupId;
  changed();
}

export function closeOthers(tab) {
  for (const t of [...S.tabs]) if (t.id !== tab.id && !t.pinned && !t.keep) closeTab(t.id);
  activate(tab.id);
}

export function cycle(dir) {
  const order = orderedTabs();
  if (!order.length) return;
  const idx = order.findIndex((t) => t.id === S.activeId);
  const next = order[(idx + dir + order.length) % order.length];
  activate(next.id);
}

export function selectIndex(n) {
  const order = orderedTabs();
  if (!order.length) return;
  activate((n === 9 ? order.at(-1) : order[n - 1] || order.at(-1)).id);
}

// ---------------------------------------------------------------- restore

export function restore(session) {
  S.groups = Array.isArray(session?.groups) ? session.groups : [];
  S.archive = Array.isArray(session?.archive) ? session.archive
    : (session?.closed || []).map((c) => ({ ...c, reason: 'closed', at: Date.now() }));
  // Time while Pulse was closed doesn't count as "unused".
  const shift = session?.savedAt ? Math.max(0, Date.now() - session.savedAt) : 0;
  for (const t of session?.tabs || []) {
    if (!t.url) continue;
    S.tabs.push({
      id: t.id || uid(), url: t.url, title: t.title || hostOf(t.url), favicon: t.favicon || null,
      groupId: S.groups.some((g) => g.id === t.groupId) ? t.groupId : null,
      pinned: !!t.pinned, pinnedUrl: t.pinnedUrl || (t.pinned ? t.url : null), pinTitle: t.pinTitle || null,
      loading: false, wv: null, ready: false, wcId: null, audible: false, muted: false, zoom: 0, error: null,
      lastActive: t.lastActive ? t.lastActive + shift : Date.now(), created: t.created || Date.now(), keep: !!t.keep,
    });
  }
  const sp = session?.split;
  if (sp && ['cols', 'rows', 'grid'].includes(sp.layout) && Array.isArray(sp.panes)) {
    const panes = sp.panes.map((id) => (getTab(id) && !isStart(getTab(id).url) ? id : null));
    const ratio = (v) => (Number.isFinite(v) ? Math.min(0.8, Math.max(0.2, v)) : 0.5);
    if (panes.some(Boolean)) S.split = { layout: sp.layout, panes, x: ratio(sp.x), y: ratio(sp.y), focus: 0 };
  }
  const active = getTab(session?.activeId) || orderedTabs()[0];
  if (active) activate(active.id);
  else changed({ persist: false });
}

// ---------------------------------------------------------------- page content (for the AI)

const EXTRACT = `(() => {
  const sel = String(window.getSelection ? window.getSelection() : '').trim();
  const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
  let text = document.body ? document.body.innerText : '';
  text = text.replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').replace(/[ \\t]{2,}/g, ' ').trim();
  return { title: document.title, url: location.href, description: meta ? meta.content : '', text, selection: sel, lang: document.documentElement.lang || '' };
})()`;

export async function extractPage(tab) {
  if (!ready(tab)) return null;
  try {
    return await Promise.race([
      tab.wv.executeJavaScript(EXTRACT),
      new Promise((r) => setTimeout(() => r(null), 3000)),
    ]);
  } catch {
    return null;
  }
}

export async function getSelection(tab = activeTab()) {
  if (!ready(tab)) return '';
  try {
    return (await tab.wv.executeJavaScript('String(window.getSelection ? window.getSelection() : "").trim()')) || '';
  } catch {
    return '';
  }
}
