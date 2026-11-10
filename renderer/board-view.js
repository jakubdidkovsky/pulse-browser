// The whiteboard over the page area: draw.io-style diagrams (shapes, frames, connectors that stay attached),
// freehand, text, sticky notes and images, and the AI agent draws here too. The toolbar button
// shows/hides it; × closes it (a temporary board is erased).
import { h, $, scaledImage, readFileUrl, uid } from './util.js';
import { icon } from './icons.js';
import { showMenu, toast, confirmDialog } from './ui.js';
import * as B from './board-model.js';
import { GRID, SIDES, snap, sidePoint } from './board-geometry.js';
import { placeNew } from './board-layout.js';
import { toDrawio, fromDrawio } from './board-drawio.js';
import { svg, shape, selection, quickConnect, dropTarget, gridLayer, shapeIcon } from './board-render.js';
import { shapePicker, formatBar } from './board-format.js';

const TOOLS = [
  ['select', 'Select & move (V). Drag on empty space to select several.', 'cursor', 'v'],
  ['pen', 'Pen (P)', 'compose', 'p'],
  ['arrow', 'Connector (A). Start and end on shapes to connect them; it follows them when they move.', 'arrowRight', 'a'],
  ['shape', 'Shapes (R rectangle, O ellipse, D decision). Click again for more shapes.', null, null],
  ['frame', 'Frame (F): a titled group. Moving it moves everything inside.', 'window', 'f'],
  ['text', 'Text (T)', 'textT', 't'],
  ['sticky', 'Sticky note (N)', 'sticky', 'n'],
  ['eraser', 'Eraser (E)', 'eraser', 'e'],
];
const SHAPE_KEYS = { r: 'rect', o: 'ellipse', d: 'diamond' };
const PALETTE = ['ink', 'blue', 'red', 'green', 'orange', 'purple'];
const MIN_DRAG = 4; // px before a click becomes a drag
const PEN_STEP = 2; // px between recorded pen points
const PORT_SNAP = 16; // px (screen) from a connection point that attaches a connector to that side
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const FIT_PAD = 40;
const BAR_SPACE = { top: 50, bottom: 70 }; // px the board's title bar and toolbar cover
const PASTE_OFFSET = 30;
const CLIP_PREFIX = 'pulse-board:';
const IMAGE_MAX_SIDE = 1600; // px kept when an image is stored on the board
const IMAGE_SHOWN = 420; // px longest side when placed
const JPEG_QUALITY = 0.86;
const SIDE_FLOW = { right: 'LR', bottom: 'TB', left: 'RL', top: 'BT' };

const ui = { root: null, svg: null, grid: null, scene: null, editor: null, title: null, tools: null, format: null, empty: null, presence: null, file: null, drawio: null };
// selected: ids; drafts: elements being drawn/moved, shown in place of the stored ones until committed.
const st = {
  tool: 'select', shape: 'rect', color: 'ink', size: 2, route: 'orthogonal', view: { x: 0, y: 0, zoom: 1 },
  selected: [], drafts: [], marquee: null, erasing: null, hover: null, drop: null, shown: new Set(), visible: false,
};
// What the format bar may change for the next shapes and connectors.
const defaults = { get shape() { return st.shape; }, set shape(k) { st.shape = k; }, get route() { return st.route; }, set route(r) { st.route = r; } };

const elementsNow = () => B.currentBoard()?.elements || [];
const byId = (id, all = elementsNow()) => all.find((e) => e.id === id);

// ---------------------------------------------------------------- coordinates

function world(e) {
  const r = ui.svg.getBoundingClientRect();
  return { x: st.view.x + (e.clientX - r.left) / st.view.zoom, y: st.view.y + (e.clientY - r.top) / st.view.zoom };
}

function applyView() {
  const r = ui.svg.getBoundingClientRect();
  const w = Math.max(1, r.width / st.view.zoom);
  const hgt = Math.max(1, r.height / st.view.zoom);
  ui.svg.setAttribute('viewBox', `${st.view.x} ${st.view.y} ${w} ${hgt}`);
  for (const [k, v] of Object.entries({ x: st.view.x, y: st.view.y, width: w, height: hgt })) ui.grid.setAttribute(k, v);
}

export function fitView() {
  const b = B.currentBoard();
  const r = ui.svg?.getBoundingClientRect();
  if (!b || !r?.width) return;
  if (!b.elements.length) { st.view = { x: 0, y: 0, zoom: 1 }; applyView(); return; }
  const boxes = b.elements.map((e) => B.bounds(e, b.elements));
  const x1 = Math.min(...boxes.map((x) => x.x)) - FIT_PAD;
  const y1 = Math.min(...boxes.map((x) => x.y)) - FIT_PAD;
  const x2 = Math.max(...boxes.map((x) => x.x + x.w)) + FIT_PAD;
  const y2 = Math.max(...boxes.map((x) => x.y + x.h)) + FIT_PAD;
  // The title bar and the toolbars float over the top and bottom of the canvas; keep the drawing between them.
  const usable = Math.max(100, r.height - BAR_SPACE.top - BAR_SPACE.bottom);
  const zoom = Math.max(ZOOM_MIN, Math.min(1.25, r.width / (x2 - x1), usable / (y2 - y1)));
  st.view = { zoom, x: (x1 + x2) / 2 - r.width / zoom / 2, y: (y1 + y2) / 2 - (BAR_SPACE.top + usable / 2) / zoom };
  applyView();
}

// ---------------------------------------------------------------- drawing

// Frames go under everything else, so shapes inside them stay clickable.
const stacked = (all) => [...all.filter((e) => e.type === 'frame'), ...all.filter((e) => e.type !== 'frame')];

