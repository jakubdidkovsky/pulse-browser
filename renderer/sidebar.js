// Sidebar: pinned favourites, groups (with auto-routing rules), loose tabs.
import { S, changed, GROUP_COLORS } from './state.js';
import { h, $, favicon, hostOf, uid, isStart } from './util.js';
import { icon } from './icons.js';
import { showMenu, openModal, confirmDialog, toast } from './ui.js';
import * as Tabs from './tabs.js';
import { openPalette } from './palette.js';
import { openInSplit, removeTabFromSplit, startTabDrag, endTabDrag } from './split.js';

let dragId = null;

export const isDraggingTab = () => !!dragId;
export const tabsOnTop = () => S.settings.tabLayout === 'top';

export function renderSidebar() {
  if (dragId) return; // don't rebuild under an active drag
  const top = tabsOnTop(); // tabs live in the strip above the toolbar (renderer/tabstrip.js); pins in the bar
  const inBar = top || S.settings.pinsLocation !== 'sidebar';
  document.body.classList.toggle('pins-in-bar', inBar);
  // The bar only takes space once something is pinned; while a tab is dragged it shows up as a drop target.
  const wanted = inBar && S.settings.favbar !== false;
  const hasPins = S.tabs.some((t) => t.pinned);
  document.body.classList.toggle('favbar-on', wanted && hasPins);
  document.body.classList.toggle('favbar-empty', wanted && !hasPins);
  if (inBar) {
    $('#pinned').replaceChildren();
    renderFavbar();
  } else {
    renderPinned();
  }
  if (top) return;
  renderGroups();
  renderLoose();
}

// ---------------------------------------------------------------- favorites bar (pinned pages under the toolbar)

export function pinLabel(t) {
  if (t.pinTitle) return t.pinTitle;
  const title = (t.title || '').trim();
  if (title && title.length <= 18) return title;
  const parts = title.split(/\s+[|\-–—·•:]\s+/).map((s) => s.trim()).filter((s) => s.length >= 2);
  if (parts.length > 1) return parts.sort((a, b) => a.length - b.length)[0];
  const host = hostOf(t.pinnedUrl || t.url).replace(/^(www|app|web|mail|m)\./, '');
  const name = host.split('.')[0] || title || 'Page';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

let favbarParts = null;

function renderFavbar() {
  const bar = $('#favbar');
  const pinned = S.tabs.filter((t) => t.pinned);
  const strip = h('div', { class: 'fav-strip' });
  for (const t of pinned) {
    const chip = h('div', {
      class: `fav-chip${t.id === S.activeId ? ' active' : ''}${t.wv ? ' loaded' : ''}`,
      title: `${t.title}\n${t.pinnedUrl || t.url}\nCtrl+click opens a fresh copy`,
      draggable: 'true',
      dataset: { id: t.id },
    }, favicon(t, 15), h('span', { class: 'fav-label' }, pinLabel(t)));
    if (t.audible) chip.append(h('span', { class: 'fav-audio', html: icon(t.muted ? 'mute' : 'volume', 11) }));
    chip.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) Tabs.open(t.pinnedUrl || t.url, { background: true });
      else Tabs.activate(t.id);
    });
    chip.addEventListener('auxclick', (e) => { if (e.button === 1) Tabs.open(t.pinnedUrl || t.url, { background: true }); });
    chip.addEventListener('contextmenu', (e) => { e.preventDefault(); tabMenu(t, e.clientX, e.clientY); });
    bindDrag(chip, t);
    bindDrop(chip, { beforeTab: t });
    strip.append(chip);
  }
  if (!pinned.length) {
    strip.append(h('span', { class: 'fav-hint' }, h('span', { html: icon('pin', 12) }), 'Pin pages here for one-click access. Drag a tab here or press ', h('kbd', {}, modKey('D'))));
  }
  const tab = Tabs.activeTab();
  const more = h('button', { class: 'fav-more', title: 'More pinned pages', html: icon('chevronDown', 13) });
  const add = h('button', {
    class: 'fav-add', title: `Pin this page (${modKey('D')})`, html: icon('plus', 14),
    disabled: !tab || isStart(tab.url) || tab.pinned,
    onclick: () => { const t = Tabs.activeTab(); if (t && !isStart(t.url)) Tabs.setPinned(t, true); },
  });
  bar.replaceChildren(strip, more, add);
  bindDrop(bar, { pinned: true });
  favbarParts = { strip, more };
  requestAnimationFrame(fitFavbar);
}

