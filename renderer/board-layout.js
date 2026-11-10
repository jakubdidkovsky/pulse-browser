// Auto-layout for whiteboard diagrams: dagre arranges connected shapes in layers (TB, LR, BT, RL) and
// frames are fitted around the shapes inside them. dagre is passed in, so this also runs in node --test.
import { snap } from './board-geometry.js';

export const DIRECTIONS = ['TB', 'LR', 'BT', 'RL'];
const NODE_GAP = 50;
const RANK_GAP = 70;
const FRAME_PAD = 30;
const FRAME_HEADER = 36; // room for the frame's title above its contents
const START = { x: 40, y: 80 }; // where a diagram on an empty board begins
const BELOW_GAP = 80;
const LABEL_ROOM = 24; // extra space between tree levels when connectors carry labels

const isConnector = (e) => e.type === 'line' || e.type === 'arrow';
const isNode = (e) => !isConnector(e) && e.type !== 'path' && e.type !== 'frame';

// Frames fitted around the elements whose `parent` they are (innermost frames first).
export function fitFrames(elements, boundsOf, onlyIds = null) {
  let list = elements;
  const frames = list.filter((e) => e.type === 'frame' && (!onlyIds || onlyIds.has(e.id)));
  const depth = (f, seen = new Set()) => (f.parent && !seen.has(f.id) ? 1 + depth(list.find((x) => x.id === f.parent) || {}, seen.add(f.id)) : 0);
  for (const frame of [...frames].sort((a, b) => depth(b) - depth(a))) {
    const kids = list.filter((e) => e.parent === frame.id && e.id !== frame.id);
    if (!kids.length) continue;
    const boxes = kids.map((k) => boundsOf(k, list));
    const x = Math.min(...boxes.map((b) => b.x)) - FRAME_PAD;
    const y = Math.min(...boxes.map((b) => b.y)) - FRAME_PAD - FRAME_HEADER;
    const w = Math.max(...boxes.map((b) => b.x + b.w)) + FRAME_PAD - x;
    const h = Math.max(...boxes.map((b) => b.y + b.h)) + FRAME_PAD - y;
    list = list.map((e) => (e.id === frame.id ? { ...e, x, y, w, h } : e));
  }
  return list;
}

const STEP = { TB: [0, 1], BT: [0, -1], LR: [1, 0], RL: [-1, 0] };
const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

// Places new shapes into an existing diagram without moving anything else: each goes next to a shape it
// is connected to (below it for TB, right of it for LR…), shifted sideways until it doesn't overlap.
export function placeNew(elements, ids, { direction = 'TB' } = {}, boundsOf) {
  const [sx, sy] = STEP[direction] || STEP.TB;
  const connectors = elements.filter((e) => isConnector(e) && e.from && e.to);
  let list = elements;
  const done = new Set(list.filter((e) => !ids.has(e.id)).map((e) => e.id));
  const boxes = () => list.filter((e) => done.has(e.id) && !isConnector(e) && e.type !== 'frame').map((e) => boundsOf(e, list));
  const neighbor = (id) => {
    const c = connectors.find((k) => (k.to === id && done.has(k.from)) || (k.from === id && done.has(k.to)));
    return c && list.find((e) => e.id === (c.to === id ? c.from : c.to));
  };
  let pending = [...ids].filter((id) => list.some((e) => e.id === id));
  while (pending.length) {
    // Shapes next to an already placed one first; otherwise start a new spot right of everything.
    const id = pending.find((x) => neighbor(x)) || pending[0];
    pending = pending.filter((x) => x !== id);
    const node = list.find((e) => e.id === id);
    const own = boundsOf({ ...node, x: 0, y: 0 }, list);
    const taken = boxes();
    const anchor = neighbor(id);
    let x;
    let y;
    if (anchor) {
      const a = boundsOf(anchor, list);
      x = sx ? (sx > 0 ? a.x + a.w + RANK_GAP : a.x - RANK_GAP - own.w) : a.x + (a.w - own.w) / 2;
      y = sy ? (sy > 0 ? a.y + a.h + RANK_GAP : a.y - RANK_GAP - own.h) : a.y + (a.h - own.h) / 2;
    } else {
      x = taken.length ? Math.max(...taken.map((b) => b.x + b.w)) + NODE_GAP * 2 : START.x;
      y = taken.length ? Math.min(...taken.map((b) => b.y)) : START.y;
    }
    // Slide across the flow direction until there is room.
    for (let i = 0; i < 50 && taken.some((b) => overlaps({ x, y, w: own.w, h: own.h }, b, NODE_GAP / 2)); i++) {
      if (sy) x += own.w + NODE_GAP;
      else y += own.h + NODE_GAP;
    }
    list = list.map((e) => (e.id === id ? { ...e, x: snap(x), y: snap(y) } : e));
    done.add(id);
  }
  return list;
}

