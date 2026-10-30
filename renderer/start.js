// Start page sections: frequently visited sites or your own shortcuts.
import { S, setSetting } from './state.js';
import { h, $, hostOf, avatarFor, isStart, toUrl, looksLikeUrl } from './util.js';
import { icon } from './icons.js';
import { showMenu, openModal, toast } from './ui.js';
import * as Tabs from './tabs.js';

const KNOWN = {
  'mail.google.com': 'Gmail', 'docs.google.com': 'Google Docs', 'drive.google.com': 'Google Drive',
  'calendar.google.com': 'Calendar', 'meet.google.com': 'Meet', 'maps.google.com': 'Maps', 'photos.google.com': 'Photos',
  'gemini.google.com': 'Gemini', 'google.com': 'Google', 'youtube.com': 'YouTube', 'music.youtube.com': 'YouTube Music',
  'github.com': 'GitHub', 'gitlab.com': 'GitLab', 'chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT', 'claude.ai': 'Claude',
  'notion.so': 'Notion', 'notion.com': 'Notion', 'linkedin.com': 'LinkedIn', 'facebook.com': 'Facebook',
  'instagram.com': 'Instagram', 'x.com': 'X', 'twitter.com': 'X', 'reddit.com': 'Reddit', 'news.ycombinator.com': 'Hacker News',
  'wikipedia.org': 'Wikipedia', 'en.wikipedia.org': 'Wikipedia', 'cs.wikipedia.org': 'Wikipedie', 'seznam.cz': 'Seznam',
  'email.seznam.cz': 'Seznam Email', 'novinky.cz': 'Novinky', 'alza.cz': 'Alza', 'figma.com': 'Figma', 'linear.app': 'Linear',
  'app.slack.com': 'Slack', 'slack.com': 'Slack', 'web.whatsapp.com': 'WhatsApp', 'outlook.live.com': 'Outlook',
  'outlook.office.com': 'Outlook', 'netflix.com': 'Netflix', 'open.spotify.com': 'Spotify', 'spotify.com': 'Spotify',
  'amazon.com': 'Amazon', 'perplexity.ai': 'Perplexity', 'developer.mozilla.org': 'MDN', 'stackoverflow.com': 'Stack Overflow',
  'vercel.com': 'Vercel', 'cursor.com': 'Cursor',
};
const SKIP_HOST = /^(accounts|login|auth|signin|sso|oauth|id|consent|myaccount)\./;
const SEARCH_PAGE = /^(google\.[a-z.]+\/search|bing\.com\/search|duckduckgo\.com\/\?|search\.brave\.com\/search|kagi\.com\/search|search\.seznam\.cz|perplexity\.ai\/search)/;

