// Screen view: a live picture of the current tab. Tap to click, drag to scroll, pinch to zoom the picture,
// and type into the page from the keyboard bar.
import { h, icon } from './dom.js';
import { store, activeTab, command, sendInput, toast } from './api.js';

const TAP_SLOP = 8; // px a finger may move and still count as a tap
const TAP_MAX_MS = 600;
const SCROLL_SEND_MS = 50; // scroll events are batched this often while dragging
const FAST_MS = 150; // frame interval right after input
const NORMAL_MS = 450; // while the page keeps changing
const IDLE_MS = 1200; // while nothing changes
const ACTIVE_FOR_MS = 3000; // input counts as recent for this long
const MAX_SCALE = 4;
const MAX_FRAME_WIDTH = 1600;

let root;
let stage;
let frame;
let img;
let hint;
let bar;
let addrBtn;
let addrInput;
let keyBar;
let keyInput;
let visible = false;
let timer = 0;
let busy = false;
let again = false;
let etag = null;
let frameWc = null;
let objectUrl = null;
let lastInput = 0;
let view = { scale: 1, x: 0, y: 0 }; // pinch zoom of the picture, local only
const pointers = new Map();
let gesture = null;

// ---------------------------------------------------------------- frames

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

function poke(ms = FAST_MS) {
  lastInput = Date.now();
  schedule(ms);
}

async function tick() {
  timer = 0;
  if (!visible || document.hidden) return;
  if (busy) { again = true; return; }
  busy = true;
  let changed = false;
  try { changed = await fetchFrame(); } catch {}
  busy = false;
  const recent = Date.now() - lastInput < ACTIVE_FOR_MS;
  if (again) { again = false; schedule(0); return; }
  if (!timer) schedule(recent ? FAST_MS : changed ? NORMAL_MS : IDLE_MS);
}

async function fetchFrame() {
  const tab = activeTab();
  if (!tab?.wc) { showHint(tab); return false; }
  if (tab.wc !== frameWc) etag = null;
  const width = Math.max(320, Math.min(MAX_FRAME_WIDTH, Math.round(stage.clientWidth * devicePixelRatio)));
  const res = await fetch(`/api/frame?wc=${tab.wc}&w=${width}`, { headers: etag ? { 'If-None-Match': etag } : {}, cache: 'no-store', credentials: 'same-origin' });
  if (res.status === 304) return false;
  if (res.status === 204) { showHint(tab, 'Pulse’s window is minimized, so there’s no picture. Restore it on the computer.'); return false; }
  if (!res.ok) return false;
  const url = URL.createObjectURL(await res.blob());
  img.src = url;
  await img.decode().catch(() => {});
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = url;
  etag = res.headers.get('ETag');
  frameWc = tab.wc;
  frame.style.setProperty('--drag-x', '0px');
  frame.style.setProperty('--drag-y', '0px');
  clearHint();
  return true;
}

function clearHint() {
  hint.hidden = true;
  frame.hidden = false;
}

// Without a picture (no tab, a new tab, still loading) the hint replaces it; with `text` it sits over the last picture.
function showHint(tab, text) {
  const msg = text || (!tab ? 'No tab is open.' : !tab.url ? 'New Tab. Tap the address bar to open a website.' : 'Loading…');
  hint.textContent = msg;
  hint.hidden = false;
  frame.hidden = !text;
}

// ---------------------------------------------------------------- gestures

