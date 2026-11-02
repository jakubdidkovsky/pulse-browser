// Small DOM + string helpers shared by the UI modules.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h('div', { class: 'x', onclick }, child, 'text')
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);

export function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  return d;
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export const START_URL = 'lumen:start';
export const isStart = (url) => !url || url === START_URL;

export const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  kagi: { name: 'Kagi', url: 'https://kagi.com/search?q=%s' },
  perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/search?q=%s' },
};

export function searchUrl(q, engine = 'google') {
  return (SEARCH_ENGINES[engine] || SEARCH_ENGINES.google).url.replace('%s', encodeURIComponent(q));
}

export function looksLikeUrl(s) {
  s = s.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^(https?|file|about|chrome|view-source|data):/i.test(s)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(s)) return true;
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)/.test(s)) return true;
  return /^[^\s/?#]+\.[a-z][a-z0-9-]{1,62}(:\d+)?([/?#].*)?$/i.test(s);
}

export function toUrl(input, engine) {
  const s = input.trim();
  if (!s) return null;
  if (/^(https?|file|about|chrome|view-source|data):/i.test(s)) return s;
  if (looksLikeUrl(s)) {
    const local = /^(localhost|(\d{1,3}\.){3}\d{1,3})/i.test(s);
    return (local ? 'http://' : 'https://') + s;
  }
  return searchUrl(s, engine);
}

export function prettyUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return url;
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '') + u.search + u.hash);
  } catch {
    return url;
  }
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export const timeOf = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return dayLabel(ts);
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

const AVATAR_COLORS = ['#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#40c8e0', '#ff453a', '#64d2ff', '#ac8e68'];

export function avatarFor(title, url) {
  const host = hostOf(url);
  const base = (host || title || '?').replace(/^www\./, '');
  const letter = (base.match(/[a-z0-9]/i)?.[0] || '•').toUpperCase();
  let hash = 0;
  for (const ch of base) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { letter, color: AVATAR_COLORS[hash % AVATAR_COLORS.length] };
}

// Favicon <img> with a letter-avatar fallback.
export function favicon(tab, size = 16) {
  const { letter, color } = avatarFor(tab.title, tab.url);
  const fallback = h('span', { class: 'fav-letter', style: { background: color, width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.62)}px` } }, letter);
  if (!tab.favicon) return fallback;
  const img = h('img', { class: 'fav', src: tab.favicon, width: size, height: size, alt: '', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(fallback), { once: true });
  return img;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function withTimeout(promise, ms, fallback = null) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

export const readFileUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

// Any image source → a data: URL whose longest side is at most maxSide (small PNGs stay PNG).
export async function scaledImage(src, maxSide, quality = 0.86) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = /^data:image\/png/i.test(src) && canvas.width * canvas.height < 600 * 600;
  return { url: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', quality), width: canvas.width, height: canvas.height };
}
