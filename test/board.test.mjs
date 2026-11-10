// Unit tests for the whiteboard's diagram logic: geometry, auto-layout and draw.io files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import dagre from '@dagrejs/dagre';
import {
  SHAPES, outline, perimeterPoint, facingSides, orthogonalRoute, connectorGeometry, simplify, midpoint, snap,
  preferredSides, orthogonalRoutes, labelBox, wrapText, fitShape, FIT_MAX_W,
} from '../renderer/board-geometry.js';
import { layoutDiagram, placeNew, fitFrames } from '../renderer/board-layout.js';
import { toDrawio, fromDrawio, nearestColor } from '../renderer/board-drawio.js';

const box = (x, y, w = 100, h = 60) => ({ x, y, w, h });
const boundsOf = (e) => ({ x: e.x, y: e.y, w: e.w, h: e.h });
const orthogonal = (points) => points.slice(1).every((p, i) => Math.abs(p[0] - points[i][0]) < 0.01 || Math.abs(p[1] - points[i][1]) < 0.01);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const node = (id, extra = {}) => ({ id, type: 'rect', x: 0, y: 0, w: 120, h: 60, unplaced: true, ...extra });
const arrow = (from, to, extra = {}) => ({ id: `${from}-${to}`, type: 'arrow', from, to, x: 0, y: 0, x2: 0, y2: 0, route: 'orthogonal', ...extra });

// ---------------------------------------------------------------- geometry

test('every shape has a finite outline', () => {
  for (const kind of SHAPES) {
    const o = outline(kind, 10, 20, 160, 90);
    assert.ok(o.d.length > 10, kind);
    assert.doesNotMatch(o.d, /NaN|Infinity/, kind);
  }
});

test('shapes facing each other pick the sides across the gap', () => {
  assert.deepEqual(facingSides(box(0, 0), box(300, 10)), ['right', 'left']);
  assert.deepEqual(facingSides(box(0, 0), box(10, 200)), ['bottom', 'top']);
  assert.deepEqual(facingSides(box(0, 200), box(0, 0)), ['top', 'bottom']);
});

test('an orthogonal connector runs from bottom center to top center with right angles only', () => {
  const g = connectorGeometry('orthogonal', { box: box(0, 0), kind: 'rect' }, { box: box(200, 200), kind: 'rect' });
  assert.deepEqual(g.start, [50, 60]);
  assert.deepEqual(g.end, [250, 200]);
  assert.ok(orthogonal(g.points));
  assert.equal(g.points.length, 4);
});

test('orthogonal routes stay orthogonal for every pair of sides', () => {
  const sides = ['top', 'right', 'bottom', 'left'];
  for (const s1 of sides) {
    for (const s2 of sides) {
      for (const p2 of [[300, 200], [-300, -200], [10, 300], [300, 5]]) {
        const pts = orthogonalRoute([0, 0], s1, p2, s2);
        assert.ok(orthogonal(pts), `${s1} → ${s2} to ${p2}`);
        assert.deepEqual(pts[0], [0, 0]);
        assert.deepEqual(pts.at(-1), p2);
      }
    }
  }
});

test('a straight connector ends on the outline of a diamond', () => {
  const b = box(0, 0, 160, 100);
  const [x, y] = perimeterPoint('diamond', b, [400, 300]);
  assert.ok(Math.abs(Math.abs(x - 80) / 80 + Math.abs(y - 50) / 50 - 1) < 1e-9);
});

test('a connector with one loose end still routes', () => {
  const g = connectorGeometry('orthogonal', { box: box(0, 0), kind: 'rect' }, { point: [400, 30] });
  assert.deepEqual(g.end, [400, 30]);
  assert.ok(orthogonal(g.points));
});

test('simplify drops duplicates and points in the middle of a straight run', () => {
  assert.deepEqual(simplify([[0, 0], [0, 0], [0, 5], [0, 10], [10, 10]]), [[0, 0], [0, 10], [10, 10]]);
});