// Chips that don't fit move into a "more" menu.
export function fitFavbar() {
  if (!favbarParts) return;
  const { strip, more } = favbarParts;
  const chips = [...strip.querySelectorAll('.fav-chip')];
  chips.forEach((c) => c.classList.remove('hidden'));
  more.style.display = '';
  const max = strip.clientWidth;
  const hidden = chips.filter((c) => c.offsetLeft + c.offsetWidth > max + 1);
  hidden.forEach((c) => c.classList.add('hidden'));
  more.style.display = hidden.length ? '' : 'none';
  more.onclick = () => showMenu(0, 0, hidden.map((c) => Tabs.getTab(c.dataset.id)).filter(Boolean).map((t) => ({
    label: pinLabel(t), sub: hostOf(t.url), checked: t.id === S.activeId, action: () => Tabs.activate(t.id),
  })), { anchor: more, align: 'right' });
}

export function renamePin(t) {
  const input = h('input', { class: 'input', value: pinLabel(t), maxlength: 30 });
  const save = () => { t.pinTitle = input.value.trim() || null; changed(); m.close(); };
  const m = openModal({
    title: 'Rename Pin',
    width: 360,
    body: h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', {}, 'Name in the bar'), input)),
    footer: [
      h('button', { class: 'btn', onclick: () => { t.pinTitle = null; changed(); m.close(); } }, 'Use Page Title'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
    ],
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  setTimeout(() => { input.focus(); input.select(); }, 40);
}

// ---------------------------------------------------------------- pinned

function renderPinned() {
  const el = $('#pinned');
  const pinned = S.tabs.filter((t) => t.pinned);
  el.replaceChildren();
  el.classList.toggle('empty', !pinned.length);
  if (!pinned.length) {
    el.append(h('div', { class: 'pinned-hint' }, h('span', { html: icon('pin', 13) }), h('span', { class: 'grow' }, 'Drop tabs here to pin'), h('kbd', {}, modKey('D'))));
  }
  for (const t of pinned) {
    const tile = h('div', {
      class: `pin-tile${t.id === S.activeId ? ' active' : ''}${t.wv ? ' loaded' : ''}`,
      title: `${t.title}\n${t.url}`,
      draggable: 'true',
      dataset: { id: t.id },
    }, favicon(t, 18));
    if (t.audible) tile.append(h('span', { class: 'pin-audio', html: icon(t.muted ? 'mute' : 'volume', 10) }));
    tile.addEventListener('click', () => Tabs.activate(t.id));
    tile.addEventListener('auxclick', (e) => { if (e.button === 1) Tabs.closeTab(t.id); });
    tile.addEventListener('contextmenu', (e) => { e.preventDefault(); tabMenu(t, e.clientX, e.clientY); });
    bindDrag(tile, t);
    el.append(tile);
  }
  bindDrop(el, { pinned: true });
}

// ---------------------------------------------------------------- groups

function renderGroups() {
  const el = $('#groups');
  el.replaceChildren();
  for (const g of S.groups) {
    const tabs = S.tabs.filter((t) => !t.pinned && t.groupId === g.id);
    const color = GROUP_COLORS[g.color] || GROUP_COLORS.blue;
    const hasActive = tabs.some((t) => t.id === S.activeId);
    const head = h('div', { class: `group-head${g.collapsed ? ' collapsed' : ''}${hasActive && g.collapsed ? ' has-active' : ''}`, dataset: { group: g.id } },
      h('span', { class: 'chev', html: icon('chevronDown', 12) }),
      h('span', { class: 'group-dot', style: { background: color } }),
      h('span', { class: 'group-name' }, g.name),
      g.rules?.length ? h('span', { class: 'group-rule', title: `Auto: ${g.rules.join(', ')}`, html: icon('bolt', 11) }) : null,
      h('span', { class: 'group-count' }, tabs.length || ''),
      h('button', { class: 'row-btn', title: 'New tab in group', html: icon('plus', 13), onclick: (e) => { e.stopPropagation(); openPalette({ mode: 'newtab', groupId: g.id }); } }),
      h('button', { class: 'row-btn', title: 'Group options', html: icon('more', 13), onclick: (e) => { e.stopPropagation(); groupMenu(g, e.currentTarget); } }),
    );
    head.style.setProperty('--group', color);
    head.addEventListener('click', () => { g.collapsed = !g.collapsed; changed(); });
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); groupMenu(g, null, e.clientX, e.clientY); });
    bindDrop(head, { groupId: g.id });

    const list = h('div', { class: 'group-tabs', style: { '--group': color } });
    if (!g.collapsed) {
      for (const t of tabs) list.append(tabRow(t));
      if (!tabs.length) list.append(h('div', { class: 'group-empty' }, g.rules?.length ? `Sites like ${g.rules[0]} open here` : 'Drop tabs here'));
    } else if (hasActive) {
      list.append(tabRow(tabs.find((t) => t.id === S.activeId)));
    }
    bindDrop(list, { groupId: g.id });
    el.append(h('div', { class: 'group', style: { '--group': color } }, head, list));
  }
}