// When the connectors form a forest (no shape has two incoming connectors, no cycles): the roots and
// each shape's children, in the order they were drawn. Otherwise null.
function forest(nodes, edges) {
  const parent = new Map();
  const kids = new Map(nodes.map((n) => [n.id, []]));
  for (const c of edges) {
    if (parent.has(c.to)) return null;
    parent.set(c.to, c.from);
    kids.get(c.from).push(c.to);
  }
  const roots = nodes.filter((n) => !parent.has(n.id)).map((n) => n.id);
  // With one parent each, a shape on a cycle can't be reached from any root.
  let reached = 0;
  const todo = [...roots];
  while (todo.length) {
    reached++;
    todo.push(...kids.get(todo.pop()));
  }
  return reached === nodes.length ? { roots, kids } : null;
}

// A tidy tree: every parent centered over its children, siblings in drawing order, each level as deep
// as its biggest shape. Returns top-left positions for `rankdir`; `size(id)` gives a shape's { w, h }.
function treeLayout(nodes, { roots, kids }, rankdir, size, rankGap) {
  const across = rankdir === 'TB' || rankdir === 'BT' ? 'w' : 'h';
  const along = across === 'w' ? 'h' : 'w';
  const level = new Map();
  const levelSize = [];
  const visit = (id, d) => {
    level.set(id, d);
    levelSize[d] = Math.max(levelSize[d] || 0, size(id)[along]);
    for (const k of kids.get(id)) visit(k, d + 1);
  };
  roots.forEach((r) => visit(r, 0));
  const levelAt = [];
  levelSize.reduce((at, s, d) => { levelAt[d] = at; return at + s + rankGap; }, 0);

  // How wide each subtree is across the flow, then where each shape's center goes.
  const span = new Map();
  const row = (ids) => ids.reduce((s, k) => s + span.get(k), 0) + NODE_GAP * Math.max(0, ids.length - 1);
  const measure = (id) => {
    kids.get(id).forEach(measure);
    span.set(id, Math.max(size(id)[across], row(kids.get(id))));
  };
  roots.forEach(measure);
  const center = new Map();
  const place = (id, start) => {
    const ks = kids.get(id);
    let at = start + (span.get(id) - row(ks)) / 2;
    for (const k of ks) {
      place(k, at);
      at += span.get(k) + NODE_GAP;
    }
    const half = size(id)[across] / 2;
    const mid = ks.length ? (center.get(ks[0]) + center.get(ks.at(-1))) / 2 : start + span.get(id) / 2;
    center.set(id, Math.min(Math.max(mid, start + half), start + span.get(id) - half));
  };
  let at = 0;
  for (const r of roots) {
    place(r, at);
    at += span.get(r) + NODE_GAP;
  }
  const reversed = rankdir === 'BT' || rankdir === 'RL';
  return nodes.map((n) => {
    const s = size(n.id);
    const d = level.get(n.id);
    const cross = center.get(n.id) - s[across] / 2;
    const forward = levelAt[d] + (levelSize[d] - s[along]) / 2;
    const flow = reversed ? -forward - s[along] : forward;
    return across === 'w' ? { id: n.id, x: cross, y: flow } : { id: n.id, x: flow, y: cross };
  });
}

