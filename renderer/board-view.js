// The whiteboard over the page area: lines, arrows, shapes, text and sticky notes — and the AI agent
// draws here too. The toolbar button shows/hides it; × closes it (a temporary board is erased).
import { h, $ } from './util.js';
import { icon } from './icons.js';
import { showMenu, toast, confirmDialog } from './ui.js';
import * as B from './board-model.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const TOOLS = [
  ['select', 'Select & move (V)', 'cursor', 'v'], ['pen', 'Pen (P)', 'compose', 'p'], ['line', 'Line (L)', 'minus', 'l'],
  ['arrow', 'Arrow (A) — start or end on a shape to connect it', 'arrowRight', 'a'], ['rect', 'Rectangle (R)', 'square', 'r'],
  ['ellipse', 'Ellipse (O)', 'circle', 'o'], ['text', 'Text (T)', 'textT', 't'], ['sticky', 'Sticky note (N)', 'sticky', 'n'], ['eraser', 'Eraser (E)', 'eraser', 'e'],
];
const PALETTE = ['ink', 'blue', 'red', 'green', 'orange', 'purple'];
const MIN_DRAG = 4; // px before a click becomes a drag
const PEN_STEP = 2; // px between recorded pen points
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const FIT_PAD = 60;
const STICKY_TEXT = '#1d1d1f';
const IMAGE_MAX_SIDE = 1600; // px kept when an image is stored on the board
const IMAGE_SHOWN = 420; // px longest side when placed
const JPEG_QUALITY = 0.86;

const ui = { root: null, svg: null, scene: null, editor: null, title: null, tools: null, empty: null, presence: null, file: null };
const st = { tool: 'select', color: 'ink', size: 2, view: { x: 0, y: 0, zoom: 1 }, selected: null, draft: null, erasing: null, shown: new Set(), visible: false };

const paint = (c) => B.COLORS[c] || c || B.COLORS.ink;
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
};

// ---------------------------------------------------------------- coordinates

function world(e) {
  const r = ui.svg.getBoundingClientRect();
  return { x: st.view.x + (e.clientX - r.left) / st.view.zoom, y: st.view.y + (e.clientY - r.top) / st.view.zoom };
}

function applyView() {
  const r = ui.svg.getBoundingClientRect();
  ui.svg.setAttribute('viewBox', `${st.view.x} ${st.view.y} ${Math.max(1, r.width / st.view.zoom)} ${Math.max(1, r.height / st.view.zoom)}`);
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
  const zoom = Math.max(ZOOM_MIN, Math.min(1.25, r.width / (x2 - x1), r.height / (y2 - y1)));
  st.view = { zoom, x: (x1 + x2) / 2 - r.width / zoom / 2, y: (y1 + y2) / 2 - r.height / zoom / 2 };
  applyView();
}

// ---------------------------------------------------------------- drawing

function htmlText(x, y, w, hgt, text, { color, size = 15, align = 'center', cls = '' }) {
  const fo = el('foreignObject', { x, y, width: Math.max(1, w), height: Math.max(1, hgt) });
  fo.append(h('div', { class: `bt ${cls} ${align}`, style: { color, fontSize: `${size}px` } }, text));
  return fo;
}

function arrowHead([x1, y1], [x2, y2], color, size) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const len = 10 + size * 2;
  const p = (da) => `${x2 - len * Math.cos(a + da)},${y2 - len * Math.sin(a + da)}`;
  return el('path', { d: `M${p(0.45)} L${x2},${y2} L${p(-0.45)}`, fill: 'none', stroke: color, 'stroke-width': size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
}

function smoothPath(points) {
  if (points.length < 3) return `M${points.map((p) => p.join(',')).join(' L')}`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2;
    const my = (points[i][1] + points[i + 1][1]) / 2;
    d += ` Q${points[i][0]},${points[i][1]} ${mx},${my}`;
  }
  return `${d} L${points.at(-1)[0]},${points.at(-1)[1]}`;
}

