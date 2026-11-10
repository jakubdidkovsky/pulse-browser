// Diagram geometry for the whiteboard: shape outlines, where connectors attach to a shape, and how a
// connector runs between two shapes (straight, orthogonal with rounded bends, or curved).
// Pure functions without the DOM, so they run in node --test too.

export const GRID = 10;
export const snap = (v, step = GRID) => Math.round(v / step) * step;

// Diagram shapes the user and the agent can draw; each fills its x, y, w, h box.
export const SHAPES = ['rect', 'ellipse', 'diamond', 'pill', 'parallelogram', 'hexagon', 'cylinder', 'document', 'cloud', 'actor', 'triangle'];
export const SHAPE_NAMES = {
  rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Decision', pill: 'Start / end', parallelogram: 'Input / output',
  hexagon: 'Preparation', cylinder: 'Database', document: 'Document', cloud: 'Cloud', actor: 'Person', triangle: 'Triangle',
};
export const SIDES = ['top', 'right', 'bottom', 'left'];
export const ROUTES = ['straight', 'orthogonal', 'curved'];

const DIR = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const STUB = 20; // px a connector leaves a shape straight before it bends
const BEND_RADIUS = 8;
const CORNER = 12;

const f = (n) => Math.round(n * 10) / 10;
const pt = ([x, y]) => `${f(x)},${f(y)}`;

