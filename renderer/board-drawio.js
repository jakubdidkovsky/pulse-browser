// draw.io files (.drawio, mxGraph XML) to and from whiteboard elements. Pure string handling without
// the DOM, so it runs in node --test too. Only the first page of a file is read.
import { SHAPES } from './board-geometry.js';

// draw.io's standard swatches for each board color: [fill, stroke].
const SWATCH = {
  blue: ['#dae8fc', '#6c8ebf'], green: ['#d5e8d4', '#82b366'], orange: ['#ffe6cc', '#d79b00'], yellow: ['#fff2cc', '#d6b656'],
  red: ['#f8cecc', '#b85450'], purple: ['#e1d5e7', '#9673a6'], gray: ['#f5f5f5', '#666666'], ink: ['#ffffff', '#000000'],
};
const HUES = { red: 0, orange: 32, yellow: 50, green: 120, blue: 214, purple: 285 };

const KIND_STYLE = {
  rect: 'rounded=1;arcSize=12;', ellipse: 'ellipse;', diamond: 'rhombus;', pill: 'rounded=1;arcSize=50;',
  parallelogram: 'shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;', hexagon: 'shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;',
  cylinder: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=12;', document: 'shape=document;boundedLbl=1;size=0.2;',
  cloud: 'ellipse;shape=cloud;', actor: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;outlineConnect=0;', triangle: 'triangle;direction=north;',
};
const SIDE_XY = { top: [0.5, 0], right: [1, 0.5], bottom: [0.5, 1], left: [0, 0.5] };
const MAX_PATH_POINTS = 60;