function shape(e, all) {
  const g = el('g', { 'data-id': e.id, class: `el ${e.type}` });
  const color = paint(e.color);
  const sw = e.size || 2;
  if (e.type === 'rect' || e.type === 'ellipse') {
    const fill = e.fill && e.fill !== 'none' ? paint(e.fill) : 'transparent';
    g.append(e.type === 'rect'
      ? el('rect', { x: e.x, y: e.y, width: e.w, height: e.h, rx: 12, fill, 'fill-opacity': e.fill ? 0.18 : 1, stroke: color, 'stroke-width': sw })
      : el('ellipse', { cx: e.x + e.w / 2, cy: e.y + e.h / 2, rx: e.w / 2, ry: e.h / 2, fill, 'fill-opacity': e.fill ? 0.18 : 1, stroke: color, 'stroke-width': sw }));
    if (e.text) g.append(htmlText(e.x + 8, e.y + 6, e.w - 16, e.h - 12, e.text, { color, size: 17 }));
  } else if (e.type === 'sticky') {
    g.append(el('rect', { x: e.x, y: e.y, width: e.w, height: e.h, rx: 8, fill: B.STICKY_FILLS[e.color] || B.STICKY_FILLS.yellow, class: 'sticky-paper' }));
    g.append(htmlText(e.x + 12, e.y + 10, e.w - 24, e.h - 20, e.text || '', { color: STICKY_TEXT, size: 14, align: 'left' }));
  } else if (e.type === 'text') {
    g.append(htmlText(e.x, e.y, e.w, Math.max(e.fontSize * 1.6, (e.text || '').split('\n').length * e.fontSize * 1.45 + 6), e.text || '', { color, size: e.fontSize, align: 'left', cls: 'free' }));
  } else if (e.type === 'line' || e.type === 'arrow') {
    const [a, z] = B.endpoints(e, all);
    g.append(el('line', { x1: a[0], y1: a[1], x2: z[0], y2: z[1], class: 'hit' }));
    g.append(el('line', { x1: a[0], y1: a[1], x2: z[0], y2: z[1], stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round' }));
    if (e.type === 'arrow') g.append(arrowHead(a, z, color, sw));
    if (e.text) {
      const t = el('text', { x: (a[0] + z[0]) / 2, y: (a[1] + z[1]) / 2 - 8, 'text-anchor': 'middle', class: 'edge-label', fill: color });
      t.textContent = e.text;
      g.append(t);
    }
  } else if (e.type === 'image') {
    g.append(el('image', { href: e.src, x: e.x, y: e.y, width: e.w, height: e.h, preserveAspectRatio: 'xMidYMid meet' }));
    g.append(el('rect', { x: e.x, y: e.y, width: e.w, height: e.h, rx: 6, class: 'image-frame' }));
  } else if (e.type === 'path') {
    const d = smoothPath(e.points);
    g.append(el('path', { d, class: 'hit' }));
    g.append(el('path', { d, fill: 'none', stroke: color, 'stroke-width': sw + 0.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  return g;
}

function selectionBox(e, all) {
  const b = B.bounds(e, all);
  const g = el('g', { class: 'sel' });
  g.append(el('rect', { x: b.x - 6, y: b.y - 6, width: b.w + 12, height: b.h + 12, rx: 8 }));
  if (['rect', 'ellipse', 'sticky', 'text', 'image'].includes(e.type)) g.append(el('rect', { x: b.x + b.w + 1, y: b.y + b.h + 1, width: 10, height: 10, rx: 3, class: 'resize-handle' }));
  return g;
}

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
  ui.root.dataset.tool = st.tool;
  const all = st.draft ? [...b.elements.filter((e) => e.id !== st.draft.id), st.draft] : b.elements;
  const nodes = all.filter((e) => !st.erasing?.has(e.id)).map((e) => {
    const g = shape(e, all);
    if (why === 'ai' && !st.shown.has(e.id)) g.classList.add('fresh');
    return g;
  });
  const sel = st.selected && all.find((e) => e.id === st.selected);
  ui.scene.replaceChildren(...nodes, ...(sel ? [selectionBox(sel, all)] : []));
  st.shown = new Set(b.elements.map((e) => e.id));
  ui.empty.style.display = all.length ? 'none' : '';
  applyView();
}

// ---------------------------------------------------------------- text editing

function editText(id) {
  const b = B.currentBoard();
  const e = b?.elements.find((x) => x.id === id);
  if (!e || e.type === 'path') return;
  const box = B.bounds(e, b.elements);
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
  drag = { start: p, last: p, sx: ev.clientX, sy: ev.clientY, moved: false };
  if (panning) { drag.mode = 'pan'; return; }
  if (st.tool === 'select') {
    if (ev.target.classList.contains('resize-handle') && st.selected) {
      drag.mode = 'resize';
      drag.orig = b.elements.find((e) => e.id === st.selected);
    } else if (target) {
      st.selected = target;
      drag.mode = 'move';
      drag.orig = b.elements.find((e) => e.id === target);
      render();
    } else {
      st.selected = null;
      drag.mode = 'pan';
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
  const raw = st.tool === 'pen' ? { ...base, type: 'path', points: [[p.x, p.y], [p.x + 0.1, p.y + 0.1]] }
    : st.tool === 'line' || st.tool === 'arrow' ? { ...base, type: st.tool, x: p.x, y: p.y, x2: p.x, y2: p.y, from: st.tool === 'arrow' ? anchorAt(ev) : undefined }
      : st.tool === 'text' ? { ...base, type: 'text', x: p.x, y: p.y - 12, text: '' }
        : { ...base, type: st.tool, x: p.x, y: p.y, w: 1, h: 1, color: st.tool === 'sticky' ? stickyColor() : st.color };
  st.draft = B.normalize(raw);
  drag.mode = 'create';
  render();
}

const stickyColor = () => (st.color === 'ink' ? 'yellow' : st.color);
const anchorAt = (ev) => {
  const id = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-id]')?.dataset.id;
  const e = id && B.currentBoard()?.elements.find((x) => x.id === id);
  return e && !['line', 'arrow', 'path'].includes(e.type) ? id : undefined;
};

function onMove(ev) {
  if (!drag) return;
  const p = world(ev);
  if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < MIN_DRAG) return;
  drag.moved = true;
  const b = B.currentBoard();
  if (drag.mode === 'pan') {
    st.view = { ...st.view, x: st.view.x - (ev.movementX || 0) / st.view.zoom, y: st.view.y - (ev.movementY || 0) / st.view.zoom };
    applyView();
  } else if (drag.mode === 'move' && drag.orig) {
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const o = drag.orig;
    st.draft = o.type === 'path' ? { ...o, points: o.points.map(([x, y]) => [x + dx, y + dy]) }
      : o.type === 'line' || o.type === 'arrow' ? { ...o, x: o.x + dx, y: o.y + dy, x2: o.x2 + dx, y2: o.y2 + dy }
        : { ...o, x: o.x + dx, y: o.y + dy };
    render();
  } else if (drag.mode === 'resize' && drag.orig) {
    const o = drag.orig;
    const w = Math.max(30, p.x - o.x);
    st.draft = o.type === 'image' ? { ...o, w, h: w * (o.h / o.w) } : { ...o, w, ...(o.type === 'text' ? {} : { h: Math.max(24, p.y - o.y) }) };
    render();
  } else if (drag.mode === 'erase') {
    const id = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-id]')?.dataset.id;
    if (id && !st.erasing.has(id)) { st.erasing.add(id); render(); }
  } else if (drag.mode === 'create' && st.draft) {
    const d = st.draft;
    if (d.type === 'path') {
      const last = d.points.at(-1);
      if (Math.hypot(p.x - last[0], p.y - last[1]) * st.view.zoom >= PEN_STEP) st.draft = { ...d, points: [...d.points, [p.x, p.y]] };
    } else if (d.type === 'line' || d.type === 'arrow') {
      st.draft = { ...d, x2: p.x, y2: p.y };
    } else if (d.type !== 'text') {
      st.draft = { ...d, x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
    }
    render();
  }
}

function onUp(ev) {
  if (!drag) return;
  const b = B.currentBoard();
  const d = drag;
  drag = null;
  if (!b) return;
  if (d.mode === 'erase') {
    const gone = st.erasing;
    st.erasing = null;
    if (gone.size) B.commit(b.elements.filter((e) => !gone.has(e.id) && !gone.has(e.from) && !gone.has(e.to)));
    else render();
    return;
  }
  if ((d.mode === 'move' || d.mode === 'resize') && st.draft) {
    const next = st.draft;
    st.draft = null;
    if (d.moved) B.commit(b.elements.map((e) => (e.id === next.id ? next : e)));
    else render();
    return;
  }
  if (d.mode !== 'create' || !st.draft) return;
  let next = st.draft;
  st.draft = null;
  if (!d.moved) {
    // A click places a default-sized shape (or starts typing).
    if (next.type === 'rect' || next.type === 'ellipse') next = { ...next, x: next.x - 80, y: next.y - 50, w: 160, h: 100 };
    else if (next.type === 'sticky') next = { ...next, x: next.x - 90, y: next.y - 60, w: 180, h: 120 };
    else if (next.type !== 'text') { render(); return; }
  }
  if (next.type === 'arrow') next = { ...next, to: anchorAt(ev) };
  B.commit([...b.elements, next]);
  st.selected = next.id;
  if (next.type === 'text' || next.type === 'sticky') editText(next.id);
  else render();
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
}

function onKey(ev) {
  if (!st.visible || !B.currentBoard() || ev.target.closest?.('input, textarea, [contenteditable]')) return;
  if (!ui.root.contains(document.activeElement) && document.activeElement !== document.body) return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (ev.code === 'Space') { st.space = ev.type === 'keydown'; ui.root.classList.toggle('panning', st.space); ev.preventDefault(); return; }
  if (ev.type !== 'keydown') return;
  if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? B.redo() : B.undo(); return; }
  if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); B.redo(); return; }
  if (mod) return;
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && st.selected) {
    const b = B.currentBoard();
    const id = st.selected;
    st.selected = null;
    B.commit(b.elements.filter((e) => e.id !== id && e.from !== id && e.to !== id));
    return;
  }
  if (ev.key === 'Escape') { st.selected = null; setTool('select'); return; }
  if (ev.key === 'Enter' && st.selected) { ev.preventDefault(); editText(st.selected); return; }
  const tool = TOOLS.find((t) => t[3] === ev.key.toLowerCase());
  if (tool) setTool(tool[0]);
}

function setTool(tool) {
  st.tool = tool;
  render();
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
    b ? { type: 'separator' } : null,
    b?.temporary ? { label: 'Keep This Board', icon: 'pin', action: () => { B.keepBoard(); toast('Board saved', { iconName: 'check' }); } } : null,
    b && !b.temporary ? {
      label: 'Delete Board', icon: 'trash', danger: true,
      action: async () => { if (await confirmDialog({ title: `Delete “${b.title}”?`, message: 'The board and everything on it will be removed.', confirm: 'Delete', danger: true })) B.deleteBoard(b.id); },
    } : null,
  ].filter(Boolean), { anchor });
}