function roundedRect(x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${f(x + k)},${f(y)} H${f(x + w - k)} A${f(k)},${f(k)} 0 0 1 ${f(x + w)},${f(y + k)} V${f(y + h - k)} A${f(k)},${f(k)} 0 0 1 ${f(x + w - k)},${f(y + h)} H${f(x + k)} A${f(k)},${f(k)} 0 0 1 ${f(x)},${f(y + h - k)} V${f(y + k)} A${f(k)},${f(k)} 0 0 1 ${f(x + k)},${f(y)} Z`;
}

const polygon = (points) => `M${points.map(pt).join(' L')} Z`;
const skewOf = (w, h) => Math.min(w * 0.2, h * 0.6);
const cylinderLid = (h) => Math.min(h * 0.15, 14);
const documentWave = (h) => Math.min(h * 0.12, 12);

// A cloud drawn in a unit box, scaled into the shape's box.
const CLOUD = [[0.25, 0.8], ['C', 0.05, 0.8, 0, 0.55, 0.15, 0.47], ['C', 0.1, 0.25, 0.35, 0.15, 0.45, 0.27], ['C', 0.5, 0.08, 0.8, 0.08, 0.8, 0.32],
  ['C', 0.98, 0.3, 1.03, 0.6, 0.88, 0.68], ['C', 0.92, 0.85, 0.75, 0.92, 0.65, 0.82], ['C', 0.55, 0.95, 0.32, 0.95, 0.25, 0.8]];

// SVG outline of a shape: `d` is the filled/stroked body, `detail` extra strokes (a cylinder's lid),
// `open` means there is no area to fill (a stick figure), `labelBelow` puts the text under the figure.
export function outline(kind, x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (kind) {
    case 'ellipse':
      return { d: `M${f(x)},${f(cy)} A${f(w / 2)},${f(h / 2)} 0 1 0 ${f(x + w)},${f(cy)} A${f(w / 2)},${f(h / 2)} 0 1 0 ${f(x)},${f(cy)} Z` };
    case 'diamond':
      return { d: polygon([[cx, y], [x + w, cy], [cx, y + h], [x, cy]]) };
    case 'pill':
      return { d: roundedRect(x, y, w, h, Math.min(w, h) / 2) };
    case 'parallelogram': {
      const s = skewOf(w, h);
      return { d: polygon([[x + s, y], [x + w, y], [x + w - s, y + h], [x, y + h]]) };
    }
    case 'hexagon': {
      const s = Math.min(w * 0.2, h * 0.5);
      return { d: polygon([[x + s, y], [x + w - s, y], [x + w, cy], [x + w - s, y + h], [x + s, y + h], [x, cy]]) };
    }
    case 'triangle':
      return { d: polygon([[cx, y], [x + w, y + h], [x, y + h]]) };
    case 'cylinder': {
      const r = cylinderLid(h);
      const rx = f(w / 2);
      return {
        d: `M${f(x)},${f(y + r)} A${rx},${f(r)} 0 0 1 ${f(x + w)},${f(y + r)} V${f(y + h - r)} A${rx},${f(r)} 0 0 1 ${f(x)},${f(y + h - r)} Z`,
        detail: `M${f(x)},${f(y + r)} A${rx},${f(r)} 0 0 0 ${f(x + w)},${f(y + r)}`,
      };
    }
    case 'document': {
      const v = documentWave(h);
      const b = y + h - v;
      return { d: `M${f(x)},${f(y)} H${f(x + w)} V${f(b)} C${f(x + w * 0.7)},${f(b - v * 1.6)} ${f(x + w * 0.35)},${f(b + v * 1.8)} ${f(x)},${f(b)} Z` };
    }
    case 'cloud': {
      const at = (u, v) => `${f(x + u * w)},${f(y + v * h)}`;
      return { d: `M${at(...CLOUD[0])} ${CLOUD.slice(1).map(([, a, b, c, d, e, g]) => `C${at(a, b)} ${at(c, d)} ${at(e, g)}`).join(' ')} Z` };
    }
    case 'actor': {
      const r = Math.min(w, h) * 0.17;
      const hip = y + h * 0.62;
      return {
        d: `M${f(cx - r)},${f(y + r)} A${f(r)},${f(r)} 0 1 0 ${f(cx + r)},${f(y + r)} A${f(r)},${f(r)} 0 1 0 ${f(cx - r)},${f(y + r)} `
          + `M${f(cx)},${f(y + 2 * r)} V${f(hip)} M${f(x + w * 0.12)},${f(y + h * 0.38)} H${f(x + w * 0.88)} `
          + `M${f(cx)},${f(hip)} L${f(x + w * 0.18)},${f(y + h)} M${f(cx)},${f(hip)} L${f(x + w * 0.82)},${f(y + h)}`,
        open: true,
        labelBelow: true,
      };
    }
    default:
      return { d: roundedRect(x, y, w, h, CORNER) };
  }
}

// The middle of one side of a shape, where an orthogonal connector attaches.
export function sidePoint(kind, b, side) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (kind === 'parallelogram') {
    const s = skewOf(b.w, b.h);
    return { top: [b.x + (b.w + s) / 2, b.y], right: [b.x + b.w - s / 2, cy], bottom: [b.x + (b.w - s) / 2, b.y + b.h], left: [b.x + s / 2, cy] }[side];
  }
  if (kind === 'triangle') return { top: [cx, b.y], right: [b.x + b.w * 0.75, cy], bottom: [cx, b.y + b.h], left: [b.x + b.w * 0.25, cy] }[side];
  if (kind === 'document' && side === 'bottom') return [cx, b.y + b.h - documentWave(b.h) * 0.6];
  return { top: [cx, b.y], right: [b.x + b.w, cy], bottom: [cx, b.y + b.h], left: [b.x, cy] }[side];
}

// Where a straight line from the shape's center towards `toward` crosses its outline.
export function perimeterPoint(kind, b, toward) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (!dx && !dy) return [cx, cy];
  const hw = b.w / 2 || 1e-9;
  const hh = b.h / 2 || 1e-9;
  let t;
  if (kind === 'ellipse' || kind === 'cloud') t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (kind === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return [cx + dx * t, cy + dy * t];
}

const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];

// Which sides two shapes face each other with: across the larger gap between them.
export function facingSides(a, b) {
  const [ax, ay] = center(a);
  const [bx, by] = center(b);
  const dx = bx - ax;
  const dy = by - ay;
  const gapX = Math.abs(dx) - (a.w + b.w) / 2;
  const gapY = Math.abs(dy) - (a.h + b.h) / 2;
  const horizontal = gapX > 0 || gapY > 0 ? gapX > gapY : Math.abs(dx) * (a.h + b.h) > Math.abs(dy) * (a.w + b.w);
  if (horizontal) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

// The sides a connector should use in a diagram laid out in `flow` (TB, LR, BT, RL): along the flow
// whenever the target lies further down it (so a tree's branches leave the bottom and enter the top),
// otherwise the sides the two shapes face each other with.
const FLOW_SIDES = { TB: ['bottom', 'top'], BT: ['top', 'bottom'], LR: ['right', 'left'], RL: ['left', 'right'] };
export function preferredSides(a, b, flow = null) {
  const gap = {
    TB: b.y - (a.y + a.h), BT: a.y - (b.y + b.h), LR: b.x - (a.x + a.w), RL: a.x - (b.x + b.w),
  }[flow];
  return gap > 0 ? FLOW_SIDES[flow] : facingSides(a, b);
}

// The side of a box nearest to a loose point (used when only one end of a connector is attached).
export function sideToward(b, p) {
  const [cx, cy] = center(b);
  const dx = (p[0] - cx) / (b.w || 1);
  const dy = (p[1] - cy) / (b.h || 1);
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

const isVertical = (side) => side === 'top' || side === 'bottom';
const add = (p, side, d) => [p[0] + DIR[side][0] * d, p[1] + DIR[side][1] * d];
const opposite = (side) => ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' })[side];

// Drops repeated points and points in the middle of a straight run.
export function simplify(points) {
  const out = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && Math.abs(last[0] - p[0]) < 0.5 && Math.abs(last[1] - p[1]) < 0.5) continue;
    if (out.length >= 2) {
      const a = out.at(-2);
      const straight = (Math.abs(a[0] - last[0]) < 0.5 && Math.abs(last[0] - p[0]) < 0.5) || (Math.abs(a[1] - last[1]) < 0.5 && Math.abs(last[1] - p[1]) < 0.5);
      if (straight) out.pop();
    }
    out.push(p);
  }
  return out;
}

// A route that leaves p1 and enters p2 along one axis (k = 1: vertically), crossing over at `c`.
const crossAt = (p1, p2, k, c) => simplify(k ? [p1, [p1[0], c], [p2[0], c], p2] : [p1, [c, p1[1]], [c, p2[1]], p2]);

// The orthogonal routes from p1 (leaving through side s1) to p2 (entering through side s2), the usual
// one first. Alternatives cross over close to either end, or around the two shapes (`boxes`, optional),
// so a connector can avoid shapes that lie in its way.
export function orthogonalRoutes(p1, s1, p2, s2, boxes = null) {
  const forward = (p, side, q) => (q[0] - p[0]) * DIR[side][0] + (q[1] - p[1]) * DIR[side][1];
  const v1 = isVertical(s1);
  const k = v1 ? 1 : 0; // the axis the connector leaves along
  // Facing each other with room between: two bends, halfway or near either end.
  if (v1 === isVertical(s2) && s1 === opposite(s2) && forward(p1, s1, p2) >= 2 * STUB) {
    const dir = DIR[s1][k];
    return [(p1[k] + p2[k]) / 2, p1[k] + dir * STUB, p2[k] - dir * STUB].map((c) => crossAt(p1, p2, k, c));
  }
  // One bend: leave along s1 and enter along s2 when the corner lies ahead of both.
  const corner = v1 ? [p1[0], p2[1]] : [p2[0], p1[1]];
  if (v1 !== isVertical(s2) && forward(p1, s1, corner) >= STUB && forward(corner, opposite(s2), p2) >= STUB) {
    return [simplify([p1, corner, p2])];
  }
  const a = add(p1, s1, STUB);
  const b = add(p2, s2, STUB);
  // Both leave the same way: out past whichever end sticks out further, then back.
  if (s1 === s2) return [crossAt(p1, p2, k, DIR[s1][k] > 0 ? Math.max(a[k], b[k]) : Math.min(a[k], b[k]))];
  if (v1 === isVertical(s2)) {
    // Opposite sides facing away from each other: out of both and across, between them or around them.
    const m = 1 - k;
    const lanes = [(p1[m] + p2[m]) / 2];
    if (boxes) {
      const lo = Math.min(...boxes.map((x) => (m ? x.y : x.x)));
      const hi = Math.max(...boxes.map((x) => (m ? x.y + x.h : x.x + x.w)));
      lanes.push(hi + STUB, lo - STUB);
    }
    return lanes.map((c) => simplify(k ? [p1, a, [c, a[1]], [c, b[1]], b, p2] : [p1, a, [a[0], c], [b[0], c], b, p2]));
  }
  // Otherwise step out of both shapes first, then join the two stubs.
  const mid = v1 ? [b[0], a[1]] : [a[0], b[1]];
  return [simplify([p1, a, mid, b, p2])];
}

export const orthogonalRoute = (p1, s1, p2, s2) => orthogonalRoutes(p1, s1, p2, s2)[0];

const OBSTACLE_PAD = 6; // px a connector keeps away from other shapes

// Does the axis-aligned segment p–q run through box b (grown by pad; a negative pad only counts the inside)?
function hits(p, q, b, pad) {
  return Math.min(p[0], q[0]) < b.x + b.w + pad && Math.max(p[0], q[0]) > b.x - pad
    && Math.min(p[1], q[1]) < b.y + b.h + pad && Math.max(p[1], q[1]) > b.y - pad;
}

// What a route costs: the shapes it runs through (other shapes, or back through its own two ends),
// its bends and its length. The first and last legs aren't tested against their own shape's box (a
// document's or a triangle's connection point sits inside it); instead they must leave along s1 and
// arrive against s2, or the route doubles back through the shape.
function routeCost(points, obstacles, [source, target], [s1, s2]) {
  const ahead = (p, q, side) => (q[0] - p[0]) * DIR[side][0] + (q[1] - p[1]) * DIR[side][1] > 0;
  let crossings = points.length > 1 ? !ahead(points[0], points[1], s1) + !ahead(points.at(-1), points.at(-2), s2) : 0;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1], points[i]];
    const own = [i > 1 && source, i < points.length - 1 && target].filter(Boolean);
    crossings += obstacles.filter((o) => hits(p, q, o, OBSTACLE_PAD)).length + own.filter((o) => hits(p, q, o, -1)).length;
    length += Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
  }
  return { crossings, bends: points.length - 2, length: Math.round(length) };
}

// Fewest shapes crossed first; then length, where a bend or a side other than the preferred one
// costs like this many px of extra length.
const BEND_COST = 40;
const SIDE_COST = 60;
const score = (r) => r.length + BEND_COST * r.bends + SIDE_COST * r.off;
const better = (a, b) => (a.crossings - b.crossings) || (score(a) - score(b));

// The elbow connector between two attached ends: on the preferred sides unless that runs through a
// shape and some other pair of sides doesn't. Sides the connector names stay fixed.
function elbow(from, to, obstacles, flow) {
  const auto = preferredSides(from.box, to.box, flow);
  const want = [from.side || auto[0], to.side || auto[1]];
  const ends = [from.box, to.box];
  const near = obstacles.filter((o) => o !== from.box && o !== to.box);
  const route = (s1, s2) => orthogonalRoutes(sidePoint(from.kind, from.box, s1), s1, sidePoint(to.kind, to.box, s2), s2, ends)
    .map((points) => ({ points, ...routeCost(points, near, ends, [s1, s2]), off: (s1 !== want[0]) + (s2 !== want[1]) }));
  let best = route(...want)[0];
  if (!best.crossings) return best.points;
  for (const s1 of from.side ? [from.side] : SIDES) {
    for (const s2 of to.side ? [to.side] : SIDES) {
      for (const r of route(s1, s2)) if (better(r, best) < 0) best = r;
    }
  }
  return best.points;
}

// SVG path through orthogonal points with rounded bends.
export function roundedPolyline(points, radius = BEND_RADIUS) {
  if (points.length < 3) return `M${points.map(pt).join(' L')}`;
  let d = `M${pt(points[0])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const inLen = Math.hypot(x - px, y - py) || 1;
    const outLen = Math.hypot(nx - x, ny - y) || 1;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const before = [x - ((x - px) / inLen) * r, y - ((y - py) / inLen) * r];
    const after = [x + ((nx - x) / outLen) * r, y + ((ny - y) / outLen) * r];
    d += ` L${pt(before)} Q${pt([x, y])} ${pt(after)}`;
  }
  return `${d} L${pt(points.at(-1))}`;
}