// ---------------------------------------------------------------- export

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#xa;');
// Labels are HTML in draw.io (html=1): escape the text, then encode it once more as an attribute.
const label = (text) => escAttr(String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'));
const n = (v) => Math.round(Number(v) * 10) / 10;
const stroke = (c) => (SWATCH[c] ? SWATCH[c][1] : /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : SWATCH.ink[1]);
const fillOf = (c) => (SWATCH[c] ? SWATCH[c][0] : /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : 'none');

function vertexStyle(e) {
  const c = stroke(e.color);
  const colors = `strokeColor=${c};fontColor=${c};`;
  if (e.type === 'text') return `text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;fontSize=${e.fontSize || 18};${colors}`;
  if (e.type === 'sticky') return `shape=note;size=14;whiteSpace=wrap;html=1;backgroundOutline=1;align=left;verticalAlign=top;spacing=10;fillColor=${(SWATCH[e.color] || SWATCH.yellow)[0]};strokeColor=${(SWATCH[e.color] || SWATCH.yellow)[1]};fontColor=#1d1d1f;`;
  if (e.type === 'frame') return `swimlane;startSize=30;rounded=1;arcSize=6;container=1;collapsible=0;html=1;fillColor=none;swimlaneFillColor=none;${colors}`;
  if (e.type === 'image') {
    // draw.io keeps data URLs without ";base64" because ";" separates style entries.
    const src = String(e.src).replace(/^data:([^;,]+);base64,/, 'data:$1,');
    return `shape=image;html=1;imageAspect=0;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;image=${src};`;
  }
  const fill = e.fill && e.fill !== 'none' ? fillOf(e.fill) : '#ffffff';
  return `${KIND_STYLE[e.type] || KIND_STYLE.rect}whiteSpace=wrap;html=1;fillColor=${fill};${colors}${e.fontSize ? `fontSize=${e.fontSize};` : ''}`;
}

function edgeStyle(e) {
  const c = stroke(e.color);
  const route = e.route || 'straight';
  const parts = [route === 'orthogonal' ? 'edgeStyle=orthogonalEdgeStyle;rounded=1;' : route === 'curved' ? 'curved=1;' : '', 'html=1;'];
  parts.push(e.type === 'arrow' ? 'endArrow=classic;' : 'endArrow=none;');
  parts.push(e.type === 'arrow' && e.both ? 'startArrow=classic;' : 'startArrow=none;');
  if (e.dash) parts.push('dashed=1;');
  if (e.fromSide) parts.push(`exitX=${SIDE_XY[e.fromSide][0]};exitY=${SIDE_XY[e.fromSide][1]};exitDx=0;exitDy=0;`);
  if (e.toSide) parts.push(`entryX=${SIDE_XY[e.toSide][0]};entryY=${SIDE_XY[e.toSide][1]};entryDx=0;entryDy=0;`);
  parts.push(`strokeColor=${c};fontColor=${c};strokeWidth=${e.size > 3 ? 3 : 1.5};`);
  return parts.join('');
}

// The board as a .drawio file that draw.io (app.diagrams.net) opens and edits.
export function toDrawio(elements, title = 'Board') {
  const ids = new Map(elements.map((e) => [e.id, e.id === '0' || e.id === '1' ? `n${e.id}` : e.id]));
  const byId = new Map(elements.map((e) => [e.id, e]));
  const frameOf = (e) => (e.parent && byId.get(e.parent)?.type === 'frame' ? byId.get(e.parent) : null);
  const cells = [];
  // Frames first, so their contents (stored relative to them) come after.
  const order = [...elements.filter((e) => e.type === 'frame'), ...elements.filter((e) => e.type !== 'frame')];
  for (const e of order) {
    const id = escAttr(ids.get(e.id));
    if (e.type === 'line' || e.type === 'arrow') {
      const src = e.from && byId.has(e.from) ? ` source="${escAttr(ids.get(e.from))}"` : '';
      const tgt = e.to && byId.has(e.to) ? ` target="${escAttr(ids.get(e.to))}"` : '';
      const loose = `${src ? '' : `<mxPoint x="${n(e.x)}" y="${n(e.y)}" as="sourcePoint"/>`}${tgt ? '' : `<mxPoint x="${n(e.x2)}" y="${n(e.y2)}" as="targetPoint"/>`}`;
      cells.push(`<mxCell id="${id}" value="${label(e.text)}" style="${escAttr(edgeStyle(e))}" edge="1" parent="1"${src}${tgt}><mxGeometry relative="1" as="geometry">${loose}</mxGeometry></mxCell>`);
      continue;
    }
    if (e.type === 'path') {
      const step = Math.max(1, Math.ceil(e.points.length / MAX_PATH_POINTS));
      const pts = e.points.filter((_, i) => i % step === 0 || i === e.points.length - 1);
      const inner = pts.slice(1, -1).map(([x, y]) => `<mxPoint x="${n(x)}" y="${n(y)}"/>`).join('');
      const [a, z] = [pts[0], pts.at(-1)];
      cells.push(`<mxCell id="${id}" value="" style="${escAttr(`endArrow=none;html=1;curved=1;strokeColor=${stroke(e.color)};strokeWidth=${e.size > 3 ? 3 : 1.5};`)}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${n(a[0])}" y="${n(a[1])}" as="sourcePoint"/><mxPoint x="${n(z[0])}" y="${n(z[1])}" as="targetPoint"/>${inner ? `<Array as="points">${inner}</Array>` : ''}</mxGeometry></mxCell>`);
      continue;
    }
    const frame = frameOf(e);
    const x = frame ? e.x - frame.x : e.x;
    const y = frame ? e.y - frame.y : e.y;
    const h = e.type === 'text' ? e.h || e.fontSize * 1.5 : e.h;
    const parent = frame ? escAttr(ids.get(frame.id)) : '1';
    cells.push(`<mxCell id="${id}" value="${e.type === 'image' ? '' : label(e.text)}" style="${escAttr(vertexStyle(e))}" vertex="1" parent="${parent}"><mxGeometry x="${n(x)}" y="${n(y)}" width="${n(e.w)}" height="${n(h)}" as="geometry"/></mxCell>`);
  }
  return `<mxfile host="Pulse" type="device"><diagram id="pulse-board" name="${escAttr(title)}"><mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`;
}

// ---------------------------------------------------------------- import

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, code) => {
  if (code[0] === '#') {
    try { return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)); } catch { return m; }
  }
  return ENTITIES[code.toLowerCase()] ?? m;
});
const attrsOf = (s) => Object.fromEntries([...String(s).matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));

