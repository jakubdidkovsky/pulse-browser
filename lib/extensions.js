'use strict';
// Chrome extensions for the browsing session: installs from the Chrome Web Store
// (electron-chrome-web-store) and the chrome.* APIs Electron lacks — tabs, toolbar
// actions with their popups, context menus (electron-chrome-extensions).
const { dialog, ipcMain, webContents, BrowserWindow } = require('electron');

let lib = null;
try {
  lib = { ...require('electron-chrome-extensions'), ...require('electron-chrome-web-store') };
} catch (err) {
  console.warn('Chrome extensions unavailable:', err.message);
}

const CREATE_TAB_TIMEOUT = 10000;

let ext = null; // ElectronChromeExtensions for the browsing session
let ses = null;
let host = null; // { browserWindow(), uiWindowFor(contents), isUiWindow(win), openWindow(details) }
const pendingTabs = new Map(); // request id -> resolve(webContentsId)
let seq = 0;

const ownsContents = (wc) => !!ext && !!wc && !wc.isDestroyed() && wc.session === ses;

function sendUi(win, channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function broadcastChanged() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (host.isUiWindow(w)) sendUi(w, 'ext:changed');
  }
}

// chrome.tabs.create → open a real Pulse tab and hand its webContents back to the extension.
async function createTab(details) {
  const win = host.browserWindow();
  if (!win) throw new Error('No browser window is open.');
  const id = ++seq;
  const wcId = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingTabs.delete(id); reject(new Error('Opening the tab timed out.')); }, CREATE_TAB_TIMEOUT);
    pendingTabs.set(id, (value) => { clearTimeout(timer); resolve(value); });
    sendUi(win, 'ext:create-tab', { id, url: details.url || null, active: details.active !== false });
  });
  const wc = wcId != null && webContents.fromId(wcId);
  if (!wc) throw new Error('The tab could not be opened.');
  return [wc, win];
}

function selectTab(wc, win) {
  if (host.isUiWindow(win)) sendUi(win, 'ext:select-tab', wc.id);
  else if (win && !win.isDestroyed()) win.focus();
}

// The store also calls this when a tab's webContents is destroyed because Pulse closed or slept it;
// only a live tab means an extension asked for it to be closed.
function removeTab(wc, win) {
  if (!wc || wc.isDestroyed()) return;
  if (host.isUiWindow(win)) sendUi(win, 'ext:remove-tab', wc.id);
  else if (win && !win.isDestroyed()) win.close();
}

function createWindow(details) {
  const win = host.openWindow(details);
  ext.addTab(win.webContents, win);
  return win;
}

function describePermissions(manifest) {
  const perms = new Set([...(manifest.permissions || []), ...(manifest.host_permissions || [])]);
  const scripts = (manifest.content_scripts || []).flatMap((c) => c.matches || []);
  const all = [...perms, ...scripts].some((p) => /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*)$/.test(p));
  const lines = [];
  if (all) lines.push('Read and change all your data on all websites');
  else if (scripts.length || [...perms].some((p) => p.includes('://'))) lines.push('Read and change your data on some websites');
  if (perms.has('tabs') || perms.has('history')) lines.push('Read your browsing history');
  if (perms.has('cookies')) lines.push('Read and change cookies');
  if (perms.has('downloads')) lines.push('Manage your downloads');
  if (perms.has('clipboardRead')) lines.push('Read data you copy and paste');
  if (perms.has('nativeMessaging')) lines.push('Talk to apps on your computer (may not work in Pulse)');
  return lines.length ? `It can:\n• ${lines.join('\n• ')}` : 'It doesn’t ask for any special permissions.';
}

// The store's "Add to Chrome" asks here first, so neither a page nor the agent can install silently.
async function beforeInstall({ localizedName, manifest, icon, frame }) {
  const wc = frame && !frame.isDestroyed() ? webContents.fromFrame(frame) : null;
  const parent = host.uiWindowFor(wc);
  const options = {
    type: 'question',
    buttons: ['Add Extension', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: `Add “${localizedName}” to Pulse?`,
    detail: describePermissions(manifest || {}),
    icon: icon && !icon.isEmpty() ? icon.resize({ width: 64, height: 64 }) : undefined,
  };
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return { action: response === 0 ? 'allow' : 'deny' };
}

function extensionInfo(e) {
  const m = e.manifest || {};
  const options = m.options_ui?.page || m.options_page;
  return {
    id: e.id,
    name: e.name,
    version: e.version,
    description: m.description && !m.description.startsWith('__MSG_') ? m.description : '',
    options: options ? `chrome-extension://${e.id}/${options.replace(/^\//, '')}` : null,
  };
}

function registerIpc() {
  ipcMain.on('ext:tab-created', (_e, id, wcId) => {
    const resolve = pendingTabs.get(id);
    pendingTabs.delete(id);
    resolve?.(wcId);
  });
  ipcMain.on('ext:tab-selected', (_e, wcId) => {
    const wc = webContents.fromId(wcId);
    if (!ownsContents(wc)) return;
    try { ext.selectTab(wc); } catch (err) { console.warn('ext.selectTab failed:', err.message); }
  });
  ipcMain.handle('ext:list', () => (ses ? ses.extensions.getAllExtensions().map(extensionInfo) : []));
  ipcMain.handle('ext:remove', async (_e, id) => {
    if (!ses?.extensions.getExtension(id)) return false;
    await lib.uninstallExtension(String(id), { session: ses });
    broadcastChanged();
    return true;
  });
}

async function init(opts) {
  host = opts;
  registerIpc();
  if (!lib) return false;
  ses = opts.session;
  ext = new lib.ElectronChromeExtensions({
    session: ses,
    createTab,
    selectTab,
    removeTab,
    createWindow,
    removeWindow: (win) => { if (!win.isDestroyed()) win.close(); },
  });
  lib.ElectronChromeExtensions.handleCRXProtocol(opts.uiSession);
  ses.extensions.on('extension-loaded', broadcastChanged);
  ses.extensions.on('extension-unloaded', broadcastChanged);
  await lib.installChromeWebStore({ session: ses, beforeInstall });
  return true;
}

function addTab(wc, win) {
  if (!ownsContents(wc) || !win) return;
  try { ext.addTab(wc, win); } catch (err) { console.warn('ext.addTab failed:', err.message); }
}

function contextMenuItems(wc, params) {
  if (!ownsContents(wc)) return [];
  try { return ext.getContextMenuItems(wc, params); } catch { return []; }
}

module.exports = { init, addTab, contextMenuItems, available: () => !!ext };
