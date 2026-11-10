// SVG for whiteboard elements: diagram shapes, frames, connectors, notes, text and images, plus the
// selection and connection handles drawn over them.
import { h } from './util.js';
import * as B from './board-model.js';
import { SHAPES, SIDES, STICKY_FONT, outline, sidePoint, labelBox } from './board-geometry.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const STICKY_TEXT = '#1d1d1f';
const FILL_OPACITY = 0.18;
const FRAME_FILL_OPACITY = 0.05;
const FRAME_HEADER = 32;
const QC_OFFSET = 22; // px (screen) between a shape and its quick-connect arrows
const LABEL_BELOW = 22;

export const paint = (c) => B.COLORS[c] || c || B.COLORS.ink;
export const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
};

function htmlText(x, y, w, hgt, text, { color, size = 15, align = 'center', cls = '' }) {
  const fo = svg('foreignObject', { x, y, width: Math.max(1, w), height: Math.max(1, hgt) });
  fo.append(h('div', { class: `bt ${cls} ${align}`, style: { color, fontSize: `${size}px` } }, text));
  return fo;
}

// An arrowhead at `tip`, pointing away from `from`.
function arrowHead(from, tip, color, size) {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const len = 10 + size * 2;
  const p = (da) => `${tip[0] - len * Math.cos(a + da)},${tip[1] - len * Math.sin(a + da)}`;
  return svg('path', { d: `M${p(0.45)} L${tip[0]},${tip[1]} L${p(-0.45)}`, fill: 'none', stroke: color, 'stroke-width': size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
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

function diagramShape(g, e, color, sw) {
  const o = outline(e.type, e.x, e.y, e.w, e.h);
  const filled = e.fill && e.fill !== 'none';
  if (o.open) g.append(svg('rect', { x: e.x, y: e.y, width: e.w, height: e.h, fill: 'transparent' }));
  g.append(svg('path', {
    d: o.d, fill: o.open ? 'none' : filled ? paint(e.fill) : 'transparent', 'fill-opacity': filled ? FILL_OPACITY : 1,
    stroke: color, 'stroke-width': sw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));
  if (o.detail) g.append(svg('path', { d: o.detail, fill: 'none', stroke: color, 'stroke-width': sw }));
  if (!e.text) return;
  const size = e.fontSize || 15;
  if (o.labelBelow) g.append(htmlText(e.x - 60, e.y + e.h + 4, e.w + 120, LABEL_BELOW + size, e.text, { color, size }));
  else {
    const b = labelBox(e.type, e.x, e.y, e.w, e.h);
    g.append(htmlText(b.x, b.y, b.w, b.h, e.text, { color, size }));
  }
}

function frame(g, e, color, sw) {
  // Only the title bar and the border take clicks, so dragging inside a frame still selects its contents.
  g.append(svg('rect', { x: e.x, y: e.y, width: e.w, height: e.h, rx: 12, fill: color, 'fill-opacity': FRAME_FILL_OPACITY, stroke: 'none', 'pointer-events': 'none' }));
  g.append(svg('rect', { x: e.x, y: e.y, width: e.w, height: e.h, rx: 12, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-dasharray': '6 5', class: 'frame-border', 'pointer-events': 'none' }));
  g.append(svg('rect', { x: e.x, y: e.y, width: e.w, height: e.h, rx: 12, class: 'frame-hit' }));
  g.append(svg('rect', { x: e.x, y: e.y, width: e.w, height: FRAME_HEADER, rx: 12, fill: 'transparent' }));
  g.append(htmlText(e.x + 12, e.y + 4, e.w - 24, FRAME_HEADER - 6, e.text || 'Group', { color, size: 13, align: 'left', cls: 'frame-title' }));
}

function connectorShape(g, e, all, color, sw) {
  const c = B.connector(e, all);
  const dash = e.dash ? `${sw * 3} ${sw * 2.5}` : null;
  g.append(svg('path', { d: c.d, class: 'hit' }));
  g.append(svg('path', { d: c.d, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': dash }));
  if (e.type === 'arrow') {
    g.append(arrowHead(c.endFrom, c.end, color, sw));
    if (e.both) g.append(arrowHead(c.startFrom, c.start, color, sw));
  }
  if (e.text) {
    const t = svg('text', { x: c.label[0], y: c.label[1] + 4, 'text-anchor': 'middle', class: 'edge-label', fill: color });
    t.textContent = e.text;
    g.append(t);
  }
}

export function shape(e, all) {
  const g = svg('g', { 'data-id': e.id, class: `el ${e.type}` });
  const color = paint(e.color);
  const sw = e.size || 2;
  if (SHAPES.includes(e.type)) diagramShape(g, e, color, sw);
  else if (e.type === 'frame') frame(g, e, color, sw);
  else if (e.type === 'sticky') {
    g.append(svg('rect', { x: e.x, y: e.y, width: e.w, height: e.h, rx: 8, fill: B.STICKY_FILLS[e.color] || B.STICKY_FILLS.yellow, class: 'sticky-paper' }));
    const b = labelBox('sticky', e.x, e.y, e.w, e.h);
    g.append(htmlText(b.x, b.y, b.w, b.h, e.text || '', { color: STICKY_TEXT, size: STICKY_FONT, align: 'left' }));
  } else if (e.type === 'text') {
    g.append(htmlText(e.x, e.y, e.w, Math.max(e.fontSize * 1.6, (e.text || '').split('\n').length * e.fontSize * 1.45 + 6), e.text || '', { color, size: e.fontSize, align: 'left', cls: 'free' }));
  } else if (B.isConnector(e)) connectorShape(g, e, all, color, sw);
  else if (e.type === 'image') {
    g.append(svg('image', { href: e.src, x: e.x, y: e.y, width: e.w, height: e.h, preserveAspectRatio: 'xMidYMid meet' }));
    g.append(svg('rect', { x: e.x, y: e.y, width: e.w, height: e.h, rx: 6, class: 'image-frame' }));
  } else if (e.type === 'path') {
    const d = smoothPath(e.points);
    g.append(svg('path', { d, class: 'hit' }));
    g.append(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': sw + 0.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  return g;
}

const RESIZABLE = new Set([...SHAPES, 'frame', 'sticky', 'text', 'image']);

// Dashed box around a selected element; a single selected one gets a resize handle, a connector its two ends.
export function selection(e, all, single) {
  const g = svg('g', { class: 'sel' });
  if (B.isConnector(e)) {
    const c = B.connector(e, all);
    if (!single) g.append(svg('path', { d: c.d, class: 'sel-line' }));
    else for (const [end, p] of [['from', c.start], ['to', c.end]]) g.append(svg('circle', { cx: p[0], cy: p[1], r: 6, class: 'end-handle', 'data-end': end }));
    return g;
  }
  const b = B.bounds(e, all);
  g.append(svg('rect', { x: b.x - 6, y: b.y - 6, width: b.w + 12, height: b.h + 12, rx: 8 }));
  if (single && RESIZABLE.has(e.type)) g.append(svg('rect', { x: b.x + b.w + 1, y: b.y + b.h + 1, width: 10, height: 10, rx: 3, class: 'resize-handle' }));
  return g;
}

// Four arrows around a shape: click one to add a connected copy there, drag one to draw a connector.
export function quickConnect(e, all, zoom) {
  const g = svg('g', { class: 'qc-set' });
  const b = B.bounds(e, all);
  const off = QC_OFFSET / zoom;
  const s = 7 / zoom;
  for (const side of SIDES) {
    const [x, y] = sidePoint(e.type, b, side);
    const [dx, dy] = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[side];
    const cx = x + dx * off;
    const cy = y + dy * off;
    const tip = [cx + dx * s, cy + dy * s];
    const base = [[cx - dy * s - dx * s * 0.6, cy + dx * s - dy * s * 0.6], [cx + dy * s - dx * s * 0.6, cy - dx * s - dy * s * 0.6]];
    const btn = svg('g', { class: 'qc', 'data-qc': side, 'data-for': e.id });
    btn.append(svg('circle', { cx, cy, r: s * 1.9, class: 'qc-bg' }));
    btn.append(svg('path', { d: `M${base[0].join(',')} L${tip.join(',')} L${base[1].join(',')} Z`, class: 'qc-arrow' }));
    g.append(btn);
  }
  return g;
}

// The shape a connector is about to attach to, with its four connection points (the nearest one lit).
export function dropTarget(e, all, side, zoom) {
  const g = svg('g', { class: 'drop-target' });
  const b = B.bounds(e, all);
  g.append(svg('rect', { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, rx: 10, class: 'drop-halo' }));
  for (const s of SIDES) {
    const [x, y] = sidePoint(e.type, b, s);
    g.append(svg('circle', { cx: x, cy: y, r: (s === side ? 5.5 : 4) / zoom, class: s === side ? 'port on' : 'port' }));
  }
  return g;
}

// Dotted grid under everything, sized to the visible area.
export function gridLayer() {
  const defs = svg('defs');
  const pattern = svg('pattern', { id: 'board-grid', width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
  pattern.append(svg('circle', { cx: 0.5, cy: 0.5, r: 1, class: 'grid-dot' }));
  defs.append(pattern);
  const rect = svg('rect', { class: 'grid', fill: 'url(#board-grid)', 'pointer-events': 'none' });
  return { defs, rect };
}

// A small picture of a shape for menus and the toolbar.
export function shapeIcon(kind, size = 18) {
  // Drawn at full size and scaled down, so corners and lids keep their real proportions.
  const s = svg('svg', { width: size, height: size, viewBox: '0 0 120 120', class: 'shape-icon' });
  const box = kind === 'actor' ? [35, 10, 50, 100] : kind === 'cylinder' ? [20, 10, 80, 100] : [8, 25, 104, 70];
  const o = outline(kind, ...box);
  const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  s.append(svg('path', { d: o.d, ...stroke }));
  if (o.detail) s.append(svg('path', { d: o.detail, ...stroke }));
  return s;
}