// The point halfway along a polyline, where a connector's label goes.
export function midpoint(points) {
  const lens = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let left = lens.reduce((s, l) => s + l, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i]) {
      const t = lens[i] ? left / lens[i] : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
    }
    left -= lens[i];
  }
  return points[0];
}

const cubicAt = (p, t) => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]);
};

// How a connector runs. Each end is { box, kind, side? } when attached to a shape, or { point } when loose.
// `obstacles` are the boxes of other shapes an elbow connector should go around; `flow` is the direction
// the diagram was laid out in. Returns the SVG path, both end points, the point each end is approached
// from (for arrowheads), the label position, and a polyline through the connector (for bounds and hit tests).
export function connectorGeometry(route, from, to, { obstacles = [], flow = null } = {}) {
  const looseA = from.point;
  const looseB = to.point;
  const sides = [from.side, to.side];
  if (!looseA && !looseB && route === 'orthogonal') {
    const points = elbow(from, to, obstacles, flow);
    return { d: roundedPolyline(points), start: points[0], end: points.at(-1), startFrom: points[1] || points[0], endFrom: points.at(-2) || points[0], label: midpoint(points), points };
  }
  if (!looseA && !looseB) {
    const auto = preferredSides(from.box, to.box, flow);
    sides[0] = from.side || auto[0];
    sides[1] = to.side || auto[1];
  } else if (!looseA) sides[0] = from.side || sideToward(from.box, looseB);
  else if (!looseB) sides[1] = to.side || sideToward(to.box, looseA);

  if (route === 'straight') {
    const source = looseA || (from.side ? sidePoint(from.kind, from.box, from.side) : center(from.box));
    const target = looseB || (to.side ? sidePoint(to.kind, to.box, to.side) : center(to.box));
    const a = looseA || (from.side ? source : perimeterPoint(from.kind, from.box, target));
    const z = looseB || (to.side ? target : perimeterPoint(to.kind, to.box, source));
    return { d: `M${pt(a)} L${pt(z)}`, start: a, end: z, startFrom: z, endFrom: a, label: midpoint([a, z]), points: [a, z] };
  }

  const a = looseA || sidePoint(from.kind, from.box, sides[0]);
  const z = looseB || sidePoint(to.kind, to.box, sides[1]);
  // A loose end leaves or arrives straight along the line towards the other end.
  const s1 = looseA ? sideToward({ x: a[0], y: a[1], w: 0, h: 0 }, z) : sides[0];
  const s2 = looseB ? sideToward({ x: z[0], y: z[1], w: 0, h: 0 }, a) : sides[1];

  if (route === 'curved') {
    const reach = Math.max(40, Math.hypot(z[0] - a[0], z[1] - a[1]) / 3);
    const c1 = add(a, s1, reach);
    const c2 = add(z, s2, reach);
    const curve = [a, c1, c2, z];
    const points = Array.from({ length: 13 }, (_, i) => cubicAt(curve, i / 12));
    return { d: `M${pt(a)} C${pt(c1)} ${pt(c2)} ${pt(z)}`, start: a, end: z, startFrom: c1, endFrom: c2, label: cubicAt(curve, 0.5), points };
  }

  const points = orthogonalRoute(a, s1, z, s2);
  return { d: roundedPolyline(points), start: a, end: z, startFrom: points[1] || z, endFrom: points.at(-2) || a, label: midpoint(points), points };
}