// draw.io labels may be HTML: keep the text and its line breaks.
const plainText = (value, html) => {
  if (!html) return value;
  return decode(value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
};

function styleOf(s) {
  const map = {};
  for (const part of String(s || '').split(';')) {
    if (!part) continue;
    const i = part.indexOf('=');
    if (i < 0) map[part] = true;
    else map[part.slice(0, i)] = part.slice(i + 1);
  }
  return map;
}

// A draw.io color as the nearest board color (so it keeps working in dark mode), or 'ink'.
export function nearestColor(hex, fallback = 'ink') {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (sat < 0.15) return l > 0.85 ? fallback : l > 0.3 ? 'gray' : 'ink';
  let hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;
  const dist = (a) => Math.min(Math.abs(a - hue), 360 - Math.abs(a - hue));
  return Object.entries(HUES).sort((a, b) => dist(a[1]) - dist(b[1]))[0][0];
}

function kindOf(st) {
  const shape = st.shape || '';
  if (st.swimlane || st.container === '1' || shape === 'swimlane') return 'frame';
  if (st.text || shape === 'text') return 'text';
  if (shape === 'note' || shape === 'note2') return 'sticky';
  if (shape === 'image' || st.image) return 'image';
  if (st.rhombus || shape === 'rhombus') return 'diamond';
  if (shape === 'cloud') return 'cloud';
  if (st.ellipse || shape === 'ellipse' || st.doubleEllipse) return 'ellipse';
  if (st.triangle || shape === 'triangle') return 'triangle';
  if (shape === 'parallelogram') return 'parallelogram';
  if (shape === 'hexagon') return 'hexagon';
  if (/^(cylinder\d?|datastore)$/.test(shape)) return 'cylinder';
  if (shape === 'document') return 'document';
  if (shape === 'umlActor' || shape === 'actor') return 'actor';
  if (st.rounded === '1' && Number(st.arcSize) >= 40) return 'pill';
  return 'rect';
}

const sideOf = (x, y) => {
  const fx = Number(x);
  const fy = Number(y);
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return undefined;
  if (fy <= 0.1) return 'top';
  if (fy >= 0.9) return 'bottom';
  if (fx <= 0.1) return 'left';
  if (fx >= 0.9) return 'right';
  return undefined;
};

async function inflate(text) {
  const bytes = Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return decodeURIComponent(await new Response(stream).text());
}

// Walks the XML tags of the first <diagram>: each mxCell with its wrapper (UserObject) and geometry.
function cellsOf(xml) {
  const cells = [];
  let wrapper = null;
  let cell = null;
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w.:-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (closing) {
      if (tag === 'mxCell') cell = null;
      else if (tag === 'UserObject' || tag === 'object') wrapper = null;
      continue;
    }
    const attrs = attrsOf(rawAttrs);
    if (tag === 'UserObject' || tag === 'object') {
      wrapper = selfClosing ? null : attrs;
    } else if (tag === 'mxCell') {
      const merged = wrapper ? { ...attrs, id: wrapper.id || attrs.id, value: wrapper.label ?? attrs.value } : attrs;
      cells.push({ ...merged, points: [] });
      cell = selfClosing ? null : cells.at(-1);
    } else if (tag === 'mxGeometry' && cell) {
      cell.geometry = attrs;
    } else if (tag === 'mxPoint' && cell) {
      if (attrs.as === 'sourcePoint') cell.sourcePoint = attrs;
      else if (attrs.as === 'targetPoint') cell.targetPoint = attrs;
      else if (!attrs.as) cell.points.push(attrs);
    }
  }
  return cells;
}

