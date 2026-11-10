// Talking to Pulse: JSON commands, page input, the shared state that arrives over server-sent events, and toasts.
import { h } from './dom.js';

export const store = { tabs: null, chat: null };
const listeners = new Set();
let unpaired = () => {};
let goTo = () => {};

export const onState = (fn) => listeners.add(fn);
export const onUnpaired = (fn) => { unpaired = fn; };
export const setRouter = (fn) => { goTo = fn; };
export const go = (view) => goTo(view);

export function setState(part, data) {
  store[part] = data;
  for (const fn of listeners) fn(part);
}

export const activeTab = () => store.tabs?.tabs.find((t) => t.id === store.tabs.activeId) || null;

export async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'X-Pulse': '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  let out = null;
  try { out = await res.json(); } catch {}
  if (res.status === 401) {
    unpaired(out?.error);
    throw new Error(out?.error || 'This phone isn’t paired with Pulse.');
  }
  if (!res.ok || !out?.ok) throw new Error(out?.error || `Pulse answered with an error (${res.status}).`);
  return out.data;
}

// Commands and input report their own errors as toasts and resolve to whether they worked.
export function command(type, args = {}) {
  return api('/api/command', { type, ...args }).then(() => true, (err) => { toast(err.message); return false; });
}

export function sendInput(ev) {
  return api('/api/input', ev).catch((err) => { toast(err.message); });
}

let toastTimer = 0;
export function toast(text, ms = 2600) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