export function boxOfPoints(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ---------------------------------------------------------------- labels

export const LINE_HEIGHT = 1.35; // .board .bt
export const STICKY_FONT = 14;
export const FIT_MAX_W = 320; // a label wider than this wraps onto more lines instead
const FIT_STEP = 10;
const LABEL_INSET = { diamond: 0.2, triangle: 0.22, hexagon: 0.14, parallelogram: 0.14, ellipse: 0.12, cloud: 0.16 };
// How tall a shape may grow for its label before it gets wider instead (max height = width / ratio).
const FIT_RATIO = { diamond: 1.6, ellipse: 1.6, cloud: 1.4, cylinder: 1, triangle: 1, sticky: 1 };

// The box a shape's label is drawn and wrapped in: inside the slanted or narrow parts of the shape.
export function labelBox(kind, x, y, w, h) {
  if (kind === 'sticky') return { x: x + 12, y: y + 10, w: w - 24, h: h - 20 };
  const inset = LABEL_INSET[kind] || 0;
  const top = kind === 'cylinder' ? cylinderLid(h) * 2 : kind === 'triangle' ? h * 0.35 : 0;
  const bottom = kind === 'document' ? documentWave(h) : 0;
  return { x: x + 8 + w * inset, y: y + 6 + top, w: w - 16 - w * inset * 2, h: h - 12 - top - bottom };
}

// Word wrap like the browser's: how many lines, how wide the widest is, and whether a word was too long
// for a line and had to be split.
export function wrapText(text, width, measure) {
  let lines = 0;
  let widest = 0;
  let split = false;
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/[ \t]+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= width) { line = next; continue; }
      if (line) { lines++; widest = Math.max(widest, measure(line)); }
      const ww = measure(word);
      if (ww > width) { split = true; lines += Math.ceil(ww / width) - 1; }
      line = word;
    }
    lines++;
    widest = Math.max(widest, measure(line));
  }
  return { lines, widest: Math.min(widest, width), split };
}

