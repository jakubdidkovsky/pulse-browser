'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, ...args) => fn(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('lumen', {
  platform: process.platform,
  store: {
    read: (name) => ipcRenderer.invoke('store:read', name),
    write: (name, data) => ipcRenderer.send('store:write', name, data),
  },
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    setOnTop: (on) => ipcRenderer.send('win:on-top', on),
    newPrivate: () => ipcRenderer.send('win:new-private'),
    state: () => ipcRenderer.invoke('win:state'),
    onState: on('window-state'),
  },
  setTheme: (mode) => ipcRenderer.send('theme:set', mode),
  secrets: {
    status: () => ipcRenderer.invoke('secrets:status'),
    set: (provider, key) => ipcRenderer.invoke('secrets:set', provider, key),
  },
  ai: {
    send: (id, payload) => ipcRenderer.send('ai:send', id, payload),
    abort: (id) => ipcRenderer.send('ai:abort', id),
    models: (provider, baseUrl) => ipcRenderer.invoke('ai:models', provider, baseUrl),
    detect: () => ipcRenderer.invoke('ai:detect'),
    login: (provider) => ipcRenderer.invoke('ai:login', provider),
    onEvent: on('ai:event'),
  },
  agent: {
    start: (id, payload) => ipcRenderer.send('agent:start', id, payload),
    stop: (id) => ipcRenderer.send('agent:stop', id),
    result: (callId, result) => ipcRenderer.send('agent:tool-result', callId, result),
    forget: (key) => ipcRenderer.send('agent:forget', key),
    connectors: () => ipcRenderer.invoke('agent:connectors'),
    onTool: on('agent:tool'),
    onEvent: on('agent:event'),
  },
  sites: {
    context: (host) => ipcRenderer.invoke('sites:context', host),
    note: (host, note) => ipcRenderer.invoke('sites:note', host, note),
    general: () => ipcRenderer.invoke('sites:general'),
    generalNote: (note) => ipcRenderer.invoke('sites:general-note', note),
    saveSession: (host, id, md) => ipcRenderer.invoke('sites:session', host, id, md),
    info: (host) => ipcRenderer.invoke('sites:info', host),
    open: (host) => ipcRenderer.invoke('sites:open', host),
  },
  popup: {
    exec: (id, code) => ipcRenderer.invoke('popup:exec', id, code),
    input: (id, ev) => ipcRenderer.send('popup:input', id, ev),
    insertText: (id, text) => ipcRenderer.invoke('popup:insert-text', id, text),
    focus: (id) => ipcRenderer.send('popup:focus', id),
    close: (id) => ipcRenderer.send('popup:close', id),
    onEvent: on('popup'),
  },
  // Chrome extensions: toolbar actions talk to electron-chrome-extensions' remote channel.
  ext: {
    list: () => ipcRenderer.invoke('ext:list'),
    remove: (id) => ipcRenderer.invoke('ext:remove', id),
    state: (partition) => ipcRenderer.invoke('crx-msg-remote', partition, 'browserAction.getState'),
    activate: (partition, details) => ipcRenderer.invoke('crx-msg-remote', partition, 'browserAction.activate', details),
    observe: (partition) => ipcRenderer.invoke('crx-msg-remote', partition, 'browserAction.addObserver'),
    tabCreated: (id, wcId) => ipcRenderer.send('ext:tab-created', id, wcId),
    tabSelected: (wcId) => ipcRenderer.send('ext:tab-selected', wcId),
    onActionsChanged: on('browserAction.update'),
    onChanged: on('ext:changed'),
    onCreateTab: on('ext:create-tab'),
    onSelectTab: on('ext:select-tab'),
    onRemoveTab: on('ext:remove-tab'),
  },
  capture: (webContentsId, rect) => ipcRenderer.invoke('page:capture', webContentsId, rect),
  fetchImage: (url) => ipcRenderer.invoke('image:fetch', url),
  suggest: (q, engine) => ipcRenderer.invoke('search:suggest', q, engine),
  float: (url) => ipcRenderer.send('tab:float', url),
  downloads: {
    cancel: (id) => ipcRenderer.send('download:cancel', id),
    open: (p) => ipcRenderer.send('download:open', p),
    show: (p) => ipcRenderer.send('download:show', p),
    onUpdate: on('download'),
  },
  clearData: (what) => ipcRenderer.invoke('data:clear', what),
  permissions: {
    list: () => ipcRenderer.invoke('permissions:list'),
    remove: (key) => ipcRenderer.invoke('permissions:remove', key),
  },
  openExternal: (url) => ipcRenderer.send('open-external', url),
  info: () => ipcRenderer.invoke('app:info'),
  pickFolder: (start) => ipcRenderer.invoke('dialog:folder', start),
  homeDir: () => ipcRenderer.invoke('app:home'),
  onShortcut: on('shortcut'),
  onOpenUrl: on('open-url'),
  onMenuAction: on('menu-action'),
});