export function render(why) {
  const b = B.currentBoard();
  if (!ui.root) return;
  ui.root.classList.toggle('show', !!b && st.visible);
  $('#btn-board')?.classList.toggle('on', !!b && st.visible);
  if (!b) return;
  ui.title.value = b.title;
  const who = B.agentPresence();
  ui.presence.textContent = who ? `${who} is here` : '';
  ui.presence.classList.toggle('on', !!who);
  ui.root.classList.toggle('temporary', b.temporary);
  ui.tools.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === st.tool));
  ui.tools.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x.dataset.color === st.color));
  ui.tools.querySelector('[data-tool="shape"]')?.replaceChildren(shapeIcon(st.shape, 17));
  ui.root.dataset.tool = st.tool;
  const over = new Map(st.drafts.map((d) => [d.id, d]));
  const stored = new Set(b.elements.map((e) => e.id));
  const all = [...b.elements.map((e) => over.get(e.id) || e), ...st.drafts.filter((d) => !stored.has(d.id))];
  const nodes = stacked(all).filter((e) => !st.erasing?.has(e.id)).map((e) => {
    const g = shape(e, all);
    if (why === 'ai' && !st.shown.has(e.id)) g.classList.add('fresh');
    return g;
  });
  const sel = all.filter((e) => st.selected.includes(e.id));
  const m = st.marquee;
  const hovered = st.tool === 'select' && !drag && st.hover && byId(st.hover, all);
  const target = st.drop && byId(st.drop.id, all);
  ui.scene.replaceChildren(...nodes, ...sel.map((e) => selection(e, all, sel.length === 1)),
    ...(hovered ? [quickConnect(hovered, all, st.view.zoom)] : []),
    ...(target ? [dropTarget(target, all, st.drop.side, st.view.zoom)] : []),
    ...(m ? [svg('rect', { x: m.x, y: m.y, width: m.w, height: m.h, class: 'marquee' })] : []));
  st.shown = new Set(b.elements.map((e) => e.id));
  ui.empty.style.display = all.length ? 'none' : '';
  renderFormat(b.elements.filter((e) => st.selected.includes(e.id)));
  applyView();
}

function renderFormat(selected) {
  const show = st.tool === 'select' && selected.length && !drag;
  ui.format.replaceChildren(...(show ? [formatBar({ selected, update: updateSelected, act, place, defaults })] : []));
}

function updateSelected(fn) {
  const ids = new Set(st.selected);
  B.commit(elementsNow().map((e) => (ids.has(e.id) ? B.normalize(fn(e)) : e)));
}

function place(positions) {
  B.commit(elementsNow().map((e) => (positions.has(e.id) ? { ...e, ...positions.get(e.id) } : e)));
}

function act(name) {
  const all = elementsNow();
  const ids = new Set(st.selected);
  if (name === 'delete') { st.selected = []; B.commit(without(all, ids)); return; }
  if (name === 'duplicate') { pasteElements(all.filter((e) => ids.has(e.id)), PASTE_OFFSET); return; }
  const picked = all.filter((e) => ids.has(e.id));
  const rest = all.filter((e) => !ids.has(e.id));
  B.commit(name === 'front' ? [...rest, ...picked] : [...picked, ...rest]);
}

// ---------------------------------------------------------------- text editing

function editText(id) {
  const b = B.currentBoard();
  const e = b?.elements.find((x) => x.id === id);
  if (!e || e.type === 'path' || e.type === 'image') return;
  let box = B.bounds(e, b.elements);
  if (B.isConnector(e)) {
    const [lx, ly] = B.connector(e, b.elements).label;
    box = { x: lx - 90, y: ly - 18, w: 180, h: 36 };
  } else if (e.type === 'frame') box = { ...box, h: 32 };
  const r = ui.svg.getBoundingClientRect();
  const host = ui.root.getBoundingClientRect();
  const z = st.view.zoom;
  const ed = ui.editor;
  Object.assign(ed.style, {
    display: 'block', left: `${r.left - host.left + (box.x - st.view.x) * z}px`, top: `${r.top - host.top + (box.y - st.view.y) * z}px`,
    width: `${Math.max(120, box.w * z)}px`, height: `${Math.max(36, box.h * z)}px`, fontSize: `${(e.fontSize || (e.type === 'sticky' ? 14 : 15)) * z}px`,
  });
  ed.value = e.text || '';
  ed.dataset.id = id;
  ed.focus();
  ed.select();
}

function finishEdit() {
  const ed = ui.editor;
  const id = ed.dataset.id;
  if (!id) return;
  ed.dataset.id = '';
  ed.style.display = 'none';
  const b = B.currentBoard();
  const e = b?.elements.find((x) => x.id === id);
  if (!e) return;
  const text = ed.value.trimEnd();
  if (!text && e.type === 'text') { B.commit(b.elements.filter((x) => x.id !== id)); return; }
  if (text !== (e.text || '')) B.commit(b.elements.map((x) => (x.id === id ? { ...x, text } : x)));
}

// ---------------------------------------------------------------- hit testing

// The shape under the pointer that a connector could attach to (skipping connectors and the draft itself).
function boxAt(ev, skip = null) {
  const all = elementsNow();
  for (const n of document.elementsFromPoint(ev.clientX, ev.clientY)) {
    const id = n.closest?.('[data-id]')?.dataset.id;
    if (!id || id === skip) continue;
    const e = byId(id, all);
    if (B.isBox(e)) return e;
  }
  return null;
}