// ---------------------------------------------------------------- loose tabs

function renderLoose() {
  const el = $('#tabs');
  el.replaceChildren();
  const loose = S.tabs.filter((t) => !t.pinned && !S.groups.some((g) => g.id === t.groupId));
  for (const t of loose) el.append(tabRow(t));
  bindDrop($('#tabs-section'), { groupId: null });
}

// The tab's look in a list: 'tab' rows in the sidebar, 'ttab' in the strip on top.
export function tabAttrs(t, cls) {
  const sleeping = !t.wv && !isStart(t.url) && t.id !== S.activeId;
  return {
    class: `${cls}${t.id === S.activeId ? ' active' : ''}${t.loading ? ' loading' : ''}${sleeping ? ' sleeping' : ''}`,
    draggable: 'true',
    title: `${t.title}\n${t.url}\nLast used: ${Tabs.lastUsedLabel(t)}${sleeping ? ' · sleeping' : ''}`,
    dataset: { id: t.id },
  };
}

function tabRow(t) {
  const row = h('div', tabAttrs(t, 'tab'));
  row.append(tabIcon(t), h('span', { class: 'tab-title' }, t.title || hostOf(t.url) || 'New Tab'), ...tabExtras(t, row));
  bindTabEvents(row, t);
  return row;
}

export const tabIcon = (t) => h('span', { class: 'tab-icon' },
  t.loading ? h('span', { class: 'spinner' }) : isStart(t.url) ? h('span', { class: 'fav-blank', html: icon('search', 12) }) : favicon(t, 16));

// Lock, split, agent, sound and close after a tab's title, in the sidebar and in the strip on top.
export function tabExtras(t, row) {
  const out = [];
  if (t.keep) out.push(h('span', { class: 'tab-keep', title: 'Never closed automatically', html: icon('lock', 11) }));
  if (S.split?.panes.includes(t.id)) out.push(h('span', { class: 'tab-split', title: 'Shown in split view', html: icon(S.split.layout === 'grid' ? 'splitGrid' : S.split.layout === 'rows' ? 'splitRows' : 'splitCols', 12) }));
  if (t.agent) {
    row.classList.add('agent');
    out.push(h('span', { class: 'tab-agent', title: 'The AI agent is controlling this tab', html: icon('agent', 13) }));
  }
  if (t.audible || t.muted) {
    out.push(h('button', { class: 'row-btn audio', title: t.muted ? 'Unmute' : 'Mute', html: icon(t.muted ? 'mute' : 'volume', 13), onclick: (e) => { e.stopPropagation(); Tabs.toggleMute(t); } }));
  }
  out.push(h('button', { class: 'row-btn close', title: 'Close tab', html: icon('x', 12), onclick: (e) => { e.stopPropagation(); Tabs.closeTab(t.id); } }));
  return out;
}

export function bindTabEvents(row, t) {
  row.addEventListener('click', () => Tabs.activate(t.id));
  row.addEventListener('auxclick', (e) => { if (e.button === 1) Tabs.closeTab(t.id); });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); tabMenu(t, e.clientX, e.clientY); });
  bindDrag(row, t);
  bindDrop(row, { beforeTab: t });
}

