// Central app state + persistence. UI modules subscribe via onChange().
import { debounce, isStart } from './util.js';

// Private windows keep everything in memory: no session, history or chats on disk.
export const PRIVATE = new URLSearchParams(location.search).has('private');

export const GROUP_COLORS = {
  blue: '#0a84ff', purple: '#bf5af2', pink: '#ff375f', red: '#ff453a', orange: '#ff9f0a',
  yellow: '#ffd60a', green: '#30d158', teal: '#40c8e0', indigo: '#5e5ce6', gray: '#8e8e93',
};

export const ACCENTS = {
  blue: '#007aff', purple: '#af52de', pink: '#ff2d55', red: '#ff3b30', orange: '#ff9500',
  green: '#34c759', teal: '#30b0c7', indigo: '#5856d6', graphite: '#8e8e93',
};

export const DEFAULT_SETTINGS = {
  theme: 'system',
  accent: 'blue',
  engine: 'google',
  suggestions: true,
  sidebarVisible: true,
  sidebarPeek: false,
  favbar: true,
  start: { mode: 'frequent', shortcuts: [] }, // start page: 'frequent' | 'custom' | 'none'
  pinsLocation: 'bar', // 'bar' = favorites bar under the toolbar, 'sidebar' = tiles in the sidebar
  sidebarWidth: 252,
  aiVisible: false,
  aiWidth: 400,
  alwaysOnTop: false,
  // cookies: smart | reject | accept | off; permissions: ask | allow | block per kind
  privacy: {
    cookies: 'smart',
    permissions: { location: 'ask', media: 'ask', notifications: 'ask', clipboard: 'ask', screen: 'ask', devices: 'ask' },
  },
  tabs: {
    sleepAfter: 45, // minutes without use before a tab is unloaded (0 = never)
    archiveAfter: 24, // hours without use before an unpinned tab is archived (0 = never)
    // "Keep at most `max` tabs per site; close the extras once unused for `idle` minutes."
    // site '' = any site (each domain counted separately); otherwise a domain like notion.com.
    rules: [{ id: 'default', site: '', max: 5, idle: 10, enabled: true }],
  },
  ai: {
    provider: null,
    models: {},
    baseUrls: {},
    effort: 'medium',
    sharePage: true,
    screenshot: false,
    maxChars: 60000,
    mode: 'agent',
    agentEffort: 'low',
    agentConfirm: true,
    connectors: true, // let the agent use the user's Claude connectors / MCP servers
    computer: true, // shell + file tools in a working folder (Claude Code), every change approved
    workdir: null, // working folder for computer access (null = home)
    recentDirs: [],
    serverPrefs: {}, // server name -> enabled (default: on, except plugin: servers)
    autoAllowRead: true, // read-only connector actions (search, list, get…) run without asking
    toolAllow: [], // connector tools the user chose to always allow
    knownServers: [],
  },
};

export const S = {
  settings: structuredClone(DEFAULT_SETTINGS),
  tabs: [],
  groups: [],
  activeId: null,
  split: null, // { layout: 'cols' | 'rows' | 'grid', panes: [tabId | null], x, y } while split view is on
  closed: [],
  archive: [],
  history: [],
  activity: [],
  downloads: new Map(),
  secrets: {},
  clis: {},
  win: { maximized: false, fullscreen: false, focused: true },
};

const listeners = new Set();
let frame = 0;

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Schedules a re-render on the next frame; persists the session unless told not to.
export function changed({ persist = true } = {}) {
  if (persist) saveSession();
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const fn of listeners) {
      try { fn(); } catch (err) { console.error(err); }
    }
  });
}

const serializeTab = (t) => ({
  id: t.id, url: t.url, title: t.title, favicon: t.favicon,
  groupId: t.groupId || null, pinned: !!t.pinned, pinnedUrl: t.pinnedUrl || null,
  lastActive: t.lastActive || Date.now(), created: t.created || Date.now(),
  pinTitle: t.pinTitle || null,
  keep: !!t.keep,
});

export const saveSession = debounce(() => {
  if (PRIVATE) return;
  window.lumen.store.write('session', {
    tabs: S.tabs.map(serializeTab),
    groups: S.groups,
    activeId: S.activeId,
    split: S.split ? { layout: S.split.layout, panes: S.split.panes, x: S.split.x, y: S.split.y } : null,
    archive: S.archive.slice(0, 300),
    savedAt: Date.now(),
  });
}, 400);

export const saveSettings = debounce(() => window.lumen.store.write('settings', S.settings), 250);
const saveHistory = debounce(() => { if (!PRIVATE) window.lumen.store.write('history', S.history); }, 1500);

export function setSetting(path, value) {
  const keys = path.split('.');
  let o = S.settings;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
  saveSettings();
  changed({ persist: false });
}

export function addHistory(url, title, favicon) {
  if (isStart(url) || !/^https?:/i.test(url)) return;
  const now = Date.now();
  const last = S.history[0];
  if (last && last.url === url && now - last.ts < 30 * 60 * 1000) {
    if (title) last.title = title;
    if (favicon) last.favicon = favicon;
    last.ts = now;
  } else {
    S.history.unshift({ url, title: title || url, favicon: favicon || null, ts: now });
    if (S.history.length > 8000) S.history.length = 8000;
  }
  saveHistory();
}

export function updateHistoryMeta(url, patch) {
  for (let i = 0; i < Math.min(20, S.history.length); i++) {
    if (S.history[i].url === url) {
      Object.assign(S.history[i], patch);
      saveHistory();
      return;
    }
  }
}

export function removeHistory(predicate) {
  S.history = S.history.filter((e) => !predicate(e));
  saveHistory.flush();
}

export function logActivity(text) {
  S.activity.push({ ts: Date.now(), text });
  if (S.activity.length > 40) S.activity.shift();
}

export async function loadAll() {
  const [settings, session, history] = await Promise.all([
    window.lumen.store.read('settings'),
    PRIVATE ? null : window.lumen.store.read('session'),
    PRIVATE ? null : window.lumen.store.read('history'),
  ]);
  if (settings) {
    S.settings = {
      ...structuredClone(DEFAULT_SETTINGS), ...settings,
      ai: { ...DEFAULT_SETTINGS.ai, ...(settings.ai || {}), ...(settings.ai?.modeChosen ? {} : { mode: 'agent' }) },
      tabs: { ...DEFAULT_SETTINGS.tabs, ...(settings.tabs || {}) },
      start: { ...DEFAULT_SETTINGS.start, ...(settings.start || {}) },
      privacy: { ...DEFAULT_SETTINGS.privacy, ...(settings.privacy || {}), permissions: { ...DEFAULT_SETTINGS.privacy.permissions, ...(settings.privacy?.permissions || {}) } },
    };
  }
  if (Array.isArray(history)) S.history = history;
  return session;
}
