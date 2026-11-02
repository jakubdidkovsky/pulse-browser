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

// Cache writes cost 1.25× input with the API's 5-minute cache and 2× with Claude Code's 1-hour cache.
const API_CACHE_WRITE = 1.25;
const CLI_CACHE_WRITE = 2;
const VERSION = 2; // v2: Claude Code runs are costed from their own tokens

export function costOf(model, u = {}, cacheWrite = API_CACHE_WRITE) {
  const [pin, pout, pread] = PRICES[model] || PRICES['claude-opus-5-5'];
  return ((u.input_tokens || 0) * pin + (u.cache_creation_input_tokens || 0) * pin * cacheWrite
    + (u.cache_read_input_tokens || 0) * pread + (u.output_tokens || 0) * pout) / 1e6;
}

let log = [];
const open = new Map(); // stream id -> run being measured

export async function initUsage() {
  if (PRIVATE) return;
  const saved = await window.lumen.store.read('usage').catch(() => null);
  log = Array.isArray(saved) ? saved : [];
  // Before v2 a Claude Code run stored its session's running total, so a long chat was counted again and again.
  if (log.some((e) => !e.v)) {
    log = log.map((e) => (e.v || e.provider !== 'claude-code' ? { ...e, v: VERSION } : { ...e, usd: cliCost(e.model, e), v: VERSION }));
    save();
  }
}

const cliCost = (model, e) => costOf(model, { input_tokens: e.input, output_tokens: e.output, cache_read_input_tokens: e.cacheRead, cache_creation_input_tokens: e.cacheWrite }, CLI_CACHE_WRITE);

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
      turns: ev.turns || 0, ms: ev.ms || 0, exact: true,
      model: ev.models?.[0] || run.model,
    });
    // Claude Code's total_cost_usd covers the whole resumed session, not just this run.
    run.usd = cliCost(run.model, run);
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
  log.push({ ...run, v: VERSION });
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

// Pulse's part of one plan window (the 5-hour or the weekly limit). Claude reports the limit only for the
// whole account, so this takes Pulse's Claude Code spend in the window as a share of all Claude Code spend
// on this computer (read from its local transcripts) and applies it to the account's utilization. Rough:
// claude.ai and other devices count toward the limit too but aren't visible here.
export async function planShare(win, span, at) {
  if (PRIVATE || !win?.resetsAt || win.resetsAt < Date.now()) return null;
  const since = win.resetsAt - span;
  const until = at || Date.now();
  const models = await window.lumen.ai.claudeSpend(since, until).catch(() => ({}));
  const all = Object.entries(models || {}).reduce((sum, [model, t]) => sum + cliCost(model, t), 0);
  const runs = log.filter((e) => e.provider === 'claude-code' && e.ts >= since && e.ts <= until);
  const mine = runs.reduce((sum, e) => sum + (e.usd || 0), 0);
  if (!all) return null;
  const perUsd = win.util / all;
  return { pulse: Math.min(1, mine / all) * win.util, total: win.util, perTask: runs.length ? (mine / runs.length) * perUsd : null };
}

export function clearUsage() {
  log = [];
  save();
}