// ---------------------------------------------------------------- drag & drop

function bindDrag(el, tab) {
  el.addEventListener('dragstart', (e) => {
    dragId = tab.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/uri-list', tab.url);
    e.dataTransfer.setData('text/plain', tab.url);
    document.body.classList.add('dragging-tab');
    startTabDrag(tab); // the page area becomes a drop target for split view
  });
  el.addEventListener('dragend', () => {
    endTabDrag();
    dragId = null;
    document.body.classList.remove('dragging-tab');
    document.querySelectorAll('.drop-target, .drop-before').forEach((x) => x.classList.remove('drop-target', 'drop-before'));
    changed({ persist: false });
  });
}

export function bindDrop(el, target) {
  if (el.dataset.dropBound) return;
  el.dataset.dropBound = '1';
  const cls = target.beforeTab ? 'drop-before' : 'drop-target';
  el.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add(cls);
  });
  el.addEventListener('dragleave', () => el.classList.remove(cls));
  el.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove(cls);
    const tab = Tabs.getTab(dragId);
    dragId = null;
    document.body.classList.remove('dragging-tab');
    if (!tab) return;
    if (target.beforeTab) Tabs.moveBefore(tab, target.beforeTab);
    else if (target.pinned) { if (!tab.pinned) Tabs.setPinned(tab, true); }
    else Tabs.moveToGroup(tab, target.groupId);
  });
}

// ---------------------------------------------------------------- tidy up

export const AI_TASKS = {
  organize: 'Organize my open tabs: put related tabs into a few clearly named groups by topic or project (reuse my existing groups when they fit, give new groups a fitting color), close exact duplicates, and sort each group sensibly. Keep pinned tabs as they are. Do it in as few tool calls as possible, then tell me briefly what you changed.',
  cleanup: 'Close the open tabs I most likely don\'t need anymore: duplicates, old search result pages, finished one-off pages, error pages, and tabs I haven\'t opened for a long time. Keep pinned tabs, the tab I\'m on, and anything that looks like ongoing work (documents, drafts, carts, dashboards). Then tell me what you closed and why, briefly.',
};

const runAgentTask = (key) => window.dispatchEvent(new CustomEvent('lumen:agent', { detail: { text: AI_TASKS[key] } }));

export function tidyMenu(anchor) {
  const dups = Tabs.duplicateSets();
  const dupIds = dups.flatMap((list) => list.slice(1).filter((t) => !t.pinned).map((t) => t.id));
  const stale = (h) => Tabs.staleTabs(h * 3600e3);
  const ranges = [[1, '1 hour'], [4, '4 hours'], [24, 'a day'], [24 * 7, 'a week']];
  const loose = S.tabs.filter((t) => !t.pinned && !S.groups.some((g) => g.id === t.groupId) && t.id !== S.activeId);
  showMenu(0, 0, [
    { type: 'header', label: 'AI' },
    { label: 'Organize Tabs with AI', icon: 'sparkles', action: () => runAgentTask('organize') },
    { label: 'Close Tabs I Don’t Need', icon: 'agent', action: () => runAgentTask('cleanup') },
    { type: 'separator' },
    {
      label: 'Sort Tabs', icon: 'layers', submenu: [
        { label: 'By Last Used', action: () => Tabs.sortTabs('last_used') },
        { label: 'By Website', action: () => Tabs.sortTabs('site') },
        { label: 'By Title', action: () => Tabs.sortTabs('title') },
      ],
    },
    { label: `Close Duplicates${dupIds.length ? ` (${dupIds.length})` : ''}`, icon: 'copy', disabled: !dupIds.length, action: () => Tabs.closeMany(dupIds, { label: `Closed ${dupIds.length} duplicate tab${dupIds.length > 1 ? 's' : ''}` }) },
    {
      label: 'Close Tabs Not Used In…', icon: 'history', submenu: ranges.map(([hrs, label]) => {
        const list = stale(hrs);
        return { label: `${label[0].toUpperCase()}${label.slice(1)}${list.length ? ` (${list.length})` : ''}`, disabled: !list.length, action: () => Tabs.closeMany(list.map((t) => t.id), { reason: 'archived', label: `Archived ${list.length} tab${list.length > 1 ? 's' : ''} not used in ${label}` }) };
      }),
    },
    { label: `Close All Loose Tabs${loose.length ? ` (${loose.length})` : ''}`, icon: 'x', disabled: !loose.length, action: () => Tabs.closeMany(loose.map((t) => t.id)) },
    { type: 'separator' },
    { label: `Archived Tabs${S.archive.length ? ` (${S.archive.length})` : ''}…`, icon: 'folder', action: () => window.dispatchEvent(new CustomEvent('lumen:history', { detail: 'archive' })) },
  ], anchor ? { anchor, align: 'right' } : {});
}