// Reads a .drawio / mxGraph XML file into board elements (absolute coordinates, ready for normalize()).
export async function fromDrawio(text) {
  let xml = String(text || '');
  const diagram = /<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/.exec(xml);
  const title = diagram ? attrsOf(diagram[1]).name || '' : '';
  if (diagram) {
    const body = diagram[2].trim();
    xml = body.startsWith('<') ? body : await inflate(body);
  }
  if (!/<mxGraphModel|<root/.test(xml)) throw new Error('This is not a draw.io diagram.');
  const cells = cellsOf(xml);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const layers = new Set(cells.filter((c) => !c.parent || c.parent === '0' || !byId.has(c.parent)).map((c) => c.id));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // Children of groups and containers are stored relative to them.
  const offset = (id, seen = new Set()) => {
    const c = byId.get(id);
    if (!c || layers.has(id) || seen.has(id) || c.edge === '1') return [0, 0];
    seen.add(id);
    const [px, py] = offset(c.parent, seen);
    return [px + num(c.geometry?.x), py + num(c.geometry?.y)];
  };

  const elements = [];
  const edgeLabels = [];
  for (const c of cells) {
    if (layers.has(c.id)) continue;
    const st = styleOf(c.style);
    const text = plainText(c.value || '', st.html === '1');
    if (c.vertex === '1') {
      if (st.edgeLabel && byId.get(c.parent)?.edge === '1') { edgeLabels.push([c.parent, text]); continue; }
      if (st.group || c.style === 'group') continue;
      const kind = kindOf(st);
      const [x, y] = offset(c.id);
      const w = num(c.geometry?.width) || 120;
      const h = num(c.geometry?.height) || 60;
      const strokeColor = st.strokeColor && st.strokeColor !== 'none' ? st.strokeColor : st.fontColor;
      const fill = st.fillColor && !/^(none|#ffffff|#fff|default)$/i.test(st.fillColor) ? nearestColor(st.fillColor, 'gray') : undefined;
      const parent = c.parent && !layers.has(c.parent) && kindOf(styleOf(byId.get(c.parent)?.style)) === 'frame' ? c.parent : undefined;
      const base = { id: c.id, x, y, w, h, color: nearestColor(strokeColor), ...(parent ? { parent } : {}) };
      if (kind === 'image') {
        const src = String(st.image || '').replace(/^data:([^;,]+),(?!.*;base64)/, 'data:$1;base64,');
        if (/^(data:image\/|https?:\/\/)/i.test(src)) elements.push({ ...base, type: 'image', src, alt: text || undefined });
        continue;
      }
      if (kind === 'text') { elements.push({ ...base, type: 'text', text, fontSize: num(st.fontSize) || 16 }); continue; }
      if (kind === 'sticky') { elements.push({ ...base, type: 'sticky', text, color: nearestColor(st.fillColor, 'yellow') }); continue; }
      if (kind === 'frame') { elements.push({ ...base, type: 'frame', text }); continue; }
      elements.push({ ...base, type: SHAPES.includes(kind) ? kind : 'rect', text, ...(fill ? { fill } : {}) });
    } else if (c.edge === '1') {
      const route = st.edgeStyle && st.edgeStyle !== 'none' ? 'orthogonal' : st.curved === '1' ? 'curved' : 'straight';
      const head = (v) => v && v !== 'none';
      const end = head(st.endArrow ?? 'classic');
      const start = head(st.startArrow);
      const sp = c.sourcePoint || {};
      const tp = c.targetPoint || {};
      elements.push({
        id: c.id, type: end || start ? 'arrow' : 'line', text, route,
        ...(c.source ? { from: c.source } : {}), ...(c.target ? { to: c.target } : {}),
        ...(sideOf(st.exitX, st.exitY) ? { fromSide: sideOf(st.exitX, st.exitY) } : {}),
        ...(sideOf(st.entryX, st.entryY) ? { toSide: sideOf(st.entryX, st.entryY) } : {}),
        ...(st.dashed === '1' ? { dash: true } : {}), ...(end && start ? { both: true } : {}),
        x: num(sp.x), y: num(sp.y), x2: num(tp.x), y2: num(tp.y),
        color: nearestColor(st.strokeColor),
      });
    }
  }
  const labels = new Map(edgeLabels);
  const known = new Set(elements.map((e) => e.id));
  return {
    title,
    elements: elements.map((e) => {
      const withLabel = labels.has(e.id) && !e.text ? { ...e, text: labels.get(e.id) } : e;
      // Connectors whose shapes didn't come along (groups, unsupported cells) keep their loose ends.
      const { from, to, ...rest } = withLabel;
      return { ...rest, ...(from && known.has(from) ? { from } : {}), ...(to && known.has(to) ? { to } : {}) };
    }),
  };
}
