// Phone remote, the window's side: keeps the phone's picture of tabs and chat current and runs its commands.
// The server is lib/remote.js. Nothing is sent while no phone is connected, and private windows never take part.
import { S, onChange, PRIVATE } from './state.js';
import { h, $, toUrl, isStart, hostOf } from './util.js';
import { icon } from './icons.js';
import { toast } from './ui.js';
import * as Tabs from './tabs.js';
import * as AI from './ai.js';

const PUSH_EVERY = 150; // ms; at most this often while an answer streams
const MAX_FAVICON = 4096; // chars; bigger inline icons are left to the phone's letter avatar

let clients = 0;
let sent = { tabs: '', chat: '' };
let timer = 0;
let openSettingsFn = () => {};

function tabsView() {
  const tab = Tabs.activeTab();
  const ready = !!(tab?.wv && tab.ready);
  return {
    activeId: S.activeId,
    canBack: ready && tab.wv.canGoBack(),
    canForward: ready && tab.wv.canGoForward(),
    tabs: Tabs.orderedTabs().map((t) => ({
      id: t.id,
      title: t.title || '',
      url: isStart(t.url) ? '' : t.url,
      host: hostOf(t.url) || '',
      favicon: t.favicon && t.favicon.length <= MAX_FAVICON ? t.favicon : '',
      pinned: !!t.pinned,
      loading: !!t.loading,
      wc: t.ready ? t.wcId : null,
    })),
  };
}

const VIEWS = { tabs: tabsView, chat: () => AI.remoteView() };

function push() {
  timer = 0;
  if (!clients) return;
  for (const [part, view] of Object.entries(VIEWS)) {
    const json = JSON.stringify(view());
    if (json === sent[part]) continue;
    sent[part] = json;
    window.lumen.remote.state(part, json);
  }
}

// Throttled rather than debounced, so a streaming answer still reaches the phone while it streams.
function schedule() {
  if (clients && !timer) timer = setTimeout(push, PUSH_EVERY);
}

// The phone may only open web pages, never local files or browser internals.
function webUrl(text) {
  const url = toUrl(String(text || ''), S.settings.engine);
  if (!url) throw new Error('Type an address or a search.');
  if (!/^https?:\/\//i.test(url)) throw new Error('Only web addresses can be opened from the phone.');
  return url;
}

function existingTab(id) {
  const tab = Tabs.getTab(id);
  if (!tab) throw new Error('That tab was closed.');
  return tab;
}

const COMMANDS = {
  'tab.activate': ({ id }) => { Tabs.activate(existingTab(id).id); },
  'tab.close': ({ id }) => { Tabs.closeTab(existingTab(id).id); },
  'tab.open': ({ text }) => { if (text?.trim()) Tabs.open(webUrl(text), { afterId: S.activeId }); else Tabs.createTab({ afterId: S.activeId }); },
  'tab.navigate': ({ text }) => { Tabs.navigate(Tabs.activeTab(), webUrl(text)); },
  'tab.back': () => Tabs.goBack(),
  'tab.forward': () => Tabs.goForward(),
  'tab.reload': () => Tabs.reload(),
  'chat.send': ({ text, mode }) => AI.remoteSend(text, mode),
  'chat.answer': ({ id, text }) => AI.remoteAnswer(id, text),
  'chat.settle': ({ id, value }) => AI.remoteSettle(id, value),
  'chat.stop': () => AI.remoteStop(),
  'chat.new': () => AI.remoteNewChat(),
};

async function run(id, cmd) {
  try {
    const fn = COMMANDS[cmd?.type];
    if (!fn) throw new Error('Unknown command.');
    await fn(cmd);
    window.lumen.remote.reply(id, { ok: true, data: null });
  } catch (err) {
    window.lumen.remote.reply(id, { ok: false, error: err?.message || 'That didn’t work.' });
  }
  schedule();
}

// A phone icon in the toolbar while a phone is connected, so remote control is never invisible.
function indicator(names) {
  let el = $('#remote-indicator');
  if (!clients) { el?.remove(); return; }
  if (!el) {
    el = h('button', { class: 'icon-btn remote-indicator', id: 'remote-indicator', html: icon('phone', 16), onclick: () => openSettingsFn('remote') });
    $('#toolbar .tb-right')?.prepend(el);
  }
  const who = names.length ? names.join(', ') : 'A phone';
  el.title = `${who} ${names.length > 1 ? 'are' : 'is'} connected to Pulse`;
}

function onClients(count, names = []) {
  const first = !clients && count > 0;
  clients = count;
  indicator(names);
  if (first) {
    sent = { tabs: '', chat: '' };
    schedule();
  }
}

export function initRemote({ openSettings }) {
  if (PRIVATE) return;
  openSettingsFn = openSettings;
  window.lumen.remote.onClients(onClients);
  window.lumen.remote.clients().then(([count, names]) => onClients(count, names)).catch(() => {});
  window.lumen.remote.onCommand(run);
  window.lumen.remote.onDevice(({ name, event }) => {
    if (event === 'paired') toast(`${name} can now control Pulse`, { iconName: 'phone', timeout: 4000 });
  });
  onChange(schedule);
  Tabs.on('onLoadState', schedule);
  AI.onRemoteChange(schedule);
}