test('midpoint is halfway along the path', () => {
  assert.deepEqual(midpoint([[0, 0], [0, 10], [10, 10]]), [0, 10]);
  assert.equal(snap(14), 10);
  assert.equal(snap(15), 20);
});

// ---------------------------------------------------------------- layout

test('a chain lays out top to bottom without overlaps', () => {
  const els = [node('a'), node('b'), node('c'), arrow('a', 'b'), arrow('b', 'c')];
  const out = layoutDiagram(els, { direction: 'TB' }, dagre, boundsOf);
  const [a, b, c] = ['a', 'b', 'c'].map((id) => out.find((e) => e.id === id));
  assert.ok(a.y < b.y && b.y < c.y);
  assert.ok(!overlap(a, b) && !overlap(b, c));
  assert.ok([a, b, c].every((e) => e.x % 10 === 0 && e.y % 10 === 0 && !e.unplaced));
});

test('LR lays out left to right', () => {
  const out = layoutDiagram([node('a'), node('b'), arrow('a', 'b')], { direction: 'LR' }, dagre, boundsOf);
  assert.ok(out.find((e) => e.id === 'a').x < out.find((e) => e.id === 'b').x);
});

test('a new diagram goes below what is already on the board', () => {
  const title = { id: 't', type: 'text', x: 40, y: 20, w: 300, h: 30 };
  const out = layoutDiagram([title, node('a'), node('b'), arrow('a', 'b')], { direction: 'TB' }, dagre, boundsOf);
  assert.deepEqual(out.find((e) => e.id === 't'), title);
  assert.ok(out.find((e) => e.id === 'a').y >= 50);
});

test('frames wrap the shapes inside them', () => {
  const frame = { id: 'f', type: 'frame', x: 0, y: 0, w: 10, h: 10, text: 'Backend' };
  const out = layoutDiagram([frame, node('a', { parent: 'f' }), node('b', { parent: 'f' }), node('c'), arrow('a', 'b'), arrow('b', 'c')], { direction: 'TB' }, dagre, boundsOf);
  const f = out.find((e) => e.id === 'f');
  for (const id of ['a', 'b']) {
    const e = out.find((x) => x.id === id);
    assert.ok(e.x >= f.x && e.y >= f.y + 30 && e.x + e.w <= f.x + f.w && e.y + e.h <= f.y + f.h, id);
  }
  assert.ok(!overlap(f, out.find((e) => e.id === 'c')));
});

test('fitFrames ignores frames without children', () => {
  const frame = { id: 'f', type: 'frame', x: 5, y: 5, w: 50, h: 50 };
  assert.deepEqual(fitFrames([frame], boundsOf), [frame]);
});

test('placeNew puts a new shape below the one it connects to, without moving anything else', () => {
  const a = { ...node('a'), x: 100, y: 100, unplaced: false };
  const blocker = { id: 'x', type: 'rect', x: 100, y: 220, w: 120, h: 60 };
  const out = placeNew([a, blocker, node('b'), arrow('a', 'b')], new Set(['b']), { direction: 'TB' }, boundsOf);
  const b = out.find((e) => e.id === 'b');
  assert.deepEqual(out.find((e) => e.id === 'a'), a);
  assert.ok(b.y > a.y + a.h);
  assert.ok(!overlap(b, blocker));
});

// ---------------------------------------------------------------- draw.io