// Which side of `e` the pointer is near enough to attach to, if any.
function portNear(e, p) {
  const b = B.bounds(e);
  let best = null;
  for (const side of SIDES) {
    const [x, y] = sidePoint(e.type, b, side);
    const d = Math.hypot(p.x - x, p.y - y) * st.view.zoom;
    if (d < PORT_SNAP && (!best || d < best.d)) best = { side, d };
  }
  return best?.side;
}

// What a connector end attaches to at the pointer: { id, side } or null for a loose end.
function attachAt(ev, p, skip) {
  const e = boxAt(ev, skip);
  return e ? { id: e.id, side: portNear(e, p) } : null;
}

// Shapes with quick-connect arrows (an image or a frame has no "copy of it" to add next to it).
const hoverableBox = (e) => B.isBox(e) && e.type !== 'frame' && e.type !== 'image';

// ---------------------------------------------------------------- pointer

let drag = null;

function onDown(ev) {
  const b = B.currentBoard();
  if (!b || ev.button === 2) return;
  if (ui.editor.dataset.id) finishEdit();
  const p = world(ev);
  try { ui.svg.setPointerCapture(ev.pointerId); } catch { /* pointer already gone */ }
  const target = ev.target.closest?.('[data-id]')?.dataset.id || null;
  const panning = ev.button === 1 || st.space;
  drag = { start: p, last: p, sx: ev.clientX, sy: ev.clientY, moved: false, target, shift: ev.shiftKey };
  if (panning) { drag.mode = 'pan'; return; }
  if (st.tool === 'select') {
    const qc = ev.target.closest?.('[data-qc]');
    const end = ev.target.closest?.('[data-end]');
    if (qc) {
      drag.mode = 'qc';
      drag.from = qc.dataset.for;
      drag.side = qc.dataset.qc;
    } else if (end && st.selected.length === 1) {
      drag.mode = 'reconnect';
      drag.end = end.dataset.end;
      drag.orig = byId(st.selected[0], b.elements);
    } else if (ev.target.classList.contains('resize-handle') && st.selected.length === 1) {
      drag.mode = 'resize';
      drag.orig = byId(st.selected[0], b.elements);
    } else if (target) {
      // Shift-click adds/removes; grabbing one of several selected moves them all.
      if (ev.shiftKey) st.selected = st.selected.includes(target) ? st.selected.filter((id) => id !== target) : [...st.selected, target];
      else if (!st.selected.includes(target)) st.selected = [target];
      drag.mode = 'move';
      drag.origs = withContents(b.elements.filter((e) => st.selected.includes(e.id)), b.elements);
      render();
    } else {
      // Dragging on empty space draws a selection rectangle; with Shift it adds to the selection.
      drag.mode = 'marquee';
      drag.base = ev.shiftKey ? st.selected : [];
      st.selected = drag.base;
      render();
    }
    return;
  }
  if (st.tool === 'eraser') {
    drag.mode = 'erase';
    st.erasing = new Set(target ? [target] : []);
    render();
    return;
  }
  const base = { id: undefined, color: st.color, size: st.size };
  const at = { x: ev.altKey ? p.x : snap(p.x), y: ev.altKey ? p.y : snap(p.y) };
  let raw;
  if (st.tool === 'pen') raw = { ...base, type: 'path', points: [[p.x, p.y], [p.x + 0.1, p.y + 0.1]] };
  else if (st.tool === 'arrow') {
    const from = attachAt(ev, p);
    raw = { ...base, type: 'arrow', x: p.x, y: p.y, x2: p.x, y2: p.y, from: from?.id, fromSide: from?.side, route: st.route };
  } else if (st.tool === 'text') raw = { ...base, type: 'text', x: p.x, y: p.y - 12, text: '' };
  else {
    const type = st.tool === 'shape' ? st.shape : st.tool;
    raw = { ...base, type, ...at, w: 1, h: 1, color: type === 'sticky' ? stickyColor() : type === 'frame' && st.color === 'ink' ? 'gray' : st.color };
  }
  st.drafts = [B.normalize(raw)];
  drag.mode = 'create';
  render();
}

const shifted = (o, dx, dy) => (o.type === 'path' ? { ...o, points: o.points.map(([x, y]) => [x + dx, y + dy]) }
  : B.isConnector(o) ? { ...o, x: o.x + dx, y: o.y + dy, x2: o.x2 + dx, y2: o.y2 + dy }
    : { ...o, x: o.x + dx, y: o.y + dy });
const touches = (a, r) => a.x <= r.x + r.w && a.x + a.w >= r.x && a.y <= r.y + r.h && a.y + a.h >= r.y;
const inside = (a, r) => a.x >= r.x && a.y >= r.y && a.x + a.w <= r.x + r.w && a.y + a.h <= r.y + r.h;
// Removing elements also removes the connectors attached to them.
const without = (elements, gone) => elements.filter((e) => !gone.has(e.id) && !gone.has(e.from) && !gone.has(e.to));
const stickyColor = () => (st.color === 'ink' ? 'yellow' : st.color);

// A moved frame takes along what belongs to it or lies inside it.
function withContents(picked, all) {
  const out = new Map(picked.map((e) => [e.id, e]));
  for (const f of picked.filter((e) => e.type === 'frame')) {
    const fb = B.bounds(f, all);
    const belongs = (e, seen = new Set()) => e.parent === f.id || (!!e.parent && !seen.has(e.parent) && belongs(byId(e.parent, all) || {}, seen.add(e.parent)));
    for (const e of all) if (!B.isConnector(e) && e.id !== f.id && (belongs(e) || inside(B.bounds(e, all), fb))) out.set(e.id, e);
  }
  return [...out.values()];
}