function build() {
  if (ui.root) return;
  ui.svg = el('svg', { class: 'board-canvas' });
  ui.scene = el('g');
  ui.svg.append(ui.scene);
  ui.title = h('input', { class: 'board-title', spellcheck: 'false', title: 'Rename board' });
  ui.title.addEventListener('change', () => B.renameBoard(ui.title.value));
  ui.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.title.blur(); });
  ui.editor = h('textarea', { class: 'board-editor', spellcheck: 'true' });
  ui.editor.addEventListener('blur', finishEdit);
  ui.editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ui.editor.blur(); }
  });
  const toolBtn = ([id, title, ic]) => h('button', { class: 'bt-tool', title, dataset: { tool: id }, html: icon(ic, 16), onclick: () => setTool(id) });
  const colorBtn = (c) => h('button', { class: 'bt-color', title: c, dataset: { color: c }, style: { '--c': B.COLORS[c] }, onclick: () => { st.color = c; render(); } });
  ui.tools = h('div', { class: 'board-tools' },
    ...TOOLS.map(toolBtn), h('i', { class: 'bt-sep' }),
    ...PALETTE.map(colorBtn), h('i', { class: 'bt-sep' }),
    h('button', { class: 'bt-tool', title: 'Undo (Ctrl+Z)', html: icon('undo', 15), onclick: () => B.undo() }),
    h('button', { class: 'bt-tool', title: 'Redo (Ctrl+Shift+Z)', html: icon('redo', 15), onclick: () => B.redo() }),
    h('button', { class: 'bt-tool', title: 'Insert image (or paste / drop one)', html: icon('camera', 15), onclick: () => ui.file.click() }),
    h('button', { class: 'bt-tool', title: 'Fit everything in view', html: icon('fit', 15), onclick: fitView }));
  ui.file = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
  ui.file.addEventListener('change', () => { insertFiles([...ui.file.files]); ui.file.value = ''; });
  ui.empty = h('div', { class: 'board-empty' }, h('b', {}, 'Draw, write, or ask the AI'), h('span', {}, '“Nakresli mi na tabuli…” — the agent can sketch diagrams, plans and notes here.'));
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
    ui.tools, ui.svg, ui.empty, ui.editor, ui.file);
  $('#content').append(ui.root);
  ui.svg.addEventListener('pointerdown', onDown);
  ui.svg.addEventListener('pointermove', onMove);
  ui.svg.addEventListener('pointerup', onUp);
  ui.svg.addEventListener('pointercancel', onUp);
  ui.svg.addEventListener('dblclick', (e) => { const id = e.target.closest?.('[data-id]')?.dataset.id; if (id) editText(id); });
  ui.svg.addEventListener('wheel', onWheel, { passive: false });
  ui.root.addEventListener('dragover', (e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault(); });
  ui.root.addEventListener('drop', (e) => {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    insertFiles(files, world(e));
  });
  window.addEventListener('paste', (e) => {
    if (!boardVisible() || e.target.closest?.('input, textarea, [contenteditable]')) return;
    const files = [...e.clipboardData.items].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    insertFiles(files);
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  new ResizeObserver(() => { if (st.visible) applyView(); }).observe(ui.root);
}

// ---------------------------------------------------------------- images

// Any image source → a data: URL no larger than IMAGE_MAX_SIDE, plus its size when placed.
export async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = /^data:image\/png/i.test(src) && canvas.width * canvas.height < 600 * 600;
  const shown = Math.min(1, IMAGE_SHOWN / Math.max(canvas.width, canvas.height));
  return { src: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', JPEG_QUALITY), w: Math.round(canvas.width * shown), h: Math.round(canvas.height * shown) };
}

const fileUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

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
      const img = await loadImage(await fileUrl(file));
      added.push(B.normalize({ type: 'image', ...img, x: x - img.w / 2, y: y - img.h / 2, alt: file.name }));
      x += img.w + 24;
    } catch {
      toast(`Couldn’t read ${file.name}`, { iconName: 'warn' });
    }
  }
  if (!added.length) return;
  B.commit([...B.currentBoard().elements, ...added]);
  st.selected = added.at(-1).id;
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
  st.selected = null;
  st.view = { x: 0, y: 0, zoom: 1 };
  showBoard(true);
}

function openSaved(id) {
  B.openBoard(id);
  st.selected = null;
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
    if (why === 'close') st.selected = null;
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