// ---------------------------------------------------------------- menus

export function modKey(k) {
  return (window.lumen.platform === 'darwin' ? '⌘' : 'Ctrl+') + k;
}

export function tabMenu(t, x, y) {
  const groups = S.groups.map((g) => ({
    label: g.name, color: GROUP_COLORS[g.color], checked: t.groupId === g.id && !t.pinned,
    action: () => Tabs.moveToGroup(t, g.id),
  }));
  showMenu(x, y, [
    { label: t.pinned ? 'Unpin' : 'Pin to Top', icon: 'pin', hint: modKey('D'), action: () => Tabs.setPinned(t, !t.pinned) },
    t.pinned ? { label: 'Rename Pin…', icon: 'compose', action: () => renamePin(t) } : null,
    !t.pinned ? { label: 'Never Close Automatically', icon: 'lock', checked: !!t.keep, action: () => { t.keep = !t.keep; changed(); toast(t.keep ? 'This tab stays open: no auto-close, sleep or AI cleanup' : 'Auto-close can manage this tab again', { iconName: 'lock', timeout: 2200 }); } } : null,
    {
      label: 'Move to Group', icon: 'folder', submenu: [
        ...groups,
        groups.length ? { type: 'separator' } : null,
        { label: 'New Group…', icon: 'folderPlus', action: () => editGroup(null, t) },
        t.groupId && !t.pinned ? { label: 'Remove from Group', icon: 'x', action: () => Tabs.moveToGroup(t, null) } : null,
      ],
    },
    { type: 'separator' },
    S.split?.panes.includes(t.id)
      ? { label: 'Remove from Split View', icon: 'x', action: () => removeTabFromSplit(t) }
      : { label: 'Open in Split View', icon: 'splitCols', action: () => openInSplit(t), disabled: isStart(t.url) },
    { label: 'Open in Floating Window', icon: 'float', action: () => window.lumen.float(t.url), disabled: !/^https?:/.test(t.url) },
    { label: 'Duplicate', icon: 'copy', action: () => Tabs.duplicateTab(t) },
    { label: 'Copy Link', icon: 'link', action: () => { navigator.clipboard.writeText(t.url); toast('Link copied', { iconName: 'check', timeout: 1400 }); } },
    { label: t.muted ? 'Unmute' : 'Mute', icon: t.muted ? 'volume' : 'mute', action: () => Tabs.toggleMute(t), disabled: !t.ready },
    { label: 'Reload', icon: 'reload', action: () => Tabs.reload(t), disabled: !t.wv },
    { type: 'separator' },
    t.pinned && t.pinnedUrl && t.url !== t.pinnedUrl ? { label: 'Go Back to Pinned Page', icon: 'undo', action: () => Tabs.navigate(t, t.pinnedUrl) } : null,
    { label: t.pinned ? 'Unload' : 'Close Tab', icon: 'x', hint: modKey('W'), action: () => Tabs.closeTab(t.id) },
    { label: 'Close Other Tabs', action: () => Tabs.closeOthers(t), disabled: S.tabs.filter((x) => !x.pinned).length < 2 },
  ]);
}