// Shapes dropped into a frame belong to it; dragged out, they no longer do.
function reparent(list, ids) {
  const frames = list.filter((e) => e.type === 'frame');
  return list.map((e) => {
    if (!ids.has(e.id) || B.isConnector(e) || e.type === 'path') return e;
    const b = B.bounds(e, list);
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2, w: 0, h: 0 };
    // Never into a frame that sits inside this element (that would be a loop).
    const within = (f, seen = new Set()) => !!f.parent && !seen.has(f.id) && (f.parent === e.id || within(byId(f.parent, list) || {}, seen.add(f.id)));
    const home = frames.filter((f) => f.id !== e.id && !within(f) && inside(c, f)).sort((a, z) => a.w * a.h - z.w * z.h)[0];
    if (home?.id === e.parent) return e;
    const { parent, ...rest } = e;
    return home ? { ...rest, parent: home.id } : rest;
  });
}

function onHover(ev) {
  if (drag || st.tool !== 'select') return;
  const owner = ev.target.closest?.('[data-for]')?.dataset.for;
  const id = owner || ev.target.closest?.('[data-id]')?.dataset.id || null;
  const e = id && byId(id);
  const next = e && hoverableBox(e) ? id : null;
  if (next !== st.hover) { st.hover = next; render(); }
}

function onMove(ev) {
  if (!drag) { onHover(ev); return; }
  const p = world(ev);
  if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < MIN_DRAG) return;
  drag.moved = true;
  const b = B.currentBoard();
  const free = ev.altKey; // Alt: no snapping to the grid
  if (drag.mode === 'pan') {
    st.view = { ...st.view, x: st.view.x - (ev.movementX || 0) / st.view.zoom, y: st.view.y - (ev.movementY || 0) / st.view.zoom };
    applyView();
  } else if (drag.mode === 'move' && drag.origs?.length) {
    let dx = p.x - drag.start.x;
    let dy = p.y - drag.start.y;
    const lead = drag.origs.find((o) => o.x != null && !B.isConnector(o));
    if (lead && !free) { dx = snap(lead.x + dx) - lead.x; dy = snap(lead.y + dy) - lead.y; }
    st.drafts = drag.origs.map((o) => shifted(o, dx, dy));
    render();
  } else if (drag.mode === 'resize' && drag.orig) {
    const o = drag.orig;
    const w = Math.max(30, free ? p.x - o.x : snap(p.x) - o.x);
    const hgt = Math.max(24, free ? p.y - o.y : snap(p.y) - o.y);
    st.drafts = [o.type === 'image' ? { ...o, w, h: w * (o.h / o.w) } : { ...o, w, ...(o.type === 'text' ? {} : { h: hgt }) }];
    render();
  } else if (drag.mode === 'marquee') {
    const box = { x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
    // A frame is picked only when the rectangle covers it whole, so selecting inside a frame works.
    const hit = b.elements.filter((e) => (e.type === 'frame' ? inside(B.bounds(e, b.elements), box) : touches(B.bounds(e, b.elements), box))).map((e) => e.id);
    st.marquee = box;
    st.selected = [...new Set([...drag.base, ...hit])];
    render();
  } else if (drag.mode === 'erase') {
    const id = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-id]')?.dataset.id;
    if (id && !st.erasing.has(id)) { st.erasing.add(id); render(); }
  } else if (drag.mode === 'qc' || drag.mode === 'reconnect') {
    const draftId = drag.mode === 'reconnect' ? drag.orig.id : 'qc-draft';
    const hit = attachAt(ev, p, draftId);
    st.drop = hit;
    if (drag.mode === 'qc') {
      st.drafts = [B.normalize({ id: draftId, type: 'arrow', from: drag.from, fromSide: drag.side, to: hit?.id, toSide: hit?.side, x2: p.x, y2: p.y, color: st.color, route: st.route })];
    } else {
      const o = drag.orig;
      const [ref, side, kx, ky] = drag.end === 'from' ? ['from', 'fromSide', 'x', 'y'] : ['to', 'toSide', 'x2', 'y2'];
      const rest = Object.fromEntries(Object.entries(o).filter(([k]) => k !== ref && k !== side));
      st.drafts = [{ ...rest, [kx]: p.x, [ky]: p.y, ...(hit ? { [ref]: hit.id, ...(hit.side ? { [side]: hit.side } : {}) } : {}) }];
    }
    render();
  } else if (drag.mode === 'create' && st.drafts.length) {
    const d = st.drafts[0];
    if (d.type === 'path') {
      const last = d.points.at(-1);
      if (Math.hypot(p.x - last[0], p.y - last[1]) * st.view.zoom >= PEN_STEP) st.drafts = [{ ...d, points: [...d.points, [p.x, p.y]] }];
    } else if (B.isConnector(d)) {
      const hit = attachAt(ev, p, d.id);
      st.drop = hit;
      const { to, toSide, ...rest } = d;
      st.drafts = [{ ...rest, x2: p.x, y2: p.y, ...(hit ? { to: hit.id, ...(hit.side ? { toSide: hit.side } : {}) } : {}) }];
    } else if (d.type !== 'text') {
      const q = { x: free ? p.x : snap(p.x), y: free ? p.y : snap(p.y) };
      const s = { x: free ? drag.start.x : snap(drag.start.x), y: free ? drag.start.y : snap(drag.start.y) };
      st.drafts = [{ ...d, x: Math.min(q.x, s.x), y: Math.min(q.y, s.y), w: Math.abs(q.x - s.x), h: Math.abs(q.y - s.y) }];
    }
    render();
  }
}

