// Pulse's own AI usage — not the whole Claude account. Every chat answer and agent task is logged
// locally with tokens, API-equivalent cost and time, so you can see what Pulse alone consumes.
import { PRIVATE } from './state.js';

const KEEP_DAYS = 90;
const MAX_ENTRIES = 5000;
const DAY = 86400e3;

// $ per million tokens: [input, output, cache read]; cache writes cost 1.25× input.
export const PRICES = {
  'claude-fable-5-1': [10, 50, 0.25], 'claude-fable-5': [10, 50, 0.25],
  'claude-opus-5-5': [4, 20, 0.2], 'claude-opus-5': [5, 25, 0.5],
  'claude-sonnet-5-5': [2, 10, 0.2], 'claude-sonnet-5': [2, 10, 0.2],
  'claude-haiku-5-5': [0.1, 0.5, 0.01],
};

export function costOf(model, u = {}) {
  const [pin, pout, pread] = PRICES[model] || PRICES['claude-opus-5-5'];
  return ((u.input_tokens || 0) * pin + (u.cache_creation_input_tokens || 0) * pin * 1.25
    + (u.cache_read_input_tokens || 0) * pread + (u.output_tokens || 0) * pout) / 1e6;
}

let log = [];
const open = new Map(); // stream id -> run being measured

export async function initUsage() {
  if (PRIVATE) return;
  const saved = await window.lumen.store.read('usage').catch(() => null);
  log = Array.isArray(saved) ? saved : [];
}

function save() {
  const since = Date.now() - KEEP_DAYS * DAY;
  log = log.filter((e) => e.ts >= since).slice(-MAX_ENTRIES);
  if (!PRIVATE) window.lumen.store.write('usage', log);
}

export function begin(id, { mode, provider, model, site }) {
  open.set(id, { ts: Date.now(), mode, provider, model: model || '', site: site || '', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, turns: 0, ms: 0, exact: false });
}

// API runs report tokens per message; Claude Code reports exact totals once at the end.
export function add(id, ev) {
  const run = open.get(id);
  if (!run) return;
  const u = ev.usage || {};
  if (ev.type === 'usage') {
    Object.assign(run, {
      input: u.input_tokens || 0, output: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0,
      usd: Number(ev.costUsd) || 0, turns: ev.turns || 0, ms: ev.ms || 0, exact: true,
      model: ev.models?.[0] || run.model,
    });
    return;
  }
  if (ev.type !== 'tokens' || run.exact) return;
  run.input += u.input_tokens || 0;
  run.output += u.output_tokens || 0;
  run.cacheRead += u.cache_read_input_tokens || 0;
  run.cacheWrite += u.cache_creation_input_tokens || 0;
  run.usd += costOf(ev.model || run.model, u);
  run.turns += 1;
  if (ev.model) run.model = ev.model;
}

export function end(id) {
  const run = open.get(id);
  if (!run) return;
  open.delete(id);
  if (!run.ms) run.ms = Date.now() - run.ts;
  delete run.exact;
  log.push(run);
  save();
}

const empty = () => ({ agent: 0, chat: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, ms: 0 });

function sum(list) {
  const s = empty();
  for (const e of list) {
    s[e.mode === 'agent' ? 'agent' : 'chat']++;
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'usd', 'ms']) s[k] += e[k] || 0;
  }
  return s;
}

const startOfDay = (ts = Date.now()) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const periodStart = (period) => (period === 'today' ? startOfDay() : startOfDay() - ((period === 'week' ? 7 : 30) - 1) * DAY);

export function summary(since) {
  return sum(log.filter((e) => e.ts >= since));
}

// One bucket per calendar day, oldest first.
export function byDay(days) {
  const first = startOfDay() - (days - 1) * DAY;
  return Array.from({ length: days }, (_, i) => {
    const from = first + i * DAY;
    const until = from + DAY;
    return { day: from, ...sum(log.filter((e) => e.ts >= from && e.ts < until)) };
  });
}

// Biggest consumers by site or model, most expensive first.
export function breakdown(since, key, limit = 5) {
  const groups = new Map();
  for (const e of log) {
    if (e.ts < since) continue;
    const k = e[key] || 'other';
    groups.set(k, [...(groups.get(k) || []), e]);
  }
  return [...groups.entries()].map(([name, list]) => ({ name, ...sum(list) })).sort((a, b) => b.usd - a.usd).slice(0, limit);
}

export function clearUsage() {
  log = [];
  save();
}
