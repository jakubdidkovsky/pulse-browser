// The whiteboard's format bar, shown above the toolbar for a selection: shape, fill, text size,
// connector style, alignment and stacking of everything selected. Also the shape picker.
import { h } from './util.js';
import { icon } from './icons.js';
import { showMenu, popover } from './ui.js';
import * as B from './board-model.js';
import { SHAPES, SHAPE_NAMES } from './board-geometry.js';
import { shapeIcon, svg } from './board-render.js';

const FILLS = ['none', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'gray'];
const TEXT_SIZES = [['Small', 13], ['Medium', 15], ['Large', 20], ['Huge', 28]];
const ROUTE_ICONS = { straight: 'M4 20 L20 4', orthogonal: 'M4 20 V12 H20 V4', curved: 'M4 20 C4 8 20 16 20 4' };
const HEAD_ICONS = { none: 'M3 12 H21', end: 'M3 12 H20 M15 7 L20 12 L15 17', both: 'M4 12 H20 M15 7 L20 12 L15 17 M9 7 L4 12 L9 17' };
const ROUTE_NAMES = { straight: 'Straight', orthogonal: 'Elbow (right angles)', curved: 'Curved' };

export function shapePicker(anchor, current, onPick) {
  const pick = (kind) => { close(); onPick(kind); };
  const grid = h('div', { class: 'shape-grid' }, ...SHAPES.map((kind) => h('button', {
    class: `shape-pick${kind === current ? ' on' : ''}`, title: SHAPE_NAMES[kind], onclick: () => pick(kind),
  }, shapeIcon(kind, 24), h('span', {}, SHAPE_NAMES[kind]))));
  const close = popover(anchor, grid, { width: 276 });
}

function lineIcon(d, dashed = false) {
  const s = svg('svg', { width: 16, height: 16, viewBox: '0 0 24 24' });
  s.append(svg('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': dashed ? '4 4' : null }));
  return s;
}

const swatch = (c) => h('i', { class: `fmt-swatch${c === 'none' ? ' none' : ''}`, style: { '--c': B.COLORS[c] || 'transparent' } });

// Lines up the selected boxes on one edge or center, or spaces them evenly.
function aligned(list, how) {
  const boxes = list.map((e) => ({ e, b: B.bounds(e) }));
  const minX = Math.min(...boxes.map(({ b }) => b.x));
  const maxX = Math.max(...boxes.map(({ b }) => b.x + b.w));
  const minY = Math.min(...boxes.map(({ b }) => b.y));
  const maxY = Math.max(...boxes.map(({ b }) => b.y + b.h));
  const at = new Map();
  if (how === 'spread-x' || how === 'spread-y') {
    const horizontal = how === 'spread-x';
    const sorted = [...boxes].sort((a, b) => (horizontal ? a.b.x - b.b.x : a.b.y - b.b.y));
    const total = sorted.reduce((s, { b }) => s + (horizontal ? b.w : b.h), 0);
    const gap = ((horizontal ? maxX - minX : maxY - minY) - total) / Math.max(1, sorted.length - 1);
    let pos = horizontal ? minX : minY;
    for (const { e, b } of sorted) {
      at.set(e.id, horizontal ? { x: pos } : { y: pos });
      pos += (horizontal ? b.w : b.h) + gap;
    }
  } else {
    for (const { e, b } of boxes) {
      at.set(e.id, {
        left: { x: minX }, center: { x: (minX + maxX) / 2 - b.w / 2 }, right: { x: maxX - b.w },
        top: { y: minY }, middle: { y: (minY + maxY) / 2 - b.h / 2 }, bottom: { y: maxY - b.h },
      }[how]);
    }
  }
  return at;
}