test('a board survives a round trip through a .drawio file', async () => {
  const shapes = SHAPES.map((kind, i) => ({ id: `s${i}`, type: kind, x: i * 200, y: 100, w: 160, h: 80, text: `${kind} & <x>\nline 2`, color: 'blue', fill: 'green' }));
  const frame = { id: 'f', type: 'frame', x: 0, y: 400, w: 400, h: 200, text: 'Group', color: 'gray' };
  const inFrame = { id: 'k', type: 'rect', x: 50, y: 470, w: 100, h: 60, text: 'inside', color: 'ink', parent: 'f' };
  const sticky = { id: 'n', type: 'sticky', x: 600, y: 400, w: 180, h: 120, text: 'note', color: 'yellow' };
  const text = { id: 't', type: 'text', x: 0, y: 0, w: 300, fontSize: 24, text: 'Title', color: 'ink' };
  const edge = { id: 'e', type: 'arrow', from: 's0', to: 's1', x: 0, y: 0, x2: 0, y2: 0, route: 'orthogonal', dash: true, both: true, text: 'yes', color: 'red', fromSide: 'bottom' };
  const loose = { id: 'l', type: 'line', x: 10, y: 20, x2: 300, y2: 40, route: 'straight', color: 'ink' };
  const xml = toDrawio([...shapes, frame, inFrame, sticky, text, edge, loose], 'My diagram');
  const { title, elements } = await fromDrawio(xml);
  assert.equal(title, 'My diagram');
  const get = (id) => elements.find((e) => e.id === id);
  for (const s of shapes) {
    assert.equal(get(s.id).type, s.type);
    assert.equal(get(s.id).text, s.text);
    assert.equal(get(s.id).fill, 'green');
    assert.equal(get(s.id).color, 'blue');
  }
  assert.equal(get('f').type, 'frame');
  assert.deepEqual([get('k').x, get('k').y, get('k').parent], [50, 470, 'f']);
  assert.equal(get('n').type, 'sticky');
  assert.equal(get('t').type, 'text');
  assert.deepEqual(
    [get('e').type, get('e').from, get('e').to, get('e').route, get('e').dash, get('e').both, get('e').text, get('e').fromSide, get('e').color],
    ['arrow', 's0', 's1', 'orthogonal', true, true, 'yes', 'bottom', 'red'],
  );
  assert.deepEqual([get('l').type, get('l').x, get('l').y2, get('l').route], ['line', 10, 40, 'straight']);
});

test('compressed .drawio files are read too', async () => {
  const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Hello" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="10" y="20" width="80" height="80" as="geometry"/></mxCell></root></mxGraphModel>';
  const packed = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64');
  const { elements } = await fromDrawio(`<mxfile><diagram name="P1">${packed}</diagram></mxfile>`);
  assert.deepEqual(elements.map((e) => [e.type, e.text, e.x]), [['diamond', 'Hello', 10]]);
});

test('draw.io groups and HTML labels come in as plain shapes and text', async () => {
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
    + '<mxCell id="g" style="group" vertex="1" parent="1"><mxGeometry x="100" y="100" width="300" height="100" as="geometry"/></mxCell>'
    + '<UserObject label="&lt;b&gt;Web&lt;/b&gt;&lt;br&gt;app" id="w"><mxCell style="rounded=0;html=1;" vertex="1" parent="g"><mxGeometry x="10" y="20" width="120" height="60" as="geometry"/></mxCell></UserObject>'
    + '<mxCell id="e" style="endArrow=classic;html=1;" edge="1" parent="1" source="w" target="missing"><mxGeometry relative="1" as="geometry"><mxPoint x="400" y="50" as="targetPoint"/></mxGeometry></mxCell>'
    + '</root></mxGraphModel>';
  const { elements } = await fromDrawio(xml);
  const w = elements.find((e) => e.id === 'w');
  assert.deepEqual([w.type, w.text, w.x, w.y], ['rect', 'Web\napp', 110, 120]);
  const e = elements.find((x) => x.id === 'e');
  assert.equal(e.from, 'w');
  assert.equal(e.to, undefined);
  assert.equal(e.x2, 400);
  assert.equal(elements.some((x) => x.id === 'g'), false);
});

test('draw.io colors map to the board palette', () => {
  assert.equal(nearestColor('#dae8fc'), 'blue');
  assert.equal(nearestColor('#6c8ebf'), 'blue');
  assert.equal(nearestColor('#82b366'), 'green');
  assert.equal(nearestColor('#b85450'), 'red');
  assert.equal(nearestColor('#000000'), 'ink');
  assert.equal(nearestColor('#666666'), 'gray');
  assert.equal(nearestColor('#ffffff'), 'ink');
  assert.equal(nearestColor('none', 'gray'), 'gray');
});