function onUp(ev) {
  if (!drag) return;
  const b = B.currentBoard();
  const d = drag;
  drag = null;
  st.drop = null;
  if (!b) return;
  if (d.mode === 'erase') {
    const gone = st.erasing;
    st.erasing = null;
    if (gone.size) B.commit(without(b.elements, gone));
    else render();
    return;
  }
  if (d.mode === 'marquee') {
    st.marquee = null;
    render();
    return;
  }
  if (d.mode === 'qc') {
    st.drafts = [];
    if (d.moved) {
      const p = world(ev);
      const hit = attachAt(ev, p, 'qc-draft');
      const link = B.normalize({ type: 'arrow', from: d.from, fromSide: d.side, to: hit?.id, toSide: hit?.side, x2: p.x, y2: p.y, color: st.color, route: st.route });
      B.commit([...b.elements, link]);
      st.selected = [link.id];
      render();
    } else addConnected(d.from, d.side);
    return;
  }
  if (d.mode === 'reconnect') {
    const next = st.drafts[0];
    st.drafts = [];
    if (d.moved && next) B.commit(b.elements.map((e) => (e.id === next.id ? B.normalize(next) : e)));
    else render();
    return;
  }
  if (d.mode === 'move' && !d.moved) {
    // A plain click on one of several selected narrows the selection to it.
    if (!d.shift && d.target && st.selected.length > 1) st.selected = [d.target];
    render();
    return;
  }
  if ((d.mode === 'move' || d.mode === 'resize') && st.drafts.length) {
    const over = new Map(st.drafts.map((x) => [x.id, x]));
    st.drafts = [];
    if (d.moved) B.commit(reparent(b.elements.map((e) => over.get(e.id) || e), new Set(over.keys())));
    else render();
    return;
  }
  if (d.mode !== 'create' || !st.drafts.length) return;
  let next = st.drafts[0];
  st.drafts = [];
  if (!d.moved) {
    // A click places a default-sized shape (or starts typing); a click with the connector or pen does nothing.
    if (B.isConnector(next) || next.type === 'path') { render(); return; }
    if (next.type !== 'text') {
      const size = B.normalize({ type: next.type });
      next = { ...next, x: snap(next.x - size.w / 2), y: snap(next.y - size.h / 2), w: size.w, h: size.h };
    }
  }
  // A connector between two shapes takes the chosen route; a loose one stays straight. Shapes get
  // their minimum size (a drag along one axis only would leave them flat).
  next = B.normalize(B.isConnector(next) ? { ...next, route: next.from && next.to ? st.route : 'straight' } : next);
  B.commit(reparent([...b.elements, next], new Set([next.id])));
  st.selected = [next.id];
  if (next.type === 'text' || next.type === 'sticky' || next.type === 'frame') editText(next.id);
  else render();
}

// Quick-connect click: a copy of the shape (its style, no text) on that side, connected to it.
function addConnected(fromId, side) {
  const all = elementsNow();
  const src = byId(fromId, all);
  if (!src) return;
  const copy = B.normalize({ type: src.type, w: src.w, h: src.h, color: src.color, fill: src.fill, fontSize: src.fontSize, parent: src.parent });
  const link = B.normalize({ type: 'arrow', from: src.id, to: copy.id, color: src.color === 'ink' ? st.color : src.color, route: st.route });
  const placed = placeNew([...all, { ...copy, unplaced: true }, link], new Set([copy.id]), { direction: SIDE_FLOW[side] }, B.bounds);
  B.commit(placed.map(({ unplaced, ...e }) => e));
  st.selected = [copy.id];
  st.hover = null;
  editText(copy.id);
}

function onWheel(ev) {
  ev.preventDefault();
  const r = ui.svg.getBoundingClientRect();
  if (ev.ctrlKey || ev.metaKey) {
    const before = world(ev);
    const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, st.view.zoom * Math.exp(-ev.deltaY * 0.01)));
    st.view = { zoom, x: before.x - (ev.clientX - r.left) / zoom, y: before.y - (ev.clientY - r.top) / zoom };
  } else {
    st.view = { ...st.view, x: st.view.x + ev.deltaX / st.view.zoom, y: st.view.y + ev.deltaY / st.view.zoom };
  }
  applyView();
  if (st.hover) render();
}

// ---------------------------------------------------------------- copy, paste, duplicate

// Copies of elements (with the connectors between them) shifted by `offset`, under fresh ids.
function pasteElements(list, offset) {
  if (!list.length) return;
  const all = elementsNow();
  const ids = new Set(list.map((e) => e.id));
  const links = all.filter((c) => B.isConnector(c) && !ids.has(c.id) && ids.has(c.from) && ids.has(c.to));
  const items = [...list, ...links];
  const fresh = new Map(items.map((e) => [e.id, uid()]));
  const copies = items.map((e) => {
    // A connector end whose shape isn't copied along becomes a loose end where it was.
    const geo = B.isConnector(e) ? B.connector(e, all) : null;
    const loose = geo ? {
      ...(e.from && !fresh.has(e.from) ? { x: geo.start[0], y: geo.start[1] } : {}),
      ...(e.to && !fresh.has(e.to) ? { x2: geo.end[0], y2: geo.end[1] } : {}),
    } : {};
    const { from, to, parent, fromSide, toSide, ...rest } = { ...e, ...loose };
    const out = { ...shifted(rest, offset, offset), id: fresh.get(e.id), by: 'user' };
    if (from && fresh.has(from)) Object.assign(out, { from: fresh.get(from), ...(fromSide ? { fromSide } : {}) });
    if (to && fresh.has(to)) Object.assign(out, { to: fresh.get(to), ...(toSide ? { toSide } : {}) });
    if (parent) out.parent = fresh.get(parent) || parent;
    return out;
  });
  B.commit([...all, ...copies]);
  st.selected = list.map((e) => fresh.get(e.id));
  setTool('select');
}

