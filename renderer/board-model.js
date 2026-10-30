// Whiteboards: saved boards live in the "boards" store; a temporary board lives only in memory and
// is gone once closed. Elements are plain objects so the agent can write them as JSON.
import { PRIVATE } from './state.js';
import { uid } from './util.js';

export const COLORS = {
  ink: 'var(--text)', gray: '#8e8e93', blue: '#0a84ff', red: '#ff453a',
  green: '#30d158', orange: '#ff9f0a', purple: '#bf5af2', yellow: '#ffd60a',
};
export const STICKY_FILLS = { yellow: '#fff1a8', blue: '#cfe6ff', green: '#d3f5dc', red: '#ffd6d3', orange: '#ffe2bf', purple: '#ecd9ff', gray: '#e5e5ea', ink: '#e5e5ea' };
export const TYPES = ['rect', 'ellipse', 'line', 'arrow', 'text', 'sticky', 'path', 'image'];
const MAX_IMAGE_CHARS = 4 * 1024 * 1024; // a data: URL this long is ~3 MB
const USER_SETTLE = 1500; // ms of quiet after the user's last edit before the agent looks
const MAX_ELEMENTS = 2000;
const MAX_UNDO = 100;
const SAVE_DELAY = 500; // ms
const STICKY = { w: 180, h: 120 };

let boards = []; // saved boards: { id, title, elements, updated }
let current = null; // { id, title, temporary, elements, undo, redo }
let seen = new Map(); // what the agent last saw: id -> serialized element
let presence = null; // name of the agent working on the board, if any
const listeners = new Set();
let saveTimer = null;

export const onBoardChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (why) => listeners.forEach((fn) => fn(why));
export const currentBoard = () => current;
export const savedBoards = () => [...boards].sort((a, b) => b.updated - a.updated);

export async function initBoards() {
  if (PRIVATE) return;
  const saved = await window.lumen.store.read('boards').catch(() => null);
  boards = Array.isArray(saved) ? saved : [];
}

function persist() {
  if (PRIVATE) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.lumen.store.write('boards', boards), SAVE_DELAY);
}

function syncSaved() {
  if (!current || current.temporary) return;
  const entry = { id: current.id, title: current.title, elements: current.elements, updated: Date.now() };
  boards = [...boards.filter((b) => b.id !== current.id), entry];
  persist();
}

export function newBoard({ title, temporary = false } = {}) {
  current = { id: uid(), title: title || (temporary ? 'Temporary board' : 'Untitled board'), temporary: temporary || PRIVATE, elements: [], undo: [], redo: [] };
  syncSaved();
  emit('open');
  return current;
}

export function openBoard(id) {
  const b = boards.find((x) => x.id === id);
  if (!b) return null;
  current = { id: b.id, title: b.title, temporary: false, elements: b.elements || [], undo: [], redo: [] };
  emit('open');
  return current;
}

// A temporary board is erased completely; a saved one stays in the list.
export function closeBoard() {
  current = null;
  emit('close');
}

export function renameBoard(title) {
  if (!current) return;
  current.title = String(title || '').trim().slice(0, 80) || current.title;
  syncSaved();
  emit('meta');
}

export function keepBoard() {
  if (!current || PRIVATE) return;
  current.temporary = false;
  if (current.title === 'Temporary board') current.title = 'Untitled board';
  syncSaved();
  emit('meta');
}

export function deleteBoard(id) {
  boards = boards.filter((b) => b.id !== id);
  persist();
  if (current?.id === id) closeBoard();
  else emit('meta');
}

// Every change goes through here: undo history, saving, re-render.
export function commit(elements, { why = 'edit', record = true } = {}) {
  if (!current) return;
  if (record) {
    current.undo = [...current.undo.slice(-MAX_UNDO + 1), current.elements];
    current.redo = [];
  }
  current.elements = elements.slice(-MAX_ELEMENTS);
  syncSaved();
  emit(why);
}