test('not a draw.io file is rejected', async () => {
  await assert.rejects(fromDrawio('<html></html>'), /not a draw.io diagram/);
});

// ---------------------------------------------------------------- trees and routing around shapes

// The "Kuba Dashboard" diagram that used to come out lopsided, with connectors through other shapes.
const DASHBOARD = {
  kuba: ['notes', 'robots', 'work', 'tasks', 'meet', 'about'], notes: ['papers', 'recaps'], robots: ['issues', 'blue'],
  work: ['proj', 'bytag', 'kanban'], tasks: ['teleop', 'vla', 'onboard'],
};
const dashboard = (place = () => ({})) => {
  const ids = [...new Set(Object.entries(DASHBOARD).flatMap(([p, cs]) => [p, ...cs]))];
  return [...ids.map((id) => node(id, { w: 160, h: 80, ...place(id) })), ...Object.entries(DASHBOARD).flatMap(([p, cs]) => cs.map((c) => arrow(p, c)))];
};
const centerX = (e) => e.x + e.w / 2;
const centerY = (e) => e.y + e.h / 2;

// Every connector's route, computed the way the board does it: around every other shape.
function routes(list, flow) {
  const byId = new Map(list.map((e) => [e.id, e]));
  const shapes = list.filter((e) => e.type !== 'arrow');
  return list.filter((e) => e.type === 'arrow').map((c) => {
    const obstacles = shapes.filter((s) => s.id !== c.from && s.id !== c.to).map(boundsOf);
    const g = connectorGeometry('orthogonal', { box: boundsOf(byId.get(c.from)), kind: 'rect' }, { box: boundsOf(byId.get(c.to)), kind: 'rect' }, { obstacles, flow });
    return { c, g, obstacles };
  });
}
const crosses = (points, b) => points.slice(1).some((q, i) => {
  const p = points[i];
  return Math.min(p[0], q[0]) < b.x + b.w && Math.max(p[0], q[0]) > b.x && Math.min(p[1], q[1]) < b.y + b.h && Math.max(p[1], q[1]) > b.y;
});

test('a tree lays out with every parent centered over its children, in drawing order', () => {
  const out = layoutDiagram(dashboard(), { direction: 'TB' }, dagre, boundsOf);
  const byId = new Map(out.map((e) => [e.id, e]));
  for (const [parent, kids] of Object.entries(DASHBOARD)) {
    const xs = kids.map((k) => centerX(byId.get(k)));
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b), `${parent}'s children keep their order`);
    assert.ok(Math.abs(centerX(byId.get(parent)) - (xs[0] + xs.at(-1)) / 2) <= 5, `${parent} is centered`);
    assert.ok(kids.every((k) => byId.get(k).y > byId.get(parent).y + byId.get(parent).h), `${parent} is above its children`);
  }
  const shapes = out.filter((e) => e.type === 'rect');
  shapes.forEach((a, i) => shapes.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b), `${a.id} / ${b.id}`)));
});

test('an LR tree centers each parent beside its children', () => {
  const out = layoutDiagram([node('r'), node('a'), node('b'), node('c'), arrow('r', 'a'), arrow('r', 'b'), arrow('r', 'c')], { direction: 'LR' }, dagre, boundsOf);
  const [r, a, , c] = ['r', 'a', 'b', 'c'].map((id) => out.find((e) => e.id === id));
  assert.ok(a.x > r.x + r.w);
  assert.ok(Math.abs(centerY(r) - (centerY(a) + centerY(c)) / 2) <= 5);
});

test('a single child sits exactly under its parent, even when it is wider', () => {
  const out = layoutDiagram([node('p'), node('k', { w: 170 }), arrow('p', 'k')], { direction: 'TB' }, dagre, boundsOf);
  const [p, k] = ['p', 'k'].map((id) => out.find((e) => e.id === id));
  assert.equal(centerX(p), centerX(k));
});

