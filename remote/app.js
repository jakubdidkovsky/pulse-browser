// Pulse remote on the phone: pairing, the live connection to Pulse, and switching between Chat, Screen and Tabs.
import { h, icon } from './dom.js';
import { api, command, setState, onState, onUnpaired, setRouter, store, toast } from './api.js';
import * as Chat from './chat.js';
import * as Screen from './screen.js';
import * as TabList from './tabs.js';
import { fitToKeyboard } from './viewport.js';

const VIEWS = {
  chat: { mod: Chat, label: 'Chat', icon: 'chat' },
  screen: { mod: Screen, label: 'Screen', icon: 'window' },
  tabs: { mod: TabList, label: 'Tabs', icon: 'layers' },
};
const RETRY_MS = 3000;
const VIEW_KEY = 'pulse-remote-view';

window.__pulseRemote = true; // tells boot.js the app's modules loaded

let current = null;
let events = null;
let pairing = false;
let lastNeed = '';
const els = {};

function savedView() {
  try { return localStorage.getItem(VIEW_KEY); } catch { return null; }
}

function saveView(name) {
  try { localStorage.setItem(VIEW_KEY, name); } catch {}
}

// ---------------------------------------------------------------- views

function show(name) {
  const next = VIEWS[name] ? name : 'chat';
  if (current === next) return;
  const prev = current;
  current = next;
  for (const [n, v] of Object.entries(VIEWS)) {
    v.root.hidden = n !== next;
    v.button.classList.toggle('on', n === next);
  }
  if (prev) VIEWS[prev].mod.hidden?.();
  VIEWS[next].mod.shown?.();
  saveView(next);
  renderHeader();
}

function renderHeader() {
  els.title.textContent = VIEWS[current]?.mod.title() || 'Pulse';
  const need = Chat.needsYou();
  VIEWS.chat.button.classList.toggle('badge', need && current !== 'chat');
  document.title = need ? 'Pulse needs you' : 'Pulse';
}

// A new question or approval from the agent buzzes the phone once.
function alertIfNeeded() {
  const list = store.chat?.messages || [];
  const last = list[list.length - 1];
  const id = last?.confirm?.id || last?.ask?.id || '';
  if (id && id !== lastNeed) {
    navigator.vibrate?.(200);
    if (current !== 'chat') toast('Pulse needs your answer in Chat.');
  }
  lastNeed = id;
}

function openMenu() {
  const close = () => layer.remove();
  const layer = h('div', { class: 'sheet-layer', onclick: (e) => { if (e.target === layer) close(); } },
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-group' },
        h('button', { onclick: () => { close(); command('chat.new'); show('chat'); } }, 'New Chat'),
        h('button', { class: 'danger', onclick: () => { close(); unpair(); } }, 'Unpair This Phone')),
      h('button', { class: 'cancel', onclick: close }, 'Cancel')));
  document.body.append(layer);
}

async function unpair() {
  if (!confirm('Unpair this phone? You’ll need a new code from Pulse to connect again.')) return;
  await api('/api/unpair', {}).catch(() => {});
  showPairing();
}

// ---------------------------------------------------------------- connection

function setConnected(on) {
  els.dot.classList.toggle('on', on);
  els.dot.title = on ? 'Connected to Pulse' : 'Reconnecting…';
}

function connect() {
  events?.close();
  events = new EventSource('/api/events');
  events.addEventListener('open', () => setConnected(true));
  for (const part of ['tabs', 'chat']) {
    events.addEventListener(part, (e) => {
      try { setState(part, JSON.parse(e.data)); } catch {}
    });
  }
  events.addEventListener('error', () => {
    setConnected(false);
    if (events?.readyState !== EventSource.CLOSED) return; // the browser retries by itself
    // Closed for good: either this phone was unpaired (api() then shows the pairing screen) or Pulse is away.
    api('/api/me').then(() => setTimeout(connect, RETRY_MS), () => setTimeout(() => { if (!pairing) connect(); }, RETRY_MS));
  });
}

// ---------------------------------------------------------------- screens

function buildApp() {
  els.dot = h('span', { class: 'dot' });
  els.title = h('b', { class: 'title' }, 'Pulse');
  const header = h('header', { class: 'top' }, els.dot, els.title, h('button', { class: 'tool', 'aria-label': 'More', html: icon('more', 22), onclick: openMenu }));
  const main = h('main', { class: 'views' });
  const nav = h('nav', { class: 'nav' });
  for (const [name, v] of Object.entries(VIEWS)) {
    v.root = v.mod.mount();
    v.root.hidden = true;
    main.append(v.root);
    v.button = h('button', { class: 'nav-btn', onclick: () => show(name) }, h('span', { html: icon(v.icon, 22) }), h('small', {}, v.label));
    nav.append(v.button);
  }
  document.body.replaceChildren(h('div', { class: 'app' }, header, main, nav));
  onState((part) => {
    for (const v of Object.values(VIEWS)) v.mod.update(part);
    if (part === 'chat') alertIfNeeded();
    renderHeader();
  });
  setRouter(show);
  show(savedView() || 'chat');
  connect();
}

function screenEl(title, text, ...extra) {
  return h('div', { class: 'pair' }, h('img', { class: 'pair-icon', src: '/icon.png', alt: '' }), h('h1', {}, title), h('p', {}, text), ...extra);
}

function showPairing(message) {
  pairing = true;
  events?.close();
  events = null;
  const text = message && !/isn’t paired/.test(message) ? message : 'On your computer, open Pulse Settings, then Remote, and scan the code with this phone’s camera.';
  document.body.replaceChildren(screenEl('Connect to Pulse', text));
}

let offlineTimer = 0;
function showOffline() {
  document.body.replaceChildren(screenEl('Can’t reach Pulse', 'Make sure Pulse is open on your computer and this phone is connected to Tailscale (or the same Wi-Fi, if you allowed it).',
    h('button', { class: 'btn primary', onclick: boot }, 'Try Again')));
  // Keep trying on its own, e.g. while the computer wakes up or Pulse restarts.
  clearTimeout(offlineTimer);
  offlineTimer = setTimeout(() => { if (!document.hidden) boot(); else document.addEventListener('visibilitychange', boot, { once: true }); }, RETRY_MS * 2);
}

async function boot() {
  let pairError = '';
  onUnpaired((message) => showPairing(pairError || message));
  const code = new URLSearchParams(location.hash.slice(1)).get('pair');
  if (code) {
    history.replaceState(null, '', location.pathname);
    // A used or old link is fine on a phone that is already paired: it just opens the app.
    try { await api('/api/pair', { code }); } catch (err) { pairError = err.message; }
  }
  try {
    await api('/api/me');
  } catch {
    if (!pairing) showOffline();
    return;
  }
  if (current) return; // already running; a new pairing link only renewed the session
  pairing = false;
  buildApp();
}

window.addEventListener('hashchange', () => { if (location.hash.includes('pair=')) boot(); });
fitToKeyboard();
boot();