function copySelection() {
  const all = elementsNow();
  const ids = new Set(st.selected);
  // The connectors between the copied shapes come along, so pasting on another board keeps them.
  const list = all.filter((e) => ids.has(e.id) || (B.isConnector(e) && ids.has(e.from) && ids.has(e.to)));
  if (list.length) navigator.clipboard.writeText(CLIP_PREFIX + JSON.stringify(list)).catch(() => {});
}

// Pasted board elements come back as copies; any other text becomes a text block.
function pasteText(text) {
  if (text.startsWith(CLIP_PREFIX)) {
    try {
      pasteElements(JSON.parse(text.slice(CLIP_PREFIX.length)).map((e) => B.normalize(e)), PASTE_OFFSET);
    } catch { toast('Couldn’t paste that', { iconName: 'warn' }); }
    return;
  }
  const r = ui.svg.getBoundingClientRect();
  const el = B.normalize({ type: 'text', text, x: st.view.x + r.width / st.view.zoom / 2 - 160, y: st.view.y + r.height / st.view.zoom / 2, color: st.color });
  B.commit([...elementsNow(), el]);
  st.selected = [el.id];
  render();
}

// ---------------------------------------------------------------- keys

function onKey(ev) {
  if (!st.visible || !B.currentBoard() || ev.target.closest?.('input, textarea, [contenteditable]')) return;
  if (!ui.root.contains(document.activeElement) && document.activeElement !== document.body) return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (ev.code === 'Space') { st.space = ev.type === 'keydown'; ui.root.classList.toggle('panning', st.space); ev.preventDefault(); return; }
  if (ev.type !== 'keydown') return;
  const key = ev.key.toLowerCase();
  if (mod && key === 'z') { ev.preventDefault(); ev.shiftKey ? B.redo() : B.undo(); return; }
  if (mod && key === 'y') { ev.preventDefault(); B.redo(); return; }
  if (mod && key === 'a') { ev.preventDefault(); st.selected = elementsNow().map((e) => e.id); setTool('select'); return; }
  if (mod && key === 'd') { ev.preventDefault(); act('duplicate'); return; }
  if (mod && key === 'c' && st.selected.length) { ev.preventDefault(); copySelection(); return; }
  if (mod) return;
  const nudge = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
  if (nudge && st.selected.length) {
    ev.preventDefault();
    const step = ev.shiftKey ? GRID : 1;
    const all = elementsNow();
    const moved = new Map(withContents(all.filter((e) => st.selected.includes(e.id)), all).map((e) => [e.id, shifted(e, nudge[0] * step, nudge[1] * step)]));
    B.commit(all.map((e) => moved.get(e.id) || e));
    return;
  }
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && st.selected.length) { act('delete'); return; }
  if (ev.key === 'Escape') { st.selected = []; setTool('select'); return; }
  if (ev.key === 'Enter' && st.selected.length === 1) { ev.preventDefault(); editText(st.selected[0]); return; }
  if (SHAPE_KEYS[key]) { st.shape = SHAPE_KEYS[key]; setTool('shape'); return; }
  const tool = TOOLS.find((t) => t[3] === key);
  if (tool) setTool(tool[0]);
}

function setTool(tool) {
  st.tool = tool;
  st.hover = null;
  render();
}

// ---------------------------------------------------------------- draw.io files

async function saveDrawio() {
  const b = B.currentBoard();
  if (!b) return;
  const name = `${b.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Board'}.drawio`;
  const res = await window.lumen.saveFile(name, toDrawio(b.elements, b.title)).catch((err) => ({ error: err.message }));
  if (res?.ok) toast('Saved as a draw.io file', { iconName: 'check' });
  else if (res?.error) toast(`Couldn’t save: ${res.error}`, { iconName: 'warn' });
}

// A .drawio file as board elements whose ids don't clash with the board's, moved to start at `at`.
async function drawioElements(file, at) {
  const { title, elements } = await fromDrawio(await file.text());
  const taken = new Set(elementsNow().map((e) => e.id));
  const fresh = new Map(elements.map((e) => [e.id, taken.has(e.id) ? uid() : e.id]));
  const list = elements.flatMap((raw) => {
    try {
      const remapped = { ...raw, id: fresh.get(raw.id), ...(raw.from ? { from: fresh.get(raw.from) } : {}), ...(raw.to ? { to: fresh.get(raw.to) } : {}), ...(raw.parent ? { parent: fresh.get(raw.parent) } : {}) };
      return [B.normalize(remapped, 'user')];
    } catch { return []; }
  });
  if (!at || !list.length) return { title, list };
  const boxes = list.map((e) => B.bounds(e, list));
  const dx = at.x - Math.min(...boxes.map((x) => x.x));
  const dy = at.y - Math.min(...boxes.map((x) => x.y));
  return { title, list: list.map((e) => shifted(e, dx, dy)) };
}

async function openDrawio(file) {
  try {
    const { title, list } = await drawioElements(file, null);
    B.newBoard({ title: title || file.name.replace(/\.(drawio|xml)$/i, ''), elements: list });
    st.selected = [];
    showBoard(true);
    fitView();
  } catch (err) {
    toast(err.message || 'Couldn’t open that file', { iconName: 'warn' });
  }
}