test('a shape with two parents still lays out without overlaps', () => {
  const els = [node('a'), node('b'), node('c'), node('d'), arrow('a', 'b'), arrow('a', 'c'), arrow('b', 'd'), arrow('c', 'd')];
  const out = layoutDiagram(els, { direction: 'TB' }, dagre, boundsOf);
  const shapes = out.filter((e) => e.type === 'rect');
  shapes.forEach((a, i) => shapes.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b))));
  assert.ok(out.find((e) => e.id === 'd').y > out.find((e) => e.id === 'b').y);
});

test('a top-down diagram routes every connector from the bottom into the top, through no other shape', () => {
  const out = layoutDiagram(dashboard(), { direction: 'TB' }, dagre, boundsOf);
  for (const { c, g, obstacles } of routes(out, 'TB')) {
    const [from, to] = [c.from, c.to].map((id) => out.find((e) => e.id === id));
    assert.deepEqual(g.start, [centerX(from), from.y + from.h], `${c.id} leaves the bottom`);
    assert.deepEqual(g.end, [centerX(to), to.y], `${c.id} enters the top`);
    assert.ok(orthogonal(g.points));
    assert.ok(obstacles.every((o) => !crosses(g.points, o)), `${c.id} runs through a shape`);
  }
});

test('connectors find a way around shapes on a board without a known direction', () => {
  // Where the old layout had put the dashboard; facing sides alone ran 12 segments through shapes.
  const at = {
    kuba: [1400, 170], notes: [140, 300], robots: [560, 300], work: [980, 300], tasks: [1610, 300], meet: [1820, 300], about: [2030, 300],
    papers: [30, 450], recaps: [240, 450], issues: [450, 450], blue: [660, 450], proj: [870, 450], bytag: [1080, 450], kanban: [1290, 450],
    teleop: [1500, 450], vla: [1710, 450], onboard: [1920, 450],
  };
  const list = dashboard((id) => ({ x: at[id][0], y: at[id][1], unplaced: false }));
  for (const { c, g, obstacles } of routes(list, null)) assert.ok(obstacles.every((o) => !crosses(g.points, o)), `${c.id} runs through a shape`);
});

test('the preferred sides follow the flow when the target lies downstream', () => {
  assert.deepEqual(preferredSides(box(0, 0), box(600, 150), 'TB'), ['bottom', 'top']);
  assert.deepEqual(preferredSides(box(0, 0), box(600, 150), null), ['right', 'left']);
  assert.deepEqual(preferredSides(box(0, 0), box(300, 20), 'TB'), ['right', 'left']); // same row
  assert.deepEqual(preferredSides(box(0, 0), box(150, 600), 'LR'), ['right', 'left']);
});

test('a connector keeps sides the user picked, and still avoids shapes with them', () => {
  const blocker = box(0, 140, 200, 40); // right across the usual halfway bend
  const g = connectorGeometry('orthogonal', { box: box(0, 0), kind: 'rect', side: 'bottom' }, { box: box(300, 300), kind: 'rect', side: 'top' }, { obstacles: [blocker] });
  assert.deepEqual(g.start, [50, 60]);
  assert.deepEqual(g.end, [350, 300]);
  assert.ok(!crosses(g.points, blocker));
});

test('routes between same-facing sides go around instead of doubling back', () => {
  for (const [p2, s] of [[[300, -200], 'top'], [[300, 200], 'top'], [[300, 200], 'bottom'], [[-300, 50], 'left']]) {
    const pts = orthogonalRoutes([0, 0], s, p2, s)[0];
    const k = s === 'top' || s === 'bottom' ? 1 : 0;
    const out = pts.slice(1, -1).map((p) => p[k]);
    // Every bend lies beyond both ends on the side they leave through.
    const beyond = (v) => (s === 'top' || s === 'left' ? v <= Math.min(0, p2[k]) - 20 : v >= Math.max(0, p2[k]) + 20);
    assert.ok(out.every(beyond), `${s} → ${p2}: ${JSON.stringify(pts)}`);
  }
});

