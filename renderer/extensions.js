// Chrome extensions in the UI: toolbar action buttons (their popups open from main) and the
// tab bridge that lets chrome.tabs create, select and close real Pulse tabs.
import { S, PRIVATE } from './state.js';
import { h, $ } from './util.js';
import * as Tabs from './tabs.js';

const api = window.lumen.ext;
const WAIT_FOR_TAB = 8000; // ms for a new tab's page to get a webContents
let actions = [];
let selectedWcId = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function webContentsOf(tab) {
  const t0 = Date.now();
  while (!tab.wcId && Date.now() - t0 < WAIT_FOR_TAB && Tabs.getTab(tab.id)) await sleep(50);
  return tab.wcId || null;
}

// The extension system keeps its own "active tab"; tell it whenever ours changes.
function syncActiveTab() {
  const tab = Tabs.activeTab();
  if (!tab?.wcId || tab.wcId === selectedWcId) return;
  selectedWcId = tab.wcId;
  api.tabSelected(tab.wcId);
  render();
}

// Main window content coordinates (DIPs) of a toolbar button, for placing the extension popup.
function anchorOf(el) {
  const r = el.getBoundingClientRect();
  const z = window.outerWidth && window.innerWidth ? window.outerWidth / window.innerWidth : 1;
  const k = z > 0.25 && z < 5 ? z : 1;
  return { x: r.left * k, y: r.top * k, width: r.width * k, height: r.height * k };
}

function activate(action, e) {
  e.preventDefault();
  api.activate(Tabs.PARTITION, {
    eventType: e.type,
    extensionId: action.id,
    tabId: Tabs.activeTab()?.wcId ?? -1,
    alignment: '',
    anchorRect: anchorOf(e.currentTarget),
  }).catch(() => {});
}

function actionButton(action, tabId) {
  const info = { ...action, ...(action.tabs?.[tabId] || {}) };
  const q = new URLSearchParams({ tabId: String(tabId), partition: Tabs.PARTITION });
  if (info.iconModified) q.set('t', String(info.iconModified));
  return h('button', {
    class: 'icon-btn ext-action',
    title: info.title || 'Extension',
    onclick: (e) => activate(action, e),
    oncontextmenu: (e) => activate(action, e),
  },
  h('span', { class: 'ext-icon', style: { backgroundImage: `url("crx://extension-icon/${action.id}/32/2?${q}")` } }),
  info.text ? h('span', { class: 'ext-badge', style: { background: info.color || '#666' } }, info.text) : null);
}

function render() {
  const box = $('#ext-actions');
  if (!box) return;
  const tabId = Tabs.activeTab()?.wcId ?? -1;
  box.replaceChildren(...actions.map((a) => actionButton(a, tabId)));
  box.classList.toggle('empty', !actions.length);
}

async function refresh() {
  try {
    const state = await api.state(Tabs.PARTITION);
    actions = state?.actions || [];
  } catch {
    actions = [];
  }
  render();
}

async function onCreateTab({ id, url, active }) {
  if (!url) { api.tabCreated(id, null); return; }
  const tab = Tabs.open(url, { background: !active, afterId: S.activeId });
  if (!active) Tabs.ensureWebview(tab);
  api.tabCreated(id, await webContentsOf(tab));
}

export function initExtensions() {
  if (PRIVATE || !api) return;
  api.onCreateTab(onCreateTab);
  api.onSelectTab((wcId) => { const t = Tabs.tabByWebContents(wcId); if (t) Tabs.activate(t.id); });
  api.onRemoveTab((wcId) => { const t = Tabs.tabByWebContents(wcId); if (t) Tabs.closeTab(t.id); });
  api.onActionsChanged(refresh);
  api.onChanged(refresh);
  Tabs.on('onActivate', syncActiveTab);
  Tabs.on('onLoadState', syncActiveTab);
  api.observe(Tabs.PARTITION).catch(() => {});
  refresh();
}

export const listExtensions = () => (api ? api.list() : Promise.resolve([]));
export const removeExtension = (id) => api.remove(id);
