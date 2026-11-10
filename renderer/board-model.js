// Whiteboards: saved boards live in the "boards" store; a temporary board lives only in memory and
// is gone once closed. Elements are plain objects so the agent can write them as JSON.
import { PRIVATE } from './state.js';
import { uid } from './util.js';
import dagre from './vendor/dagre.js';
import { SHAPES, ROUTES, SIDES, STICKY_FONT, connectorGeometry, boxOfPoints, fitShape } from './board-geometry.js';
import { DIRECTIONS, layoutDiagram, placeNew, fitFrames } from './board-layout.js';

export const COLORS = {
  ink: 'var(--text)', gray: '#8e8e93', blue: '#0a84ff', red: '#ff453a',
  green: '#30d158', orange: '#ff9f0a', purple: '#bf5af2', yellow: '#ffd60a',
};
export const STICKY_FILLS = { yellow: '#fff1a8', blue: '#cfe6ff', green: '#d3f5dc', red: '#ffd6d3', orange: '#ffe2bf', purple: '#ecd9ff', gray: '#e5e5ea', ink: '#e5e5ea' };
export const TYPES = [...SHAPES, 'frame', 'line', 'arrow', 'text', 'sticky', 'path', 'image'];
// Default size of each box element: [w, h].
const BOX_SIZE = {
  rect: [160, 80], ellipse: [160, 90], diamond: [160, 100], pill: [160, 60], parallelogram: [170, 80], hexagon: [170, 80],
  cylinder: [120, 100], document: [160, 90], cloud: [180, 110], actor: [40, 70], triangle: [120, 100], frame: [400, 280], sticky: [180, 120],
};
const MAX_IMAGE_CHARS = 4 * 1024 * 1024; // a data: URL this long is ~3 MB
const USER_SETTLE = 1500; // ms of quiet after the user's last edit before the agent looks
const MAX_ELEMENTS = 2000;
const MAX_UNDO = 100;
const SAVE_DELAY = 500; // ms

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
  const entry = { id: current.id, title: current.title, elements: current.elements, direction: current.direction, updated: Date.now() };
  boards = [...boards.filter((b) => b.id !== current.id), entry];
  persist();
}

export function newBoard({ title, temporary = false, elements = [] } = {}) {
  current = { id: uid(), title: title || (temporary ? 'Temporary board' : 'Untitled board'), temporary: temporary || PRIVATE, elements, undo: [], redo: [] };
  syncSaved();
  emit('open');
  return current;
}