function pointIn(x, y) {
  const r = img.getBoundingClientRect();
  if (!r.width || x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  return { fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, r };
}

function applyView() {
  frame.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

function ripple(x, y) {
  const s = stage.getBoundingClientRect();
  const dot = h('span', { class: 'ripple', style: `left:${x - s.left}px;top:${y - s.top}px` });
  stage.append(dot);
  setTimeout(() => dot.remove(), 450);
}

function flushScroll(g) {
  if (!g.accX && !g.accY) return;
  const p = pointIn(g.x0, g.y0) || { fx: 0.5, fy: 0.5, r: img.getBoundingClientRect() };
  const tab = activeTab();
  if (tab?.wc && p.r.width) sendInput({ type: 'scroll', wc: tab.wc, fx: p.fx, fy: p.fy, dx: -g.accX / p.r.width, dy: -g.accY / p.r.height });
  g.accX = 0;
  g.accY = 0;
  g.sentAt = Date.now();
  poke();
}

function pinchState() {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}

function onDown(e) {
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    gesture = { kind: 'tap', x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, t0: Date.now(), accX: 0, accY: 0, dragX: 0, dragY: 0, sentAt: 0 };
  } else if (pointers.size === 2) {
    if (gesture?.kind === 'scroll') flushScroll(gesture);
    const s = stage.getBoundingClientRect();
    gesture = { kind: 'pinch', start: pinchState(), view: { ...view }, origin: { x: s.left, y: s.top } };
  }
}

function onMove(e) {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture.kind === 'pinch' && pointers.size === 2) {
    const now = pinchState();
    const { start, view: v, origin } = gesture;
    const scale = Math.min(MAX_SCALE, Math.max(1, v.scale * (now.dist / start.dist)));
    // Keep the point under the fingers' midpoint in place while zooming and panning.
    const px = (start.mx - origin.x - v.x) / v.scale;
    const py = (start.my - origin.y - v.y) / v.scale;
    view = scale === 1 ? { scale: 1, x: 0, y: 0 } : { scale, x: now.mx - origin.x - px * scale, y: now.my - origin.y - py * scale };
    applyView();
    return;
  }
  if (gesture.kind === 'tap' && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > TAP_SLOP) gesture.kind = 'scroll';
  if (gesture.kind !== 'scroll') return;
  const dx = e.clientX - gesture.lastX;
  const dy = e.clientY - gesture.lastY;
  gesture.lastX = e.clientX;
  gesture.lastY = e.clientY;
  gesture.accX += dx;
  gesture.accY += dy;
  gesture.dragX += dx;
  gesture.dragY += dy;
  frame.style.setProperty('--drag-x', `${gesture.dragX / view.scale}px`);
  frame.style.setProperty('--drag-y', `${gesture.dragY / view.scale}px`);
  if (Date.now() - gesture.sentAt >= SCROLL_SEND_MS) flushScroll(gesture);
}

function onUp(e, cancelled = false) {
  if (!pointers.delete(e.pointerId) || !gesture) return;
  const g = gesture;
  if (g.kind === 'pinch') {
    if (!pointers.size) gesture = null;
    return;
  }
  gesture = null;
  if (g.kind === 'scroll') { flushScroll(g); return; }
  if (cancelled || Date.now() - g.t0 > TAP_MAX_MS) return;
  const p = pointIn(g.x0, g.y0);
  const tab = activeTab();
  if (!p || !tab?.wc) return;
  ripple(g.x0, g.y0);
  sendInput({ type: 'tap', wc: tab.wc, fx: p.fx, fy: p.fy });
  poke();
}

// ---------------------------------------------------------------- toolbar and keyboard

function renderBar() {
  const t = store.tabs;
  const tab = activeTab();
  bar.querySelector('[data-act=back]').disabled = !t?.canBack;
  bar.querySelector('[data-act=forward]').disabled = !t?.canForward;
  if (document.activeElement === addrInput) return;
  let secure = false;
  let label = 'Search or enter website';
  if (tab?.url) {
    try {
      const u = new URL(tab.url);
      secure = u.protocol === 'https:';
      label = u.hostname.replace(/^www\./, '') || tab.url;
    } catch { label = tab.url; }
  }
  addrBtn.replaceChildren(h('span', { class: 'addr-icon', html: icon(tab?.url ? (secure ? 'lock' : 'globe') : 'search', 14) }), h('span', { class: `addr-text${tab?.url ? '' : ' placeholder'}` }, label));
  addrBtn.classList.toggle('loading', !!tab?.loading);
}