export function undo() {
  if (!current?.undo.length) return;
  current.redo = [...current.redo, current.elements];
  current.elements = current.undo.at(-1);
  current.undo = current.undo.slice(0, -1);
  syncSaved();
  emit('edit');
}

export function redo() {
  if (!current?.redo.length) return;
  current.undo = [...current.undo, current.elements];
  current.elements = current.redo.at(-1);
  current.redo = current.redo.slice(0, -1);
  syncSaved();
  emit('edit');
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const colorOf = (c, d = 'ink') => (COLORS[c] || /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : d);

// Cleans one element from the agent or the UI into the stored shape.
export function normalize(raw, by = 'user') {
  const type = TYPES.includes(raw?.type) ? raw.type : null;
  if (!type) throw new Error(`Unknown element type "${raw?.type}". Use one of: ${TYPES.join(', ')}.`);
  const el = { id: String(raw.id || uid()), type, by: raw.by || by, color: colorOf(raw.color, type === 'sticky' ? 'yellow' : 'ink') };
  if (raw.text != null) el.text = String(raw.text).slice(0, 4000);
  el.size = num(raw.size, 2) > 3 ? 4 : 2;
  if (type === 'path') {
    el.points = (Array.isArray(raw.points) ? raw.points : []).filter((p) => Array.isArray(p) && p.length >= 2).map(([x, y]) => [num(x), num(y)]).slice(0, 4000);
    if (el.points.length < 2) throw new Error('A path needs at least two [x, y] points.');
    return el;
  }
  el.x = num(raw.x);
  el.y = num(raw.y);
  if (type === 'line' || type === 'arrow') {
    if (raw.from) el.from = String(raw.from);
    if (raw.to) el.to = String(raw.to);
    el.x2 = num(raw.x2, el.x + 160);
    el.y2 = num(raw.y2, el.y);
    return el;
  }
  if (type === 'image') {
    const src = String(raw.src || '');
    if (!/^(data:image\/|https?:\/\/)/i.test(src)) throw new Error('An image needs src: an http(s) URL, "screenshot", or a data:image URL.');
    if (src.length > MAX_IMAGE_CHARS) throw new Error('That image is too large.');
    el.src = src;
    if (raw.alt) el.alt = String(raw.alt).slice(0, 200);
    el.w = Math.max(20, num(raw.w, 320));
    el.h = Math.max(20, num(raw.h, 220));
    return el;
  }
  if (type === 'text') {
    el.fontSize = Math.max(10, Math.min(96, num(raw.fontSize, 18)));
    el.w = Math.max(40, num(raw.w, 320));
    return el;
  }
  el.w = Math.max(20, num(raw.w, type === 'sticky' ? STICKY.w : 160));
  el.h = Math.max(20, num(raw.h, type === 'sticky' ? STICKY.h : 100));
  if (raw.fill && type !== 'sticky') el.fill = colorOf(raw.fill, 'none');
  return el;
}

// Agent edits: add or replace by id, remove ids, optionally start from a clean board.
export function apply({ elements = [], remove = [], clear = false }, by = 'ai') {
  if (!current) throw new Error('No board is open.');
  const drop = new Set(remove.map(String));
  const base = clear ? [] : current.elements.filter((e) => !drop.has(e.id));
  const byId = new Map(base.map((e) => [e.id, e]));
  // An update only changes what it names; the element keeps its other fields and its author.
  const incoming = elements.map((raw) => {
    const prev = raw?.id != null ? byId.get(String(raw.id)) : null;
    return normalize(prev ? { ...prev, ...raw, by: prev.by } : raw, by);
  });
  for (const e of incoming) byId.set(e.id, e);
  commit([...byId.values()], { why: 'ai' });
  return incoming.map((e) => e.id);
}

export function bounds(el, all = current?.elements || []) {
  if (el.type === 'path') {
    const xs = el.points.map((p) => p[0]);
    const ys = el.points.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (el.type === 'line' || el.type === 'arrow') {
    const [a, b] = endpoints(el, all);
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
  }
  if (el.type === 'text') return { x: el.x, y: el.y, w: el.w, h: el.h || el.fontSize * 1.5 };
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

// Where a connector leaves/enters a shape: on its edge, towards the other end.
function edgePoint(el, toward, all) {
  const b = bounds(el, all);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (!dx && !dy) return [cx, cy];
  if (el.type === 'ellipse') {
    const t = 1 / Math.sqrt((dx * dx) / ((b.w / 2) ** 2) + (dy * dy) / ((b.h / 2) ** 2));
    return [cx + dx * t, cy + dy * t];
  }
  const t = Math.min((b.w / 2) / Math.abs(dx || 1e-9), (b.h / 2) / Math.abs(dy || 1e-9));
  return [cx + dx * t, cy + dy * t];
}

export function endpoints(el, all = current?.elements || []) {
  const from = el.from && all.find((e) => e.id === el.from && e.type !== 'line' && e.type !== 'arrow');
  const to = el.to && all.find((e) => e.id === el.to && e.type !== 'line' && e.type !== 'arrow');
  const center = (e) => { const b = bounds(e, all); return [b.x + b.w / 2, b.y + b.h / 2]; };
  let a = [el.x, el.y];
  let z = [el.x2, el.y2];
  if (from && to) { a = edgePoint(from, center(to), all); z = edgePoint(to, center(from), all); } else if (from) a = edgePoint(from, z, all);
  else if (to) z = edgePoint(to, a, all);
  return [a, z];
}

// Compact description for the agent (whiteboard_read).
export function describeElements(list = current?.elements || []) {
  return list.map((e) => {
    const b = bounds(e, list);
    const label = e.text || e.alt;
    const text = label ? ` "${label.replace(/\s+/g, ' ').slice(0, 120)}"` : '';
    const link = e.from || e.to ? ` ${e.from || '?'} → ${e.to || '?'}` : '';
    const where = e.type === 'path' ? `freehand stroke in box ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}` : `at ${Math.round(b.x)},${Math.round(b.y)} size ${Math.round(b.w)}×${Math.round(b.h)}`;
    return `- id=${e.id} ${e.type}${text}${link} ${where} color=${e.color}${e.by === 'ai' ? ' (yours)' : ' (user)'}`;
  }).join('\n');
}

// ---------------------------------------------------------------- working together with the agent

export function setPresence(name) {
  if (presence === name) return;
  presence = name;
  emit('meta');
}
export const agentPresence = () => presence;

const serialize = (e) => JSON.stringify(e);

// The agent has seen the board as it is now; later diffs only show what the user changed.
export function markSeen() {
  seen = new Map((current?.elements || []).map((e) => [e.id, serialize(e)]));
}

export function userChanges() {
  const now = current?.elements || [];
  const ids = new Set(now.map((e) => e.id));
  return {
    added: now.filter((e) => !seen.has(e.id)),
    changed: now.filter((e) => seen.has(e.id) && seen.get(e.id) !== serialize(e)),
    removed: [...seen.keys()].filter((id) => !ids.has(id)),
  };
}

export function describeChanges(ch = userChanges()) {
  const lines = [];
  if (ch.added.length) lines.push(`Added:\n${describeElements(ch.added)}`);
  if (ch.changed.length) lines.push(`Changed (moved, resized or edited):\n${describeElements(ch.changed)}`);
  if (ch.removed.length) lines.push(`Deleted: ${ch.removed.join(', ')}`);
  return lines.join('\n');
}

// Resolves once the user has edited the board and then paused, or after `ms`, or when `stop()` says so.
export function waitForUser(ms, stop = () => false) {
  return new Promise((resolve) => {
    let settle = null;
    const finish = (why) => { off(); clearTimeout(settle); clearTimeout(limit); clearInterval(poll); resolve(why); };
    const off = onBoardChange((why) => {
      if (why !== 'edit') return;
      clearTimeout(settle);
      settle = setTimeout(() => finish('user'), USER_SETTLE);
    });
    const limit = setTimeout(() => finish('timeout'), ms);
    const poll = setInterval(() => { if (stop()) finish('stopped'); }, 300);
  });
}