// ---------------------------------------------------------------- labels

const perChar = (px) => (s) => s.length * px; // a fake font: every character px wide

test('wrapText breaks between words and notices words too long for a line', () => {
  assert.deepEqual(wrapText('one two three', 1000, perChar(8)), { lines: 1, widest: 13 * 8, split: false });
  assert.equal(wrapText('one two three', 64, perChar(8)).lines, 2);
  assert.equal(wrapText('a\nb', 1000, perChar(8)).lines, 2);
  assert.equal(wrapText('~/rosbags/<take>/{body,hands}', 100, perChar(8)).split, true);
});

test('a short label keeps the default size', () => {
  assert.deepEqual(fitShape('rect', 'Notes', { w: 160, h: 80, measure: perChar(8) }), { w: 160, h: 80 });
  assert.deepEqual(fitShape('diamond', 'OK?', { w: 160, h: 100, measure: perChar(8) }), { w: 160, h: 100 });
});

test('a long label makes the shape wider before taller, and it fits afterwards', () => {
  const text = "Hands (Docker 'recorder', domain 73, CycloneDDS: /hand_*)";
  const measure = perChar(8.5);
  const rect = fitShape('rect', text, { w: 160, h: 80, measure });
  assert.ok(rect.w > 160 && rect.h <= rect.w / 2, `rect ${rect.w}×${rect.h}`);
  for (const kind of ['rect', 'pill', 'diamond', 'ellipse', 'cylinder', 'cloud', 'hexagon', 'document', 'sticky']) {
    const { w, h } = fitShape(kind, text, { w: 160, h: 80, measure });
    assert.ok(w >= 160 && w <= FIT_MAX_W, `${kind} width ${w}`);
    const area = labelBox(kind, 0, 0, w, h);
    const wrapped = wrapText(text, area.w, measure);
    assert.ok(!wrapped.split, `${kind} splits a word`);
    assert.ok(wrapped.lines * 15 * 1.35 <= area.h, `${kind} ${w}×${h} holds ${wrapped.lines} lines`);
  }
});

test('a word longer than the widest shape grows the shape to the maximum width, then taller', () => {
  const { w, h } = fitShape('rect', 'x'.repeat(80) + ' end', { w: 160, h: 80, measure: perChar(8) });
  assert.equal(w, FIT_MAX_W);
  assert.ok(h > 80);
});

test('shapes whose connection points sit inside their box (document, triangle) still connect directly', () => {
  const doc = connectorGeometry('orthogonal', { box: box(0, 0, 160, 80), kind: 'document' }, { box: box(0, 200, 160, 80), kind: 'rect' }, { flow: 'TB' });
  assert.equal(doc.points.length, 2, JSON.stringify(doc.points));
  assert.equal(doc.end[1], 200);
  const tri = connectorGeometry('orthogonal', { box: box(0, 0, 120, 100), kind: 'triangle' }, { box: box(300, 20, 160, 80), kind: 'rect' }, { flow: 'LR' });
  assert.deepEqual(tri.start, [90, 50]);
  assert.deepEqual(tri.end, [300, 60]);
});

test('a connector told to leave the bottom for a shape above goes around both, not back through them', () => {
  const a = box(0, 300, 100, 60);
  const b = box(0, 0, 100, 60);
  const g = connectorGeometry('orthogonal', { box: a, kind: 'rect', side: 'bottom' }, { box: b, kind: 'rect', side: 'top' });
  assert.deepEqual(g.start, [50, 360]);
  assert.deepEqual(g.end, [50, 0]);
  const inside = (o) => crosses(g.points, { x: o.x + 1, y: o.y + 1, w: o.w - 2, h: o.h - 2 });
  assert.ok(!inside(a) && !inside(b), JSON.stringify(g.points));
});
