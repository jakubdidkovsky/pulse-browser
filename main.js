'use strict';
const {
  app, BrowserWindow, ipcMain, session, webContents, Menu, shell, clipboard,
  nativeTheme, dialog, protocol, net, safeStorage,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const store = require('./lib/store');
const ai = require('./lib/ai');
const agent = require('./lib/agent');
const sites = require('./lib/sites');
const extensions = require('./lib/extensions');
const cookies = require('./lib/cookies');
const claudeSpend = require('./lib/claude-spend');
const adblock = require('./lib/adblock');
const remote = require('./lib/remote');
const chatNotes = require('./lib/chat-notes');

const isMac = process.platform === 'darwin';
const PARTITION = 'persist:lumen';
const PRIVATE_PARTITION = 'lumen-private'; // in-memory: nothing reaches the disk
const IMAGE_FETCH_TIMEOUT = 8000; // ms
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SAVE_CHARS = 64 * 1024 * 1024;
const ROOT = __dirname;

app.setName('Pulse');

// The app used to be called Lumen: carry settings, logins, history and agent sessions over once.
function lockAlive(dir) {
  try {
    const target = fs.readlinkSync(path.join(dir, 'SingletonLock'));
    const pid = Number(target.split('-').pop());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function migrateFromLumen() {
  if (process.env.LUMEN_USER_DATA) return 'skip';
  const appData = app.getPath('appData');
  const oldDir = path.join(appData, 'Lumen');
  const newDir = path.join(appData, 'Pulse');
  const hasData = (d) => fs.existsSync(path.join(d, 'data', 'settings.json')) || fs.existsSync(path.join(d, 'data', 'session.json'));
  if (!hasData(oldDir) || hasData(newDir)) return 'skip';
  if (lockAlive(oldDir)) return 'blocked';
  try {
    if (!fs.existsSync(newDir)) fs.renameSync(oldDir, newDir);
  } catch {}
  if (!hasData(newDir)) {
    fs.cpSync(oldDir, newDir, { recursive: true, force: true, filter: (src) => !/Singleton(Lock|Socket|Cookie)$/.test(src) });
  }
  // Claude Code keys sessions by working directory; move them with the agent workspace so chats can resume.
  const projects = path.join(require('node:os').homedir(), '.claude', 'projects');
  const key = (p) => p.replace(/[/.]/g, '-');
  const from = path.join(projects, key(path.join(oldDir, 'agent-workspace')));
  const to = path.join(projects, key(path.join(newDir, 'agent-workspace')));
  try {
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
  } catch {}
  return 'done';
}

const migration = migrateFromLumen();

if (process.env.LUMEN_USER_DATA) {
  fs.mkdirSync(process.env.LUMEN_USER_DATA, { recursive: true });
  app.setPath('userData', process.env.LUMEN_USER_DATA);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'lumen', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Thin, auto-hiding scrollbars in web pages (macOS-like) on Linux/Windows.
if (!isMac) app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null; // the main window
const uiWindows = new Map(); // UI webContents id -> { win, privateMode }
let lastFocused = null;

const alive = (w) => w && !w.isDestroyed();

// The Pulse window that hosts a webview / owns a UI webContents.
function uiWindowFor(contents) {
  const wc = contents?.hostWebContents || contents;
  const entry = wc && uiWindows.get(wc.id);
  if (entry && alive(entry.win)) return entry.win;
  return (alive(lastFocused) && lastFocused) || (alive(win) && win) || null;
}

function sendTo(contents, channel, ...args) {
  const w = uiWindowFor(contents);
  if (alive(w)) w.webContents.send(channel, ...args);
}

function send(channel, ...args) {
  const w = (alive(lastFocused) && lastFocused) || win;
  if (alive(w)) w.webContents.send(channel, ...args);
}

// ---------------------------------------------------------------- app:// assets

const VENDOR = {
  'marked.js': 'node_modules/marked/lib/marked.esm.js',
  'purify.js': 'node_modules/dompurify/dist/purify.es.mjs',
  'dagre.js': 'node_modules/@dagrejs/dagre/dist/dagre.esm.js',
};

function resolveAsset(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  let base = path.join(ROOT, 'renderer');
  let sub = rel;
  if (rel.startsWith('vendor/')) {
    const name = rel.slice(7);
    if (VENDOR[name]) return path.join(ROOT, VENDOR[name]);
    if (name.startsWith('inter/')) {
      base = path.join(ROOT, 'node_modules/@fontsource-variable/inter');
      sub = name.slice(6);
    } else return null;
  }
  const full = path.normalize(path.join(base, sub || 'index.html'));
  return full.startsWith(base) ? full : null;
}

function registerAppProtocol() {
  protocol.handle('lumen', (req) => {
    const file = resolveAsset(new URL(req.url).pathname);
    if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ---------------------------------------------------------------- secrets (API keys never reach the renderer)

function readSecrets() {
  return store.read('secrets', {}) || {};
}

function getKey(provider) {
  const enc = readSecrets()[provider];
  if (!enc) return null;
  try {
    if (enc.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(enc.slice(4), 'base64'));
    if (enc.startsWith('b64:')) return Buffer.from(enc.slice(4), 'base64').toString('utf8');
  } catch (err) {
    console.error('could not decrypt key', provider, err);
  }
  return null;
}

function setKey(provider, key) {
  const secrets = { ...readSecrets() };
  if (!key) delete secrets[provider];
  else if (safeStorage.isEncryptionAvailable()) secrets[provider] = 'enc:' + safeStorage.encryptString(key).toString('base64');
  else secrets[provider] = 'b64:' + Buffer.from(key, 'utf8').toString('base64');
  store.write('secrets', secrets, 0);
}

// ---------------------------------------------------------------- keyboard shortcuts

function shortcutFor(input) {
  if (input.type !== 'keyDown') return null;
  const mod = isMac ? input.meta : input.control;
  const key = input.key || '';
  const k = key.toLowerCase();
  const code = input.code || '';
  const letter = /^[a-z]$/.test(k) ? k : code.startsWith('Key') ? code.slice(3).toLowerCase() : k;

  if (key === 'F5') return input.shift ? 'hardReload' : 'reload';
  if (key === 'F12') return 'devtools';
  if (input.control && key === 'Tab') return input.shift ? 'prevTab' : 'nextTab';
  if (input.control && code === 'PageDown') return 'nextTab';
  if (input.control && code === 'PageUp') return 'prevTab';
  if (input.alt && !mod && !input.shift) {
    if (key === 'ArrowLeft') return 'back';
    if (key === 'ArrowRight') return 'forward';
  }
  if (!mod) return null;

  if (input.alt) {
    if (letter === 'i') return input.shift ? 'uiDevtools' : 'devtools';
    return null;
  }
  if (key === '+' || key === '=' || code === 'NumpadAdd') return 'zoomIn';
  if (key === '-' || key === '_' || code === 'NumpadSubtract') return 'zoomOut';
  if (key === '0' || code === 'Numpad0') return 'zoomReset';
  if (input.shift) {
    switch (letter) {
      case 't': return 'reopenTab';
      case 'r': return 'hardReload';
      case 'i': return 'devtools';
      case 'l': return 'toggleSidebar';
      case 'c': return 'copyUrl';
      case 'n': return 'privateWindow';
      case 'b': return 'toggleFavbar';
      default: return null;
    }
  }
  if (/^[1-9]$/.test(key)) return `tab:${key}`;
  const digit = code.match(/^Digit([1-9])$/);
  if (digit) return `tab:${digit[1]}`;
  if (key === '[' || code === 'BracketLeft') return 'back';
  if (key === ']' || code === 'BracketRight') return 'forward';
  if (key === '\\' || code === 'Backslash') return 'toggleSidebar';
  if (key === ',' || code === 'Comma') return 'settings';
  switch (letter) {
    case 't': return 'newTab';
    case 'n': return 'newTab';
    case 'w': return 'closeTab';
    case 'l': return 'focusAddress';
    case 'k': return 'palette';
    case 'r': return 'reload';
    case 'e': return 'toggleAI';
    case 'y': return 'history';
    case 'h': return isMac ? null : 'history';
    case 'd': return 'pinTab';
    case 'f': return 'find';
    case 'g': return 'findNext';
    default: return null;
  }
}

function attachShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    const action = shortcutFor(input);
    if (!action) return;
    if (action === 'uiDevtools') {
      uiWindowFor(contents)?.webContents.openDevTools({ mode: 'detach' });
    } else if (action === 'privateWindow') {
      createWindow({ privateMode: true });
    } else {
      sendTo(contents, 'shortcut', action, contents.id);
    }
    event.preventDefault();
  });
}

// ---------------------------------------------------------------- page context menu

function truncate(s, n) {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function showPageMenu(contents, p) {
  const t = [];
  const sep = () => { if (t.length && t[t.length - 1].type !== 'separator') t.push({ type: 'separator' }); };
  const sel = (p.selectionText || '').trim();
  const point = { id: contents.id, x: p.x, y: p.y, srcURL: p.srcURL || '', selectionText: sel };

  // The element under the pointer goes to the AI with its position and surroundings.
  t.push({ label: 'Ask AI About This', click: () => sendTo(contents, 'menu-action', 'point', point) });
  sep();

  if (p.misspelledWord) {
    for (const s of (p.dictionarySuggestions || []).slice(0, 5)) t.push({ label: s, click: () => contents.replaceMisspelling(s) });
    t.push({ label: 'Add to Dictionary', click: () => contents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    sep();
  }
  if (p.linkURL) {
    t.push({ label: 'Open Link in New Tab', click: () => sendTo(contents, 'open-url', { url: p.linkURL }) });
    t.push({ label: 'Open Link in Background', click: () => sendTo(contents, 'open-url', { url: p.linkURL, background: true }) });
    t.push({ label: 'Open Link in Floating Window', click: () => openFloating(p.linkURL) });
    t.push({ label: 'Copy Link Address', click: () => clipboard.writeText(p.linkURL) });
    t.push({ label: 'Ask AI About Link', click: () => sendTo(contents, 'menu-action', 'ask-link', { url: p.linkURL, text: p.linkText }) });
    sep();
  }
  if (p.mediaType === 'image' && p.srcURL) {
    t.push({ label: 'Open Image in New Tab', click: () => sendTo(contents, 'open-url', { url: p.srcURL }) });
    t.push({ label: 'Copy Image', click: () => contents.copyImageAt(p.x, p.y) });
    t.push({ label: 'Save Image As…', click: () => contents.downloadURL(p.srcURL) });
    t.push({ label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) });
    t.push({ label: 'Search Image with Google Lens', click: () => sendTo(contents, 'menu-action', 'lens', point) });
    sep();
  }
  if (p.isEditable) {
    const f = p.editFlags || {};
    t.push({ label: 'Undo', enabled: f.canUndo, click: () => contents.undo() });
    t.push({ label: 'Redo', enabled: f.canRedo, click: () => contents.redo() });
    sep();
    t.push({ label: 'Cut', enabled: f.canCut, click: () => contents.cut() });
    t.push({ label: 'Copy', enabled: f.canCopy, click: () => contents.copy() });
    t.push({ label: 'Paste', enabled: f.canPaste, click: () => contents.paste() });
    t.push({ label: 'Paste as Plain Text', enabled: f.canPaste, click: () => contents.pasteAndMatchStyle() });
    t.push({ label: 'Select All', click: () => contents.selectAll() });
    sep();
  } else if (sel) {
    t.push({ label: 'Copy', click: () => contents.copy() });
    sep();
  }
  if (sel) {
    t.push({ label: `Ask AI About “${truncate(sel, 28)}”`, click: () => sendTo(contents, 'menu-action', 'ask-selection', { text: sel }) });
    t.push({ label: 'Explain with AI', click: () => sendTo(contents, 'menu-action', 'explain-selection', { text: sel }) });
    t.push({ label: `Search for “${truncate(sel, 28)}”`, click: () => sendTo(contents, 'menu-action', 'search', { text: sel }) });
    sep();
  }
  if (!p.linkURL && !sel && !p.isEditable && p.mediaType === 'none') {
    t.push({ label: 'Back', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
    t.push({ label: 'Forward', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() });
    t.push({ label: 'Reload', click: () => contents.reload() });
    sep();
    t.push({ label: 'Summarize Page with AI', click: () => sendTo(contents, 'menu-action', 'summarize', { id: contents.id }) });
    t.push({ label: 'Ask AI About This Page', click: () => sendTo(contents, 'menu-action', 'ask-page', { id: contents.id }) });
    sep();
    t.push({ label: 'Copy Page Link', click: () => clipboard.writeText(contents.getURL()) });
    t.push({ label: 'Open in Floating Window', click: () => openFloating(contents.getURL()) });
    t.push({ label: 'View Page Source', click: () => sendTo(contents, 'open-url', { url: 'view-source:' + contents.getURL() }) });
  }
  const extItems = extensions.contextMenuItems(contents, p);
  if (extItems.length) { sep(); t.push(...extItems); }
  sep();
  t.push({ label: 'Inspect', click: () => contents.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(t).popup({ window: uiWindowFor(contents) || BrowserWindow.fromWebContents(contents) });
}

// ---------------------------------------------------------------- floating (always-on-top) windows

function openFloating(url) {
  const w = new BrowserWindow({
    width: 560, height: 380, minWidth: 240, minHeight: 160,
    alwaysOnTop: true, autoHideMenuBar: true, title: 'Pulse',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
  });
  w.setAlwaysOnTop(true, 'floating');
  w.loadURL(url);
  return w;
}

// ---------------------------------------------------------------- guest web contents (webviews & popups)

function setupGuest(contents, { shortcuts = true } = {}) {
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'new-window') {
      // Real popups (OAuth sign-in etc.) need window.opener, so keep them as windows.
      const hidden = !!process.env.LUMEN_HIDDEN;
      const privateMode = contents.session === session.fromPartition(PRIVATE_PARTITION);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520, height: 700, autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          show: !hidden, paintWhenInitiallyHidden: true, skipTaskbar: hidden,
          webPreferences: { partition: privateMode ? PRIVATE_PARTITION : PARTITION, sandbox: true, contextIsolation: true },
        },
      };
    }
    // fromPage: the page (or a modified click in it) chose the disposition, not a menu item of Pulse.
    sendTo(contents, 'open-url', { url, background: disposition === 'background-tab', fromPage: true, sourceId: contents.id });
    return { action: 'deny' };
  });
  contents.on('did-create-window', (w) => registerPopup(w, contents));
  contents.on('context-menu', (_e, params) => showPageMenu(contents, params));
  if (shortcuts) attachShortcuts(contents);
}

// ---------------------------------------------------------------- popup windows (the agent drives them like tabs)

const popups = new Map(); // popup webContents id -> { win, openerId }

function registerPopup(w, opener) {
  const wc = w.webContents;
  const id = wc.id;
  const ui = uiWindowFor(opener);
  let ready = false;
  const report = (type, info = {}) => {
    if (alive(ui)) ui.webContents.send('popup', type, { id, openerId: opener.id, ...info });
  };
  const info = () => (wc.isDestroyed() ? null : {
    url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), ready, zoom: wc.getZoomFactor(),
  });
  const update = () => { const i = info(); if (i) report('update', i); };
  popups.set(id, { win: w, openerId: opener.id });
  extensions.addTab(wc, w);
  report('open', info());
  wc.on('dom-ready', () => { ready = true; update(); });
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) wc.on(ev, update);
  w.once('closed', () => { popups.delete(id); report('close'); });
}

function popupContents(id) {
  const p = popups.get(id);
  return p && alive(p.win) && !p.win.webContents.isDestroyed() ? p.win.webContents : null;
}

// ---------------------------------------------------------------- session setup

function cleanUserAgent(ua) {
  return ua.replace(/\s(Electron|pulse-browser|Pulse|lumen-browser|Lumen)\/\S+/g, '');
}

const privacySettings = () => store.read('settings', null)?.privacy || {};
const cookieMode = () => privacySettings().cookies || 'smart';

// Ad blocking follows Settings → Privacy (off / light / medium / high); re-checked whenever settings are saved.
let adblockLevel = null;
function syncAdblock() {
  const v = privacySettings().adblock;
  const level = v === false ? 'off' : v === true || v == null ? 'light' : String(v);
  if (level === adblockLevel) return;
  adblockLevel = level;
  adblock.setLevel([session.fromPartition(PARTITION), session.fromPartition(PRIVATE_PARTITION)], level);
}
// Electron permission name -> the Privacy setting that sets its default (ask / allow / block).
const PERMISSION_GROUP = {
  geolocation: 'location', media: 'media', notifications: 'notifications', 'clipboard-read': 'clipboard',
  'display-capture': 'screen', midi: 'devices', midiSysex: 'devices', hid: 'devices', serial: 'devices', usb: 'devices',
};

const PERMISSION_LABELS = {
  media: 'use your camera and microphone',
  geolocation: 'know your location',
  notifications: 'show notifications',
  midi: 'use MIDI devices',
  midiSysex: 'use MIDI devices',
  'clipboard-read': 'read your clipboard',
  'display-capture': 'record your screen',
  hid: 'access HID devices',
  serial: 'access serial ports',
  usb: 'access USB devices',
};

function setupSession(partition, { privateMode = false } = {}) {
  const ses = session.fromPartition(partition);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'speaker-selection'].includes(permission)) return callback(true);
    const label = PERMISSION_LABELS[permission];
    if (!label) return callback(false);
    let origin = '';
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch {}
    const saved = privateMode ? {} : store.read('permissions', {}) || {};
    const keyName = `${origin}|${permission}`;
    if (keyName in saved) return callback(saved[keyName]);
    // No decision for this site yet: the default from Settings → Privacy (ask unless set).
    const preset = privacySettings().permissions?.[PERMISSION_GROUP[permission]];
    if (preset === 'allow') return callback(true);
    if (preset === 'block') return callback(false);
    const parent = uiWindowFor(wc);
    dialog.showMessageBox(parent, {
      type: 'question',
      buttons: ['Allow', 'Don’t Allow'],
      defaultId: 0,
      cancelId: 1,
      message: `${origin.replace(/^https?:\/\//, '') || 'This site'} wants to ${label}`,
      checkboxLabel: privateMode ? undefined : 'Remember my decision',
      checkboxChecked: !privateMode,
    }).then(({ response, checkboxChecked }) => {
      const allow = response === 0;
      if (checkboxChecked && !privateMode) store.write('permissions', { ...saved, [keyName]: allow });
      callback(allow);
    }).catch(() => callback(false));
  });

  let seq = 0;
  ses.on('will-download', (_e, item, wc) => {
    const id = ++seq;
    const dir = app.getPath('downloads');
    const parsed = path.parse(item.getFilename() || 'download');
    let target = path.join(dir, parsed.base);
    for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${parsed.name} (${i})${parsed.ext}`);
    item.setSavePath(target);
    let last = 0;
    const report = (force) => {
      const now = Date.now();
      if (!force && now - last < 250) return;
      last = now;
      sendTo(wc, 'download', {
        id, filename: path.basename(target), path: target, url: item.getURL(),
        received: item.getReceivedBytes(), total: item.getTotalBytes(), state: item.getState(),
      });
    };
    downloads.set(id, item);
    item.on('updated', () => report(false));
    item.once('done', () => { report(true); downloads.delete(id); });
    report(true);
  });
}

const downloads = new Map();

// ---------------------------------------------------------------- main window

function createWindow({ privateMode = false } = {}) {
  const saved = privateMode ? {} : store.read('window', null) || {};
  const ref = alive(lastFocused) ? lastFocused : win;
  const near = privateMode && alive(ref) ? ref.getBounds() : null;
  const hidden = !!process.env.LUMEN_HIDDEN; // dev/testing: render without ever showing the window
  const w = new BrowserWindow({
    paintWhenInitiallyHidden: true,
    skipTaskbar: hidden,
    width: near ? Math.max(900, near.width - 120) : saved.width || 1360,
    height: near ? Math.max(600, near.height - 80) : saved.height || 880,
    x: near ? near.x + 60 : saved.x,
    y: near ? near.y + 40 : saved.y,
    minWidth: 760,
    minHeight: 480,
    show: false,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 18, y: 16 } : undefined,
    vibrancy: isMac && !privateMode ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundColor: privateMode ? '#16151d' : isMac ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#1f1f22' : '#e9e9ee',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    title: privateMode ? 'Pulse (Private)' : 'Pulse',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
    },
  });
  if (saved.maximized) w.maximize();
  if (!privateMode) win = w;

  w.loadURL(`lumen://app/index.html${privateMode ? '?private=1' : ''}`);
  if (!hidden) w.once('ready-to-show', () => w.show());

  const wc = w.webContents;
  uiWindows.set(wc.id, { win: w, privateMode });
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) sendTo(wc, 'open-url', { url });
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    params.partition = privateMode ? PRIVATE_PARTITION : PARTITION;
  });
  // Tabs become visible to Chrome extensions (chrome.tabs); private windows have none.
  if (!privateMode) wc.on('did-attach-webview', (_e, guest) => extensions.addTab(guest, w));
  attachShortcuts(wc);

  const state = (st) => { if (!wc.isDestroyed()) wc.send('window-state', st); };
  const saveBounds = () => {
    if (privateMode || w.isDestroyed()) return;
    const maximized = w.isMaximized();
    const b = maximized ? (store.read('window', null) || w.getNormalBounds()) : w.getBounds();
    store.write('window', { ...b, maximized });
  };
  w.on('resize', saveBounds);
  w.on('move', saveBounds);
  w.on('maximize', () => { saveBounds(); state({ maximized: true }); });
  w.on('unmaximize', () => { saveBounds(); state({ maximized: false }); });
  w.on('enter-full-screen', () => state({ fullscreen: true }));
  w.on('leave-full-screen', () => state({ fullscreen: false }));
  w.on('focus', () => { lastFocused = w; state({ focused: true }); });
  w.on('blur', () => state({ focused: false }));
  const wcId = wc.id;
  w.on('closed', () => {
    uiWindows.delete(wcId);
    if (lastFocused === w) lastFocused = null;
    if (win === w) win = null;
    // Last private window gone: forget everything it saw.
    if (privateMode && ![...uiWindows.values()].some((x) => x.privateMode)) {
      const ses = session.fromPartition(PRIVATE_PARTITION);
      ses.clearStorageData().catch(() => {});
      ses.clearCache().catch(() => {});
      ses.clearAuthCache().catch(() => {});
    }
  });

  if (process.env.LUMEN_DEBUG_PORT) wc.openDevTools({ mode: 'detach' });
  return w;
}

function buildMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}

// ---------------------------------------------------------------- IPC

const STORE_NAMES = new Set(['settings', 'session', 'history', 'chats', 'usage', 'boards', 'names']);

function registerIpc() {
  ipcMain.handle('store:read', (_e, name) => (STORE_NAMES.has(name) ? store.read(name, null) : null));
  ipcMain.on('store:write', (_e, name, data) => {
    if (!STORE_NAMES.has(name)) return;
    store.write(name, data);
    if (name === 'settings') {
      syncAdblock();
      remote.sync(data?.remote);
    }
  });

  const own = (e) => BrowserWindow.fromWebContents(e.sender);
  ipcMain.on('win:minimize', (e) => own(e)?.minimize());
  ipcMain.on('win:maximize', (e) => { const w = own(e); if (!w) return; w.isMaximized() ? w.unmaximize() : w.maximize(); });
  ipcMain.on('win:close', (e) => own(e)?.close());
  ipcMain.on('win:on-top', (e, on) => own(e)?.setAlwaysOnTop(!!on, 'floating'));
  ipcMain.on('win:new-private', () => createWindow({ privateMode: true }));
  ipcMain.handle('win:state', (e) => { const w = own(e); return { maximized: !!w?.isMaximized(), fullscreen: !!w?.isFullScreen(), platform: process.platform }; });

  ipcMain.on('theme:set', (_e, mode) => { nativeTheme.themeSource = ['light', 'dark'].includes(mode) ? mode : 'system'; });

  ipcMain.handle('secrets:status', () => Object.fromEntries(Object.keys(readSecrets()).map((k) => [k, true])));
  ipcMain.handle('secrets:set', (_e, provider, key) => { setKey(String(provider), key ? String(key).trim() : null); return true; });

  ipcMain.on('ai:send', (e, id, payload) => {
    const sender = e.sender;
    ai.run(id, payload, getKey(payload.provider), (ev) => { if (!sender.isDestroyed()) sender.send('ai:event', id, ev); });
  });
  ipcMain.on('ai:abort', (_e, id) => ai.abort(id));
  ipcMain.handle('ai:models', async (_e, provider, baseUrl) => {
    try { return { ok: true, models: await ai.listModels(provider, getKey(provider), baseUrl) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('ai:detect', () => ai.detect());
  ipcMain.handle('ai:claude-spend', (_e, since, until) => {
    const from = Number(since);
    const to = until == null ? Date.now() : Number(until);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return {};
    return claudeSpend.spend(from, to).catch(() => ({}));
  });
  ipcMain.handle('ai:login', (_e, provider) => ai.openLogin(provider));

  ipcMain.on('agent:start', (e, id, payload) => agent.start(e.sender, id, payload, getKey('anthropic')));
  ipcMain.on('agent:stop', (_e, id) => agent.stop(id));
  ipcMain.on('agent:tool-result', (_e, callId, result) => agent.toolResult(callId, result));
  ipcMain.on('agent:forget', (_e, key) => agent.forget(key));
  ipcMain.handle('agent:connectors', () => agent.listConnectors());
  ipcMain.handle('sites:context', (_e, host) => sites.readContext(host));
  ipcMain.handle('sites:note', (_e, host, note) => sites.appendNote(host, note));
  ipcMain.handle('sites:general', () => sites.readGeneral());
  ipcMain.handle('sites:general-note', (_e, note) => sites.appendGeneral(note));
  ipcMain.handle('sites:session', (_e, host, id, md) => sites.saveSession(host, id, md));
  ipcMain.handle('sites:info', (_e, host) => sites.info(host));
  ipcMain.handle('sites:open', (_e, host) => sites.open(host));

  ipcMain.handle('page:capture', async (e, id, rect) => {
    const wc = id === 0 ? e.sender : webContents.fromId(id); // 0 = the asking window itself (e.g. the whiteboard)
    if (!wc || wc.isDestroyed()) return null;
    const crop = rect && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(rect[k]) && rect[k] >= 0)
      ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) }
      : undefined;
    const img = await wc.capturePage(crop);
    if (img.isEmpty()) return null;
    const { width } = img.getSize();
    return (width > 1400 ? img.resize({ width: 1400, quality: 'good' }) : img).toJPEG(75).toString('base64');
  });

  ipcMain.handle('popup:exec', (_e, id, code) => {
    const wc = popupContents(id);
    if (!wc) throw new Error('The pop-up window was closed.');
    return wc.executeJavaScript(String(code));
  });
  ipcMain.on('popup:input', (_e, id, ev) => popupContents(id)?.sendInputEvent(ev));
  ipcMain.handle('popup:insert-text', (_e, id, text) => popupContents(id)?.insertText(String(text)));
  ipcMain.on('popup:focus', (_e, id) => popupContents(id)?.focus());
  ipcMain.on('popup:close', (_e, id) => { const p = popups.get(id); if (alive(p?.win)) p.win.close(); });

  // Image bytes for Google Lens, fetched with the user's browsing session (cookies, referrer-free).
  ipcMain.handle('image:fetch', async (_e, url) => {
    if (!/^https?:\/\//i.test(String(url))) return null;
    try {
      const res = await session.fromPartition(PARTITION).fetch(String(url), { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT) });
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!res.ok || !/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(mime)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length && buf.length <= MAX_IMAGE_BYTES ? { mime, data: buf.toString('base64') } : null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('search:suggest', async (_e, q, engine) => {
    if (!q || q.length > 200) return [];
    try {
      if (engine === 'duckduckgo') {
        const r = await net.fetch(`https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(2500) });
        const j = await r.json();
        return (Array.isArray(j[1]) ? j[1] : []).slice(0, 5);
      }
      const r = await net.fetch(`https://suggestqueries.google.com/complete/search?client=chrome&ie=utf-8&oe=utf-8&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(2500) });
      const j = await r.json();
      return (j[1] || []).slice(0, 5);
    } catch {
      return [];
    }
  });

  ipcMain.on('tab:float', (_e, url) => { if (/^https?:/i.test(url)) openFloating(url); });

  ipcMain.on('download:cancel', (_e, id) => downloads.get(id)?.cancel());
  ipcMain.on('download:open', (_e, p) => shell.openPath(p));
  ipcMain.on('download:show', (_e, p) => shell.showItemInFolder(p));

  ipcMain.handle('permissions:list', () => Object.entries(store.read('permissions', {}) || {}).map(([key, allowed]) => {
    const i = key.lastIndexOf('|');
    return { key, origin: key.slice(0, i), permission: key.slice(i + 1), allowed: !!allowed };
  }));
  ipcMain.handle('permissions:remove', (_e, key) => {
    const saved = { ...(store.read('permissions', {}) || {}) };
    delete saved[String(key)];
    store.write('permissions', saved);
    return true;
  });

  ipcMain.handle('data:clear', async (_e, what) => {
    const ses = session.fromPartition(PARTITION);
    if (what === 'cache') await ses.clearCache();
    if (what === 'site-data') await ses.clearStorageData();
    if (what === 'permissions') store.write('permissions', {});
    return true;
  });

  ipcMain.handle('dialog:folder', async (e, start) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Choose a working folder', properties: ['openDirectory', 'createDirectory'], defaultPath: start || app.getPath('home'),
    });
    return res.canceled ? null : res.filePaths[0];
  });
  // Settings → AI → Save chats to Obsidian: the UI sends finished chats and they are written as Markdown notes.
  ipcMain.handle('notes:save', (_e, folder, chats) => {
    try {
      return { ok: true, saved: chatNotes.saveNotes(folder, chats, { user: chatNotes.userName() }) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('notes:default-folder', () => chatNotes.defaultFolder());
  ipcMain.handle('app:home', () => app.getPath('home'));
  // Saves text the UI made (a whiteboard as a .drawio file) where the user picks in a Save dialog.
  ipcMain.handle('file:save', async (e, name, text) => {
    if (typeof text !== 'string' || text.length > MAX_SAVE_CHARS) return { ok: false, error: 'Nothing to save.' };
    const fileName = path.basename(String(name || 'Untitled')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Untitled';
    const ext = path.extname(fileName).slice(1) || 'txt';
    const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender) || undefined, {
      defaultPath: path.join(app.getPath('documents'), fileName),
      filters: [{ name: ext === 'drawio' ? 'draw.io diagram' : ext.toUpperCase(), extensions: [ext] }],
    });
    if (res.canceled || !res.filePath) return { ok: false };
    try {
      await fs.promises.writeFile(res.filePath, text, 'utf8');
      return { ok: true, path: res.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('app:launch-url', () => {
    const url = launchUrl;
    launchUrl = null;
    return url;
  });
  ipcMain.on('open-external', (_e, url) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData'), electron: process.versions.electron, chrome: process.versions.chrome }));
}

// ---------------------------------------------------------------- lifecycle

app.on('web-contents-created', (_e, contents) => {
  const type = contents.getType();
  if (type === 'webview') {
    setupGuest(contents);
    cookies.attach(contents, cookieMode);
  }
  else if (type === 'window') {
    // Popups and floating windows: route their new-tab requests into the main window.
    contents.once('did-finish-load', () => {
      if (!uiWindows.has(contents.id)) setupGuest(contents, { shortcuts: false });
    });
  }
});

// A link Pulse was started with (default browser, `pulse-browser https://…`).
const urlFromArgv = (argv) => argv.find((a) => /^https?:\/\//i.test(a)) || null;
let launchUrl = urlFromArgv(process.argv);

app.on('second-instance', (_e, argv) => {
  const url = urlFromArgv(argv);
  if (!alive(win)) {
    if (url) launchUrl = url; // still starting up: the window picks it up once it's ready
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
  if (url) win.webContents.send('open-url', { url }); // never into a private window
});

// chrome.windows.create from an extension (e.g. a password manager's pop-out).
function openExtensionWindow(details = {}) {
  const w = new BrowserWindow({
    width: details.width || 420, height: details.height || 640, x: details.left, y: details.top,
    autoHideMenuBar: true, title: 'Pulse',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
  });
  const url = [].concat(details.url || [])[0];
  w.loadURL(url || 'about:blank');
  return w;
}

const EXTENSIONS_LOAD_WAIT = 2500; // ms; installed extensions load before the first tabs when possible

async function initExtensions() {
  try {
    const ready = extensions.init({
      session: session.fromPartition(PARTITION),
      uiSession: session.defaultSession,
      browserWindow: () => [lastFocused, win].find((w) => alive(w) && !uiWindows.get(w.webContents.id)?.privateMode) || null,
      uiWindowFor,
      isUiWindow: (w) => alive(w) && uiWindows.has(w.webContents.id),
      openWindow: openExtensionWindow,
    });
    await Promise.race([ready, new Promise((r) => setTimeout(r, EXTENSIONS_LOAD_WAIT))]);
  } catch (err) {
    console.error('Chrome extensions failed to start:', err);
  }
}

app.whenReady().then(async () => {
  if (migration === 'blocked') {
    dialog.showMessageBoxSync({
      type: 'info',
      message: 'Close Lumen first',
      detail: 'Lumen is now called Pulse. Quit the open Lumen window, then start Pulse again. Your tabs, logins, history and AI chats move over automatically.',
    });
    app.exit(0);
    return;
  }
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
  const settings = store.read('settings', null);
  if (settings?.theme) nativeTheme.themeSource = settings.theme;
  registerAppProtocol();
  setupSession(PARTITION);
  setupSession(PRIVATE_PARTITION, { privateMode: true });
  syncAdblock();
  registerIpc();
  remote.init({
    mainWindow: () => (alive(win) ? win : null),
    notify: (channel, ...args) => { for (const { win: w, privateMode } of uiWindows.values()) if (!privateMode && alive(w)) w.webContents.send(channel, ...args); },
  });
  buildMenu();
  await initExtensions();
  createWindow();
  remote.sync(settings?.remote);
  if (settings?.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');

  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('before-quit', () => {
  remote.shutdown();
  store.flush();
});
app.on('window-all-closed', () => {
  store.flush();
  if (!isMac) app.quit();
});