export function groupMenu(g, anchor, x, y) {
  const items = [
    { label: 'Edit Group…', icon: 'compose', action: () => editGroup(g) },
    { label: 'New Tab in Group', icon: 'plus', action: () => openPalette({ mode: 'newtab', groupId: g.id }) },
    { label: g.collapsed ? 'Expand' : 'Collapse', icon: 'chevronDown', action: () => { g.collapsed = !g.collapsed; changed(); } },
    { type: 'separator' },
    { label: 'Close All Tabs in Group', icon: 'x', action: () => S.tabs.filter((t) => t.groupId === g.id && !t.pinned).forEach((t) => Tabs.closeTab(t.id)) },
    { label: 'Delete Group…', icon: 'trash', danger: true, action: () => deleteGroup(g) },
  ];
  if (anchor) showMenu(0, 0, items, { anchor });
  else showMenu(x, y, items);
}

async function deleteGroup(g) {
  const ok = await confirmDialog({
    title: `Delete “${g.name}”?`,
    message: 'Its tabs stay open and move to the Tabs section.',
    confirm: 'Delete', danger: true,
  });
  if (!ok) return;
  for (const t of S.tabs) if (t.groupId === g.id) t.groupId = null;
  S.groups = S.groups.filter((x) => x.id !== g.id);
  changed();
}

// ---------------------------------------------------------------- group editor

export function editGroup(group, withTab = null) {
  const isNew = !group;
  const draft = group ? { ...group, rules: [...(group.rules || [])] } : { id: uid(), name: '', color: Object.keys(GROUP_COLORS)[S.groups.length % 8], collapsed: false, rules: [] };
  const active = Tabs.activeTab();
  if (isNew && withTab && /^https?:/.test(withTab.url)) draft.rules = [hostOf(withTab.url)];

  const name = h('input', { class: 'input', placeholder: 'Work, Research, Social…', value: draft.name, maxlength: 40 });
  const swatches = h('div', { class: 'swatches' });
  for (const [key, hex] of Object.entries(GROUP_COLORS)) {
    const b = h('button', { class: `swatch${draft.color === key ? ' on' : ''}`, style: { background: hex }, title: key });
    b.addEventListener('click', () => {
      draft.color = key;
      swatches.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
    swatches.append(b);
  }
  const rules = h('textarea', { class: 'input mono', rows: 4, placeholder: 'notion.so\nnotion.com\ngithub.com/my-org', spellcheck: 'false' });
  rules.value = draft.rules.join('\n');
  const addCurrent = h('button', { class: 'btn small', disabled: !active || !/^https?:/.test(active.url) }, h('span', { html: icon('plus', 12) }), `Add ${active ? hostOf(active.url) || 'current site' : 'current site'}`);
  addCurrent.addEventListener('click', () => {
    const host = hostOf(active.url);
    const list = rules.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (host && !list.includes(host)) list.push(host);
    rules.value = list.join('\n');
  });

  const body = h('div', { class: 'form' },
    h('label', { class: 'field' }, h('span', {}, 'Name'), name),
    h('div', { class: 'field' }, h('span', {}, 'Color'), swatches),
    h('div', { class: 'field' },
      h('span', {}, 'Always open these sites in this group'),
      rules,
      h('div', { class: 'field-row' }, h('small', { class: 'muted' }, 'One domain per line. Subdomains match too; add a path to be more specific.'), addCurrent)),
  );

  const save = () => {
    draft.name = name.value.trim() || 'Untitled';
    draft.rules = rules.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (isNew) {
      S.groups.push(draft);
      if (withTab) Tabs.moveToGroup(withTab, draft.id);
    } else {
      Object.assign(group, draft);
    }
    // Pull already-open matching tabs into their group.
    let moved = 0;
    for (const t of S.tabs) {
      if (t.pinned || t.groupId === draft.id) continue;
      if (draft.rules.some((r) => Tabs.matchRule(t.url, r))) { t.groupId = draft.id; moved++; }
    }
    if (moved) toast(`${moved} open tab${moved > 1 ? 's' : ''} moved to “${draft.name}”`, { iconName: 'folder' });
    changed();
    m.close();
  };

  const m = openModal({
    title: isNew ? 'New Group' : 'Edit Group',
    width: 460,
    body,
    footer: [
      isNew ? null : h('button', { class: 'btn danger-text', onclick: () => { m.close(); deleteGroup(group); } }, 'Delete'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: save }, isNew ? 'Create Group' : 'Save'),
    ],
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  setTimeout(() => name.focus(), 40);
}