function editAddress() {
  const tab = activeTab();
  addrInput.value = tab?.url || '';
  addrBtn.hidden = true;
  addrInput.hidden = false;
  addrInput.focus();
  addrInput.select();
}

function endAddress() {
  addrInput.hidden = true;
  addrBtn.hidden = false;
  renderBar();
}

async function go(text) {
  if (!text.trim()) return;
  addrInput.blur();
  if (await command('tab.navigate', { text })) poke(600);
}

function typeText() {
  const tab = activeTab();
  const text = keyInput.value;
  if (!tab?.wc) { toast('Open a page first.'); return; }
  if (!text) return;
  keyInput.value = '';
  sendInput({ type: 'text', wc: tab.wc, text });
  poke();
}

function key(name) {
  const tab = activeTab();
  if (!tab?.wc) return;
  if (keyInput.value) typeText();
  sendInput({ type: 'key', wc: tab.wc, key: name });
  poke();
}

function toggleKeys() {
  keyBar.hidden = !keyBar.hidden;
  bar.querySelector('[data-act=keys]').classList.toggle('on', !keyBar.hidden);
  if (!keyBar.hidden) keyInput.focus();
}

const navBtn = (act, ic, label, fn) => h('button', { class: 'tool', dataset: { act }, 'aria-label': label, html: icon(ic, 20), onclick: fn });

export function mount() {
  addrBtn = h('button', { class: 'addr', onclick: editAddress });
  addrInput = h('input', { class: 'addr-input', hidden: true, type: 'url', inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', placeholder: 'Search or enter website' });
  addrInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(addrInput.value); } });
  addrInput.addEventListener('blur', endAddress);
  bar = h('div', { class: 'screen-bar' },
    navBtn('back', 'back', 'Back', () => { command('tab.back'); poke(500); }),
    navBtn('forward', 'forward', 'Forward', () => { command('tab.forward'); poke(500); }),
    addrBtn, addrInput,
    navBtn('reload', 'reload', 'Reload', () => { command('tab.reload'); poke(800); }),
    navBtn('keys', 'keyboard', 'Keyboard', toggleKeys));

  img = h('img', { class: 'frame-img', alt: 'Current page', draggable: 'false' });
  frame = h('div', { class: 'frame' }, img);
  hint = h('div', { class: 'screen-hint', hidden: true });
  stage = h('div', { class: 'stage' }, frame, hint);
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', (e) => onUp(e));
  stage.addEventListener('pointercancel', (e) => onUp(e, true));

  keyInput = h('input', { class: 'field', placeholder: 'Type into the page', autocapitalize: 'off', enterkeyhint: 'send' });
  keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); typeText(); } });
  const keyBtn = (name, ic, label) => h('button', { class: 'key', 'aria-label': label, title: label, html: ic ? icon(ic, 18) : null, onclick: () => key(name) }, ic ? null : label);
  keyBar = h('div', { class: 'key-bar', hidden: true },
    h('div', { class: 'key-row' }, keyInput, h('button', { class: 'btn primary', onclick: typeText }, 'Type')),
    h('div', { class: 'key-row keys' }, keyBtn('Enter', 'enter', 'Enter'), keyBtn('Backspace', 'backspace', 'Delete'), keyBtn('Tab', null, 'Tab'), keyBtn('Escape', null, 'Esc'), keyBtn('Up', null, '↑'), keyBtn('Down', null, '↓')));

  root = h('section', { class: 'view screen-view' }, bar, stage, keyBar);
  document.addEventListener('visibilitychange', () => { if (visible && !document.hidden) schedule(0); });
  return root;
}

export function update(part) {
  if (part !== 'tabs') return;
  renderBar();
  const tab = activeTab();
  if (visible && tab?.wc !== frameWc) {
    view = { scale: 1, x: 0, y: 0 };
    applyView();
    schedule(0);
  }
}

export const title = () => activeTab()?.title || 'Screen';

export function shown() {
  visible = true;
  renderBar();
  schedule(0);
}

export function hidden() {
  visible = false;
  clearTimeout(timer);
  timer = 0;
}
