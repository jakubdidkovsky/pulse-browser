// Built-in ad blocking (Ghostery's engine with its prebuilt EasyList-based lists) for the browsing sessions.
// Settings → Privacy picks the level; each compiled engine is cached on disk and refreshed once a day.
//   light  — EasyList ad servers only (no analytics or tag managers), nothing on the page is hidden
//   medium — also trackers (EasyPrivacy), and empty ad boxes are hidden
//   high   — also annoyances: pop-ups, newsletter overlays, social widgets
const fs = require('node:fs');
const path = require('node:path');
const { app, net, ipcMain } = require('electron');
const { ElectronBlocker, adsLists } = require('@ghostery/adblocker-electron');

// Ghostery's own "ads" bundle also blocks Google Tag Manager, Analytics and Hotjar, which some sites need
// to work, so Light is plain EasyList plus uBlock's "unbreak" exceptions.
const LIGHT_LISTS = adsLists.filter((url) => /\/easylist\/easylist\.txt$|\/unbreak\.txt$/.test(url));

const LEVELS = {
  light: { lists: LIGHT_LISTS, cosmetic: false },
  medium: { prebuilt: 'fromPrebuiltAdsAndTracking', cosmetic: true },
  high: { prebuilt: 'fromPrebuiltFull', cosmetic: true },
};
const REFRESH_MS = 24 * 3600e3;
// Registered once per enabled session by the library — removed first so a second session can register them.
const COSMETIC_CHANNELS = ['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled'];

const engines = new Map(); // level -> Promise<ElectronBlocker>
let active = null; // { level, blocker } currently attached to the sessions

const cacheFile = (level) => path.join(app.getPath('userData'), `adblock-${level}.bin`);

function readCache(level, maxAge) {
  try {
    const file = cacheFile(level);
    if (Date.now() - fs.statSync(file).mtimeMs > maxAge) return null;
    return ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(file)));
  } catch {
    return null;
  }
}

async function build(level) {
  const { prebuilt, lists, cosmetic } = LEVELS[level];
  const fetchImpl = (url, init) => net.fetch(url, init);
  let engine = readCache(level, REFRESH_MS);
  if (!engine) {
    try {
      engine = lists
        ? await ElectronBlocker.fromLists(fetchImpl, lists, { loadCosmeticFilters: cosmetic, enableCompression: true })
        : await ElectronBlocker[prebuilt](fetchImpl);
      fs.writeFile(cacheFile(level), engine.serialize(), () => {});
    } catch (err) {
      engine = readCache(level, Infinity); // offline: an older list still blocks most ads
      if (!engine) throw err;
    }
  }
  engine.config.loadCosmeticFilters = cosmetic;
  return engine;
}

const engineFor = (level) => {
  if (!engines.has(level)) engines.set(level, build(level).catch((err) => { engines.delete(level); throw err; }));
  return engines.get(level);
};

async function apply(sessions, level) {
  try {
    const want = LEVELS[level] ? level : 'off';
    if (active?.level === want) return;
    const blocker = want === 'off' ? null : await engineFor(want);
    if (active) for (const s of sessions) if (active.blocker.isBlockingEnabled(s)) active.blocker.disableBlockingInSession(s);
    active = blocker ? { level: want, blocker } : null;
    if (!blocker) return;
    for (const s of sessions) {
      COSMETIC_CHANNELS.forEach((c) => ipcMain.removeHandler(c));
      blocker.enableBlockingInSession(s);
    }
  } catch (err) {
    console.error('[adblock]', err.message);
  }
}

// level: 'off' | 'light' | 'medium' | 'high'. Changes run one after another, so the last choice wins.
let queue = Promise.resolve();
function setLevel(sessions, level) {
  fs.rm(path.join(app.getPath('userData'), 'adblock-engine.bin'), { force: true }, () => {}); // cache of the first version
  queue = queue.then(() => apply(sessions, level));
  return queue;
}

module.exports = { setLevel };