async function insertDrawio(file, at) {
  try {
    const { list } = await drawioElements(file, at);
    B.commit([...elementsNow(), ...list]);
    st.selected = list.map((e) => e.id);
    setTool('select');
  } catch (err) {
    toast(err.message || 'Couldn’t read that file', { iconName: 'warn' });
  }
}

// ---------------------------------------------------------------- chrome

function boardsMenu(anchor) {
  const b = B.currentBoard();
  const saved = B.savedBoards();
  showMenu(0, 0, [
    { type: 'header', label: 'Boards' },
    ...saved.slice(0, 15).map((x) => ({ label: x.title, checked: x.id === b?.id, action: () => openSaved(x.id) })),
    saved.length ? { type: 'separator' } : null,
    { label: 'New Board', icon: 'plus', action: () => openNew(false) },
    { label: 'New Temporary Board', icon: 'eraser', sub: 'Erased when you close it', action: () => openNew(true) },
    { label: 'Open draw.io File…', icon: 'folder', action: () => ui.drawio.click() },
    b ? { label: 'Save as draw.io File…', icon: 'download', disabled: !b.elements.length, action: saveDrawio } : null,
    b ? { type: 'separator' } : null,
    b?.temporary ? { label: 'Keep This Board', icon: 'pin', action: () => { B.keepBoard(); toast('Board saved', { iconName: 'check' }); } } : null,
    b && !b.temporary ? {
      label: 'Delete Board', icon: 'trash', danger: true,
      action: async () => { if (await confirmDialog({ title: `Delete “${b.title}”?`, message: 'The board and everything on it will be removed.', confirm: 'Delete', danger: true })) B.deleteBoard(b.id); },
    } : null,
  ].filter(Boolean), { anchor });
}

function arrangeMenu(anchor) {
  showMenu(0, 0, [
    { type: 'header', label: 'Tidy up the diagram' },
    { label: 'Top to Bottom', icon: 'splitRows', action: () => B.arrange('TB') },
    { label: 'Left to Right', icon: 'splitCols', action: () => B.arrange('LR') },
  ], { anchor });
}

function toolButton([id, title, ic]) {
  const btn = h('button', { class: 'bt-tool', title, dataset: { tool: id }, html: ic ? icon(ic, 16) : '' });
  const pick = () => shapePicker(btn, st.shape, (k) => { st.shape = k; setTool('shape'); });
  btn.addEventListener('click', () => { if (id === 'shape' && st.tool === 'shape') pick(); else setTool(id); });
  if (id === 'shape') btn.addEventListener('contextmenu', (e) => { e.preventDefault(); pick(); });
  return btn;
}

function pickColor(c) {
  st.color = c;
  // With something selected, the color applies to it as well.
  if (st.selected.length) updateSelected((e) => ({ ...e, color: e.type === 'sticky' && c === 'ink' ? 'yellow' : c }));
  else render();
}