export function siteName(host, title) {
  host = host.replace(/^www\./, '');
  if (KNOWN[host]) return KNOWN[host];
  const label = host.split('.').slice(-2, -1)[0] || host;
  const parts = (title || '').split(/\s+[|\-–—·•:]\s+/).map((s) => s.trim()).filter(Boolean);
  const match = parts.find((p) => p.toLowerCase().replace(/\s+/g, '').includes(label.toLowerCase()));
  if (match && match.length <= 24) return match;
  if (parts.length > 1 && parts.at(-1).length <= 20) return parts.at(-1);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function frequentSites(n = 8) {
  const counts = new Map();
  for (const e of S.history.slice(0, 4000)) {
    let u;
    try { u = new URL(e.url); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const host = u.hostname.replace(/^www\./, '');
    if (SKIP_HOST.test(host) || SEARCH_PAGE.test(host + u.pathname + (u.search ? '?' : ''))) continue;
    const c = counts.get(host) || { n: 0, title: e.title, favicon: e.favicon };
    c.n++;
    if (!c.favicon && e.favicon) c.favicon = e.favicon;
    counts.set(host, c);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, n)
    .map(([host, c]) => ({ url: `https://${host}`, title: siteName(host, c.title), favicon: c.favicon }));
}

// Favicon from history for a shortcut's site (no network lookups).
function faviconFor(url) {
  const host = hostOf(url);
  return S.history.find((e) => e.favicon && hostOf(e.url) === host)?.favicon || null;
}

function openUrl(url) {
  const tab = Tabs.activeTab();
  if (tab && isStart(tab.url)) Tabs.navigate(tab, url);
  else Tabs.open(url);
}

function tile(item, { onclick, extra } = {}) {
  const { letter, color } = avatarFor(item.title, item.url);
  const fav = item.favicon || faviconFor(item.url);
  const letterEl = () => h('span', { class: 'tile-letter', style: { background: color } }, letter);
  const icn = fav ? h('img', { src: fav, width: 28, height: 28, alt: '' }) : letterEl();
  if (fav) icn.addEventListener('error', () => icn.replaceWith(letterEl()), { once: true });
  const el = h('button', { class: 'tile', title: item.url, onclick: onclick || (() => openUrl(item.url)) },
    h('span', { class: 'tile-icon' }, icn), h('span', { class: 'tile-label' }, item.title || hostOf(item.url)));
  if (extra) extra(el);
  return el;
}

// ---------------------------------------------------------------- shortcuts

const shortcuts = () => S.settings.start?.shortcuts || [];
const saveShortcuts = (list) => setSetting('start.shortcuts', list);

export function setStartMode(mode) {
  if (mode === 'custom' && !shortcuts().length) {
    // First time: start from what they actually use, then let them edit.
    saveShortcuts(frequentSites(8).map(({ url, title }) => ({ url, title })));
  }
  setSetting('start.mode', mode);
}

export function editShortcut(existing = null, onDone) {
  const name = h('input', { class: 'input', placeholder: 'Name', value: existing?.title || '', maxlength: 30 });
  const url = h('input', { class: 'input', placeholder: 'notion.so or https://…', value: existing?.url || '', spellcheck: 'false' });
  const save = () => {
    const raw = url.value.trim();
    if (!raw || !looksLikeUrl(raw)) { url.focus(); toast('Enter a website address', { iconName: 'info', timeout: 1600 }); return; }
    const full = toUrl(raw, S.settings.engine);
    const item = { url: full, title: name.value.trim() || siteName(hostOf(full), '') };
    const list = [...shortcuts()];
    const i = existing ? list.findIndex((s) => s.url === existing.url && s.title === existing.title) : -1;
    if (i >= 0) list[i] = item; else list.push(item);
    saveShortcuts(list);
    m.close();
    onDone?.();
  };
  const m = openModal({
    title: existing ? 'Edit Shortcut' : 'Add Shortcut',
    width: 400,
    body: h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', {}, 'Website'), url), h('label', { class: 'field' }, h('span', {}, 'Name'), name)),
    footer: [h('div', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, existing ? 'Save' : 'Add')],
  });
  for (const el of [name, url]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  setTimeout(() => (existing ? name : url).focus(), 40);
}

export function removeShortcut(item) {
  saveShortcuts(shortcuts().filter((s) => !(s.url === item.url && s.title === item.title)));
}

function moveShortcut(item, delta) {
  const list = [...shortcuts()];
  const i = list.findIndex((s) => s.url === item.url && s.title === item.title);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveShortcuts(list);
}

function shortcutMenu(item, x, y) {
  showMenu(x, y, [
    { label: 'Open in New Tab', icon: 'plus', action: () => Tabs.open(item.url) },
    { label: 'Edit…', icon: 'compose', action: () => editShortcut(item) },
    { label: 'Move Left', icon: 'back', action: () => moveShortcut(item, -1) },
    { label: 'Move Right', icon: 'forward', action: () => moveShortcut(item, 1) },
    { type: 'separator' },
    { label: 'Remove', icon: 'trash', danger: true, action: () => removeShortcut(item) },
  ]);
}

// ---------------------------------------------------------------- render

let dragIndex = -1;

export function renderStartSections() {
  const favs = $('#start-favs');
  const top = $('#start-top');
  favs.replaceChildren();
  top.replaceChildren();

  // Pinned pages already live in the favorites bar; repeat them here only when that bar is hidden.
  const pinned = S.tabs.filter((t) => t.pinned);
  const barShown = S.settings.pinsLocation !== 'sidebar' && S.settings.favbar !== false;
  if (pinned.length && !barShown) {
    favs.append(h('h3', {}, 'Pinned'), h('div', { class: 'tiles' }, ...pinned.slice(0, 12).map((t) => tile(t, { onclick: () => Tabs.activate(t.id) }))));
  }

  const mode = S.settings.start?.mode || 'frequent';
  if (mode === 'frequent') {
    const list = frequentSites(8);
    if (list.length) {
      top.append(h('h3', {}, 'Frequently Visited'), h('div', { class: 'tiles' }, ...list.map((s) => tile(s))));
    } else {
      const starters = [['https://www.notion.so', 'Notion'], ['https://github.com', 'GitHub'], ['https://www.youtube.com', 'YouTube'], ['https://claude.ai', 'Claude'], ['https://news.ycombinator.com', 'Hacker News'], ['https://www.wikipedia.org', 'Wikipedia']];
      top.append(h('h3', {}, 'Get Started'), h('div', { class: 'tiles' }, ...starters.map(([url, title]) => tile({ url, title }))));
    }
  } else if (mode === 'custom') {
    const list = shortcuts();
    const tiles = list.map((s, i) => tile(s, {
      extra: (el) => {
        el.draggable = true;
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); shortcutMenu(s, e.clientX, e.clientY); });
        el.append(h('span', { class: 'tile-x', title: 'Remove', html: icon('x', 10), onclick: (e) => { e.stopPropagation(); removeShortcut(s); } }));
        el.addEventListener('dragstart', (e) => { dragIndex = i; e.dataTransfer.effectAllowed = 'move'; });
        el.addEventListener('dragover', (e) => { if (dragIndex >= 0) { e.preventDefault(); el.classList.add('drop-before'); } });
        el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
        el.addEventListener('drop', (e) => {
          e.preventDefault();
          el.classList.remove('drop-before');
          if (dragIndex < 0 || dragIndex === i) return;
          const next = [...list];
          const [moved] = next.splice(dragIndex, 1);
          next.splice(dragIndex < i ? i - 1 : i, 0, moved);
          dragIndex = -1;
          saveShortcuts(next);
        });
        el.addEventListener('dragend', () => { dragIndex = -1; });
      },
    }));
    const add = h('button', { class: 'tile add', title: 'Add a shortcut', onclick: () => editShortcut() },
      h('span', { class: 'tile-icon', html: icon('plus', 22) }), h('span', { class: 'tile-label' }, 'Add'));
    top.append(h('h3', {}, 'Shortcuts'), h('div', { class: 'tiles' }, ...tiles, add));
  }
}

export function startMenu(anchor) {
  const mode = S.settings.start?.mode || 'frequent';
  showMenu(0, 0, [
    { type: 'header', label: 'Show on start page' },
    { label: 'Frequently Visited', checked: mode === 'frequent', action: () => setStartMode('frequent') },
    { label: 'My Shortcuts', checked: mode === 'custom', action: () => setStartMode('custom') },
    { label: 'Nothing', checked: mode === 'none', action: () => setStartMode('none') },
    { type: 'separator' },
    { label: 'Add Shortcut…', icon: 'plus', action: () => { if (mode !== 'custom') setStartMode('custom'); editShortcut(); } },
  ], { anchor, align: 'right' });
}