export function openBoard(id) {
  const b = boards.find((x) => x.id === id);
  if (!b) return null;
  current = { id: b.id, title: b.title, temporary: false, elements: b.elements || [], direction: b.direction, undo: [], redo: [] };
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
const CONNECTORS = new Set(['line', 'arrow']);
export const isConnector = (e) => CONNECTORS.has(e?.type);
// Anything a connector can attach to.
export const isBox = (e) => !!e && !isConnector(e) && e.type !== 'path';

// Cleans one element from the agent or the UI into the stored shape.
export function normalize(raw, by = 'user') {
  const type = TYPES.includes(raw?.type) ? raw.type : null;
  if (!type) throw new Error(`Unknown element type "${raw?.type}". Use one of: ${TYPES.join(', ')}.`);
  const el = { id: String(raw.id || uid()), type, by: raw.by || by, color: colorOf(raw.color, type === 'sticky' ? 'yellow' : type === 'frame' ? 'gray' : 'ink') };
  if (raw.text != null) el.text = String(raw.text).slice(0, 4000);
  el.size = num(raw.size, 2) > 3 ? 4 : 2;
  if (raw.parent != null && raw.parent !== '' && !CONNECTORS.has(type)) el.parent = String(raw.parent);
  if (type === 'path') {
    el.points = (Array.isArray(raw.points) ? raw.points : []).filter((p) => Array.isArray(p) && p.length >= 2).map(([x, y]) => [num(x), num(y)]).slice(0, 4000);
    if (el.points.length < 2) throw new Error('A path needs at least two [x, y] points.');
    return el;
  }
  el.x = num(raw.x);
  el.y = num(raw.y);
  if (CONNECTORS.has(type)) {
    if (raw.from) el.from = String(raw.from);
    if (raw.to) el.to = String(raw.to);
    el.x2 = num(raw.x2, el.x + 160);
    el.y2 = num(raw.y2, el.y);
    el.route = ROUTES.includes(raw.route) ? raw.route : el.from && el.to ? 'orthogonal' : 'straight';
    if (SIDES.includes(raw.fromSide)) el.fromSide = raw.fromSide;
    if (SIDES.includes(raw.toSide)) el.toSide = raw.toSide;
    if (raw.dash) el.dash = true;
    if (raw.both && type === 'arrow') el.both = true;
    return el;
  }
  // Shapes the agent didn't place get a position from the auto-layout (see apply).
  if (raw.x == null || raw.y == null) el.unplaced = true;
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
  const [w, h] = BOX_SIZE[type] || BOX_SIZE.rect;
  el.w = Math.max(20, num(raw.w, w));
  el.h = Math.max(20, num(raw.h, h));
  if (raw.fill && type !== 'sticky') el.fill = colorOf(raw.fill, 'none');
  if (raw.fontSize != null && type !== 'sticky') el.fontSize = Math.max(10, Math.min(48, num(raw.fontSize, 15)));
  return el;
}

const withoutFlags = ({ unplaced, ...e }) => e;
const NODE_LAYOUT_TYPES = (e) => isBox(e) && e.type !== 'frame';

// ---------------------------------------------------------------- label sizing

const FITTED = new Set([...SHAPES.filter((k) => k !== 'actor'), 'sticky']);
const TEXT_SLACK = 1.05; // canvas widths run a little under the DOM's; never clip by a pixel
let textCanvas = null;

function measurer(fontSize) {
  textCanvas ||= document.createElement('canvas').getContext('2d');
  const font = `600 ${fontSize}px ${getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'}`;
  return (s) => {
    textCanvas.font = font;
    return textCanvas.measureText(s).width * TEXT_SLACK;
  };
}

// A shape the agent labels without giving it a size grows to fit the label instead of clipping it.
// One already on the board that isn't being moved grows around its center.
function fitLabel(el, raw, prev) {
  if (!FITTED.has(el.type) || !el.text || raw?.text == null || raw.w != null || raw.h != null) return el;
  const fontSize = el.type === 'sticky' ? STICKY_FONT : el.fontSize || 15;
  const { w, h } = fitShape(el.type, el.text, { w: el.w, h: el.h, fontSize, measure: measurer(fontSize) });
  if (w === el.w && h === el.h) return el;
  const recentered = prev && raw.x == null && raw.y == null;
  return recentered ? { ...el, w, h, x: el.x - (w - el.w) / 2, y: el.y - (h - el.h) / 2 } : { ...el, w, h };
}

// Agent edits: add or replace by id, remove ids, optionally start from a clean board, optionally lay the
// diagram out. Shapes sent without x/y are placed automatically: a new diagram gets a full layout, an
// existing one keeps its shapes and the new ones go next to whatever they connect to.
export function apply({ elements = [], remove = [], clear = false, layout = null }, by = 'ai') {
  if (!current) throw new Error('No board is open.');
  const drop = new Set(remove.map(String));
  const base = clear ? [] : current.elements.filter((e) => !drop.has(e.id) && !drop.has(e.from) && !drop.has(e.to));
  // A cleared board forgets which way its old diagram flowed.
  if (clear) current.direction = undefined;
  const byId = new Map(base.map((e) => [e.id, e]));
  // An update only changes what it names; the element keeps its other fields and its author.
  const incoming = elements.map((raw) => {
    const prev = raw?.id != null ? byId.get(String(raw.id)) : null;
    return fitLabel(normalize(prev ? { ...prev, ...raw, by: prev.by } : raw, by), raw, prev);
  });
  const existed = new Set(byId.keys());
  for (const e of incoming) byId.set(e.id, e);
  // A connector naming a shape that isn't there would be drawn from a corner of the board.
  for (const c of incoming.filter(isConnector)) {
    for (const end of ['from', 'to']) {
      if (c[end] && !byId.has(c[end])) throw new Error(`Connector "${c.id}": ${end} "${c[end]}" is not an element on the board. Use one of: ${[...byId.keys()].slice(0, 40).join(', ')}.`);
    }
  }
  let list = [...byId.values()];
  const direction = DIRECTIONS.includes(layout) ? layout : layout === true ? current.direction || 'TB' : null;
  const unplaced = new Set(incoming.filter((e) => e.unplaced && NODE_LAYOUT_TYPES(e)).map((e) => e.id));
  const linked = new Set(list.filter((e) => isConnector(e) && e.from && e.to).flatMap((c) => [c.from, c.to]));
  const hasDiagram = list.some((e) => linked.has(e.id) && NODE_LAYOUT_TYPES(e) && !e.unplaced);
  if (direction) {
    list = layoutDiagram(list, { direction }, dagre, bounds);
    current.direction = direction;
  } else if (unplaced.size) {
    const flow = current.direction || 'TB';
    list = hasDiagram ? placeNew(list, unplaced, { direction: flow }, bounds) : layoutDiagram(list, { direction: flow }, dagre, bounds);
    // Connectors route along the direction the diagram was laid out in.
    if (!hasDiagram) current.direction = flow;
  }
  // Frames the agent didn't size wrap the shapes that name them as parent.
  const fit = new Set(incoming.filter((e) => e.type === 'frame' && !existed.has(e.id) && (e.unplaced || !elements.find((r) => String(r?.id) === e.id)?.w)).map((e) => e.id));
  if (fit.size) list = fitFrames(list, bounds, fit);
  commit(list.map(withoutFlags), { why: 'ai' });
  return incoming.map((e) => e.id);
}

// Re-arranges the whole diagram (the "Tidy up" button and the agent's layout option).
export function arrange(direction = current?.direction || 'TB') {
  if (!current) return;
  current.direction = direction;
  commit(layoutDiagram(current.elements, { direction }, dagre, bounds).map(withoutFlags), { why: 'ai' });
}

export function bounds(el, all = current?.elements || []) {
  if (el.type === 'path') return boxOfPoints(el.points);
  if (isConnector(el)) return boxOfPoints(connector(el, all).points);
  if (el.type === 'text') return { x: el.x, y: el.y, w: el.w, h: el.h || el.fontSize * 1.5 };
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

// Shapes whose connectors tell which way a diagram flows.
const isFlowShape = (e) => isBox(e) && e.type !== 'frame';
const ROUTE_REACH = 60; // px around a connector's two shapes where other shapes can be in its way
const FLOW_SHARE = 0.8;
const inferred = new WeakMap(); // elements array -> flow

// The direction a board's diagram flows in: the one it was laid out in, otherwise the one nearly all
// of its connectors follow (an older or hand-drawn top-down diagram still routes top-down).
function flowOf(all) {
  if (current?.direction) return current.direction;
  if (!inferred.has(all)) {
    const shapes = new Map(all.filter(isFlowShape).map((e) => [e.id, bounds(e, all)]));
    const pairs = all.filter((c) => isConnector(c) && c.from !== c.to && shapes.has(c.from) && shapes.has(c.to)).map((c) => [shapes.get(c.from), shapes.get(c.to)]);
    const down = pairs.filter(([a, b]) => b.y > a.y + a.h).length;
    const right = pairs.filter(([a, b]) => b.x > a.x + a.w).length;
    const need = Math.max(2, pairs.length * FLOW_SHARE);
    inferred.set(all, down >= need && down > right ? 'TB' : right >= need && right > down ? 'LR' : null);
  }
  return inferred.get(all);
}

// How a connector runs right now (it follows the shapes it is attached to, around the ones in its way).
export function connector(el, all = current?.elements || []) {
  const self = el.from && el.from === el.to;
  const end = (id, side, point, fallbackSide) => {
    const e = id && all.find((x) => x.id === id);
    return isBox(e) ? { box: bounds(e, all), kind: e.type, side: side || fallbackSide } : { point };
  };
  // A loop back into the same shape leaves on the right and comes back in from the top.
  const from = end(el.from, el.fromSide, [el.x, el.y], self ? 'right' : null);
  const to = end(el.to, el.toSide, [el.x2, el.y2], self ? 'top' : null);
  let obstacles = [];
  if (el.route === 'orthogonal' && from.box && to.box) {
    const x1 = Math.min(from.box.x, to.box.x) - ROUTE_REACH;
    const y1 = Math.min(from.box.y, to.box.y) - ROUTE_REACH;
    const x2 = Math.max(from.box.x + from.box.w, to.box.x + to.box.w) + ROUTE_REACH;
    const y2 = Math.max(from.box.y + from.box.h, to.box.y + to.box.h) + ROUTE_REACH;
    // Frames count too, unless the connector starts or ends inside them.
    const around = (f) => [from.box, to.box].some((b) => b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h);
    obstacles = all.filter((e) => isBox(e) && e.id !== el.from && e.id !== el.to).map((e) => ({ e, b: bounds(e, all) }))
      .filter(({ e, b }) => b.x < x2 && b.x + b.w > x1 && b.y < y2 && b.y + b.h > y1 && (e.type !== 'frame' || !around(b)))
      .map(({ b }) => b);
  }
  return connectorGeometry(el.route || 'straight', from, to, { obstacles, flow: flowOf(all) });
}

// Compact description for the agent (whiteboard_read).
export function describeElements(list = current?.elements || []) {
  const all = current?.elements || list;
  return list.map((e) => {
    const b = bounds(e, all);
    const label = e.text || e.alt;
    const text = label ? ` "${label.replace(/\s+/g, ' ').slice(0, 120)}"` : '';
    const link = isConnector(e) ? ` ${e.from || 'loose'}${e.fromSide ? `.${e.fromSide}` : ''} → ${e.to || 'loose'}${e.toSide ? `.${e.toSide}` : ''} ${e.route || 'straight'}${e.dash ? ' dashed' : ''}${e.both ? ' two-way' : ''}` : '';
    const where = e.type === 'path' ? `freehand stroke in box ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}`
      : isConnector(e) ? '' : ` at ${Math.round(b.x)},${Math.round(b.y)} size ${Math.round(b.w)}×${Math.round(b.h)}`;
    const extra = `${e.fill && e.fill !== 'none' ? ` fill=${e.fill}` : ''}${e.parent ? ` in=${e.parent}` : ''}`;
    return `- id=${e.id} ${e.type}${text}${link}${where} color=${e.color}${extra}${e.by === 'ai' ? ' (yours)' : ' (user)'}`;
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