// `selected` are the selected elements; `update(fn)` replaces each selected element with fn(element);
// `act(name)` runs board actions (front, back, duplicate, delete); `place(map)` moves elements by id.
export function formatBar({ selected, update, act, place, defaults }) {
  const boxes = selected.filter((e) => SHAPES.includes(e.type));
  const texts = selected.filter((e) => SHAPES.includes(e.type) || e.type === 'text');
  const lines = selected.filter(B.isConnector);
  const movable = selected.filter((e) => B.isBox(e));
  const parts = [];
  const btn = (title, content, onclick, on = false) => h('button', { class: `fmt-btn${on ? ' on' : ''}`, title, onclick }, content);

  if (boxes.length) {
    const kind = boxes[0].type;
    parts.push(btn('Shape', [shapeIcon(kind, 16), h('span', { html: icon('chevronDown', 10) })], (e) => shapePicker(e.currentTarget, kind, (k) => {
      defaults.shape = k;
      update((x) => (SHAPES.includes(x.type) ? { ...x, type: k } : x));
    })));
    const fill = boxes[0].fill || 'none';
    parts.push(btn('Fill', [swatch(fill), h('span', { html: icon('chevronDown', 10) })], (e) => showMenu(0, 0, FILLS.map((c) => ({
      label: c === 'none' ? 'No fill' : c[0].toUpperCase() + c.slice(1), checked: c === fill,
      action: () => update((x) => (SHAPES.includes(x.type) ? { ...x, fill: c === 'none' ? undefined : c } : x)),
    })), { anchor: e.currentTarget })));
  }
  if (texts.length) {
    const size = texts[0].fontSize || (texts[0].type === 'text' ? 18 : 15);
    parts.push(btn('Text size', [h('b', { class: 'fmt-aa' }, 'Aa'), h('span', { html: icon('chevronDown', 10) })], (e) => showMenu(0, 0, TEXT_SIZES.map(([label, px]) => ({
      label, checked: px === size, action: () => update((x) => (texts.some((t) => t.id === x.id) ? { ...x, fontSize: px } : x)),
    })), { anchor: e.currentTarget })));
  }
  if (lines.length) {
    const route = lines[0].route || 'straight';
    for (const r of Object.keys(ROUTE_ICONS)) {
      parts.push(btn(ROUTE_NAMES[r], lineIcon(ROUTE_ICONS[r]), () => {
        defaults.route = r;
        update((x) => (B.isConnector(x) ? { ...x, route: r } : x));
      }, r === route));
    }
    const dashed = !!lines[0].dash;
    parts.push(btn(dashed ? 'Solid line' : 'Dashed line', lineIcon('M3 12 H21', true), () => update((x) => (B.isConnector(x) ? { ...x, dash: !dashed || undefined } : x)), dashed));
    const heads = lines[0].type === 'line' ? 'none' : lines[0].both ? 'both' : 'end';
    parts.push(btn('Arrowheads', [lineIcon(HEAD_ICONS[heads]), h('span', { html: icon('chevronDown', 10) })], (e) => showMenu(0, 0, [
      ['none', 'No arrowheads'], ['end', 'Arrow at the end'], ['both', 'Arrows at both ends'],
    ].map(([k, label]) => ({
      label, checked: k === heads,
      action: () => update((x) => (B.isConnector(x) ? { ...x, type: k === 'none' ? 'line' : 'arrow', both: k === 'both' || undefined } : x)),
    })), { anchor: e.currentTarget })));
  }
  if (movable.length > 1) {
    parts.push(btn('Align', [h('span', { html: icon('splitCols', 14) }), h('span', { html: icon('chevronDown', 10) })], (e) => showMenu(0, 0, [
      ['left', 'Align left edges'], ['center', 'Align centers'], ['right', 'Align right edges'], null,
      ['top', 'Align top edges'], ['middle', 'Align middles'], ['bottom', 'Align bottom edges'], null,
      ['spread-x', 'Space evenly across'], ['spread-y', 'Space evenly down'],
    ].map((it) => (it ? { label: it[1], action: () => place(aligned(movable, it[0])) } : { type: 'separator' })), { anchor: e.currentTarget })));
  }
  if (parts.length) parts.push(h('i', { class: 'bt-sep' }));
  parts.push(
    btn('Bring to front', h('span', { html: icon('up', 14) }), () => act('front')),
    btn('Send to back', h('span', { html: icon('down', 14) }), () => act('back')),
    btn('Duplicate (Ctrl+D)', h('span', { html: icon('copy', 14) }), () => act('duplicate')),
    btn('Delete (Del)', h('span', { html: icon('trash', 14) }), () => act('delete')),
  );
  return h('div', { class: 'board-format' }, ...parts);
}