// dagre's layered layout, for everything that isn't a plain tree (shared children, cycles, frames).
function dagreLayout(nodes, edges, usedFrames, rankdir, dagre, size) {
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({ rankdir, nodesep: NODE_GAP, ranksep: RANK_GAP, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const s = size(n.id);
    g.setNode(n.id, { width: s.w, height: s.h });
  }
  for (const f of usedFrames) g.setNode(f.id, {});
  for (const n of nodes) if (n.parent && g.hasNode(n.parent)) g.setParent(n.id, n.parent);
  for (const f of usedFrames) if (f.parent && g.hasNode(f.parent)) g.setParent(f.id, f.parent);
  edges.forEach((c, i) => g.setEdge(c.from, c.to, { label: c.text || '', width: c.text ? Math.min(160, c.text.length * 7) : 0, height: c.text ? 18 : 0 }, `e${i}`));
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return { id: n.id, x: p.x - p.width / 2, y: p.y - p.height / 2 };
  });
}

// Lays out the diagram's shapes: a tidy tree when the connectors form one, dagre otherwise. `movable`
// limits which elements may move (default: every shape that is connected, in a frame, or not placed
// yet); the rest stay where they are.
export function layoutDiagram(elements, { direction = 'TB', movable = null } = {}, dagre, boundsOf) {
  const rankdir = DIRECTIONS.includes(direction) ? direction : 'TB';
  const connectors = elements.filter((e) => isConnector(e) && e.from && e.to);
  const linked = new Set(connectors.flatMap((c) => [c.from, c.to]));
  const frames = elements.filter((e) => e.type === 'frame');
  const frameIds = new Set(frames.map((f) => f.id));
  const nodes = elements.filter((e) => isNode(e) && (movable ? movable.has(e.id) : linked.has(e.id) || frameIds.has(e.parent) || e.unplaced));
  if (!nodes.length) return elements;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = connectors.filter((c) => nodeIds.has(c.from) && nodeIds.has(c.to) && c.from !== c.to);
  const usedFrames = frames.filter((f) => nodes.some((n) => n.parent === f.id));
  const sizes = new Map(nodes.map((n) => {
    const b = boundsOf(n, elements);
    // Leave room for a label drawn under a stick figure.
    return [n.id, { w: b.w, h: b.h + (n.type === 'actor' ? 24 : 0) }];
  }));
  const size = (id) => sizes.get(id);
  const trees = usedFrames.length ? null : forest(nodes, edges);
  const laid = trees
    ? treeLayout(nodes, trees, rankdir, size, RANK_GAP + (edges.some((c) => c.text) ? LABEL_ROOM : 0))
    : dagreLayout(nodes, edges, usedFrames, rankdir, dagre, size);

  // Keep the diagram where its shapes were; a brand-new diagram goes under whatever else is on the board.
  const placed = nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && !n.unplaced);
  const others = elements.filter((e) => !nodeIds.has(e.id) && !isConnector(e) && !(frameIds.has(e.id) && usedFrames.includes(e)));
  let origin = START;
  if (placed.length) {
    origin = { x: Math.min(...placed.map((n) => n.x)), y: Math.min(...placed.map((n) => n.y)) };
  } else if (others.length) {
    const boxes = others.map((e) => boundsOf(e, elements));
    origin = { x: Math.min(...boxes.map((b) => b.x)), y: Math.max(...boxes.map((b) => b.y + b.h)) + BELOW_GAP };
  }
  const minX = Math.min(...laid.map((l) => l.x));
  const minY = Math.min(...laid.map((l) => l.y));
  // Frames need room for their title above the first shape inside them.
  const headroom = usedFrames.length ? FRAME_PAD + FRAME_HEADER : 0;
  // Centers go on the grid, so a parent and a child of another width still line up exactly.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const pos = new Map(laid.map((l) => {
    const b = boundsOf(nodeById.get(l.id), elements);
    return [l.id, { x: snap(l.x - minX + origin.x + b.w / 2) - b.w / 2, y: snap(l.y - minY + origin.y + headroom + b.h / 2) - b.h / 2 }];
  }));

  const moved = elements.map((e) => {
    if (!pos.has(e.id)) return e;
    const { unplaced, ...rest } = e;
    return { ...rest, ...pos.get(e.id) };
  });
  return fitFrames(moved, boundsOf, new Set(usedFrames.map((f) => f.id)));
}