function build() {
  if (ui.root) return;
  ui.svg = svg('svg', { class: 'board-canvas' });
  const grid = gridLayer();
  ui.grid = grid.rect;
  ui.scene = svg('g');
  ui.svg.append(grid.defs, ui.grid, ui.scene);
  ui.title = h('input', { class: 'board-title', spellcheck: 'false', title: 'Rename board' });
  ui.title.addEventListener('change', () => B.renameBoard(ui.title.value));
  ui.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.title.blur(); });
  ui.editor = h('textarea', { class: 'board-editor', spellcheck: 'true' });
  ui.editor.addEventListener('blur', finishEdit);
  ui.editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ui.editor.blur(); }
  });
  const colorBtn = (c) => h('button', { class: 'bt-color', title: c, dataset: { color: c }, style: { '--c': B.COLORS[c] }, onclick: () => pickColor(c) });
  ui.tools = h('div', { class: 'board-tools' },
    ...TOOLS.map(toolButton), h('i', { class: 'bt-sep' }),
    ...PALETTE.map(colorBtn), h('i', { class: 'bt-sep' }),
    h('button', { class: 'bt-tool', title: 'Undo (Ctrl+Z)', html: icon('undo', 15), onclick: () => B.undo() }),
    h('button', { class: 'bt-tool', title: 'Redo (Ctrl+Shift+Z)', html: icon('redo', 15), onclick: () => B.redo() }),
    h('button', { class: 'bt-tool', title: 'Tidy up the diagram', html: icon('layers', 15), onclick: (e) => arrangeMenu(e.currentTarget) }),
    h('button', { class: 'bt-tool', title: 'Insert image (or paste / drop one)', html: icon('camera', 15), onclick: () => ui.file.click() }),
    h('button', { class: 'bt-tool', title: 'Fit everything in view', html: icon('fit', 15), onclick: fitView }));
  ui.format = h('div', { class: 'board-format-host' });
  ui.file = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
  ui.file.addEventListener('change', () => { insertFiles([...ui.file.files]); ui.file.value = ''; });
  ui.drawio = h('input', { type: 'file', accept: '.drawio,.xml,application/xml', style: { display: 'none' } });
  ui.drawio.addEventListener('change', () => { if (ui.drawio.files[0]) openDrawio(ui.drawio.files[0]); ui.drawio.value = ''; });
  ui.empty = h('div', { class: 'board-empty' }, h('b', {}, 'Draw, diagram, or ask the AI'),
    h('span', {}, 'Pick a shape, then click its little arrows to add the next step. Or say “Nakresli mi na tabuli diagram…”.'));
  ui.root = h('div', { id: 'board', class: 'board', tabindex: '-1' },
    h('div', { class: 'board-bar' },
      h('button', { class: 'board-menu-btn', title: 'Boards', html: icon('board', 15), onclick: (e) => boardsMenu(e.currentTarget) }),
      ui.title,
      h('span', { class: 'board-temp', title: 'Erased when you close it' }, 'Temporary'),
      ui.presence = h('span', { class: 'board-presence' }),
      h('button', { class: 'btn small board-keep', onclick: () => { B.keepBoard(); toast('Board saved', { iconName: 'check' }); } }, 'Keep'),
      h('div', { class: 'grow' }),
      h('button', { class: 'icon-btn', title: 'Hide board (keeps it open)', html: icon('chevronDown', 15), onclick: () => showBoard(false) }),
      h('button', { class: 'icon-btn', title: 'Close board (a temporary board is erased)', html: icon('x', 15), onclick: closeCurrent })),
    ui.format, ui.tools, ui.svg, ui.empty, ui.editor, ui.file, ui.drawio);
  $('#content').append(ui.root);
  ui.svg.addEventListener('pointerdown', onDown);
  ui.svg.addEventListener('pointermove', onMove);
  ui.svg.addEventListener('pointerup', onUp);
  ui.svg.addEventListener('pointercancel', onUp);
  ui.svg.addEventListener('pointerleave', () => { if (!drag && st.hover) { st.hover = null; render(); } });
  ui.svg.addEventListener('dblclick', (e) => { const id = e.target.closest?.('[data-id]')?.dataset.id; if (id) editText(id); });
  ui.svg.addEventListener('wheel', onWheel, { passive: false });
  ui.root.addEventListener('dragover', (e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault(); });
  ui.root.addEventListener('drop', (e) => {
    const files = [...e.dataTransfer.files];
    const drawio = files.find((f) => /\.(drawio|xml)$/i.test(f.name));
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!drawio && !images.length) return;
    e.preventDefault();
    if (drawio) insertDrawio(drawio, world(e));
    else insertFiles(images, world(e));
  });
  window.addEventListener('paste', (e) => {
    if (!boardVisible() || e.target.closest?.('input, textarea, [contenteditable]')) return;
    const files = [...e.clipboardData.items].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
    const text = e.clipboardData.getData('text/plain');
    if (!files.length && !text.trim()) return;
    e.preventDefault();
    if (files.length) insertFiles(files);
    else pasteText(text);
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  new ResizeObserver(() => { if (st.visible) applyView(); }).observe(ui.root);
}

// ---------------------------------------------------------------- images

// Any image source → a data: URL no larger than IMAGE_MAX_SIDE, plus its size when placed.
export async function loadImage(src) {
  const img = await scaledImage(src, IMAGE_MAX_SIDE, JPEG_QUALITY);
  const shown = Math.min(1, IMAGE_SHOWN / Math.max(img.width, img.height));
  return { src: img.url, w: Math.round(img.width * shown), h: Math.round(img.height * shown) };
}

// The user's images: placed at the drop point, or in the middle of the view, side by side.
async function insertFiles(files, at = null) {
  const b = B.currentBoard();
  if (!b || !files.length) return;
  const r = ui.svg.getBoundingClientRect();
  let x = at ? at.x : st.view.x + r.width / st.view.zoom / 2;
  const y = at ? at.y : st.view.y + r.height / st.view.zoom / 2;
  const added = [];
  for (const file of files.slice(0, 10)) {
    try {
      const img = await loadImage(await readFileUrl(file));
      added.push(B.normalize({ type: 'image', ...img, x: x - img.w / 2, y: y - img.h / 2, alt: file.name }));
      x += img.w + 24;
    } catch {
      toast(`Couldn’t read ${file.name}`, { iconName: 'warn' });
    }
  }
  if (!added.length) return;
  B.commit([...B.currentBoard().elements, ...added]);
  st.selected = added.map((e) => e.id);
  setTool('select');
}

// ---------------------------------------------------------------- public

export function showBoard(on = true) {
  build();
  if (on && !B.currentBoard()) B.newBoard({ temporary: true });
  st.visible = on && !!B.currentBoard();
  render();
  if (st.visible) { applyView(); ui.root.focus(); }
}

export const boardVisible = () => st.visible && !!B.currentBoard();

function openNew(temporary) {
  B.newBoard({ temporary });
  st.selected = [];
  st.view = { x: 0, y: 0, zoom: 1 };
  showBoard(true);
}

function openSaved(id) {
  B.openBoard(id);
  st.selected = [];
  showBoard(true);
  fitView();
}

function closeCurrent() {
  const b = B.currentBoard();
  if (!b) return;
  if (b.temporary && b.elements.length) toast('Temporary board erased', { iconName: 'eraser', timeout: 2200 });
  B.closeBoard();
  st.visible = false;
  render();
}

// Toolbar button: show/hide the open board, or offer boards when none is open.
export function boardButton(anchor) {
  if (B.currentBoard()) { showBoard(!st.visible); return; }
  build();
  boardsMenu(anchor);
}

export function initBoardView() {
  B.onBoardChange((why) => {
    if (why === 'ai') { st.visible = true; build(); }
    // Forget selections of elements that are gone (closed board, undo, the agent removing them).
    const ids = new Set(elementsNow().map((e) => e.id));
    st.selected = st.selected.filter((id) => ids.has(id));
    if (st.hover && !ids.has(st.hover)) st.hover = null;
    render(why);
    if (why === 'ai') requestAnimationFrame(fitView);
  });
}

// What the board looks like right now, for the agent (base64 JPEG), or null when hidden.
export async function snapshotBoard() {
  if (!boardVisible()) return null;
  const r = ui.svg.getBoundingClientRect();
  return window.lumen.capture(0, { x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => null);
}