// Does a tw × th block of text stay inside the outline of a w × h shape, not just inside its label box?
function holds(kind, w, h, tw, th) {
  const area = labelBox(kind, 0, 0, w, h);
  if (tw > area.w + 0.5 || th > area.h + 0.5) return false;
  const u = (tw + 8) / w;
  const v = (th + 4) / h;
  if (kind === 'diamond') return u + v <= 1;
  if (kind === 'ellipse') return u * u + v * v <= 1;
  if (kind === 'cloud') return (u / 0.8) ** 2 + (v / 0.75) ** 2 <= 1;
  return true;
}

// The smallest size, never below w × h, at which `text` fits the shape without splitting a word:
// wider first (up to FIT_MAX_W), then taller. `measure(string)` gives the text's width in px.
export function fitShape(kind, text, { w, h, fontSize = 15, measure }) {
  const lineHeight = fontSize * LINE_HEIGHT;
  let size = { w, h };
  for (let bw = w; bw <= Math.max(w, FIT_MAX_W); bw += FIT_STEP) {
    const { lines, widest, split } = wrapText(text, labelBox(kind, 0, 0, bw, h).w, measure);
    let bh = h;
    while (!holds(kind, bw, bh, widest, lines * lineHeight) && bh < h + 2000) bh += FIT_STEP;
    size = { w: bw, h: bh };
    if (!split && bh <= Math.max(h, bw / (FIT_RATIO[kind] || 2))) break;
  }
  return size;
}
