// Tabs on top (Settings → Appearance → Tabs → Top): a Chrome-style row of tabs above the toolbar instead of the
// sidebar. Same tabs, groups, menus and drag & drop as the sidebar; pinned pages stay in the favorites bar.
import { S, PRIVATE, GROUP_COLORS, changed } from './state.js';
import { h, $, hostOf } from './util.js';
import { icon } from './icons.js';
import * as Tabs from './tabs.js';
import { tabAttrs, tabIcon, tabExtras, bindTabEvents, bindDrop, groupMenu, tidyMenu, isDraggingTab, tabsOnTop, modKey } from './sidebar.js';

let list = null;
let shownActive = null;

// controls: the window buttons (Linux/Windows); onNewTab opens a fresh start page tab.
export function buildTabstrip({ controls, onNewTab }) {
  list = h('div', { class: 'ts-list' });
  // A mouse wheel scrolls the row sideways once the tabs no longer fit.
  list.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    list.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  bindDrop(list, { groupId: null });
  const strip = $('#tabstrip');
  strip.replaceChildren(
    ...(window.lumen.platform === 'darwin' ? [h('div', { class: 'mac-spacer' })] : []),
    list,
    h('button', { class: 'icon-btn ts-new', title: `New tab (${modKey('T')})`, html: icon('plus', 16), onclick: onNewTab }),
    h('div', { class: 'ts-fill' }),
    PRIVATE ? h('span', { class: 'private-badge', title: 'Nothing from this window is saved' }, h('span', { html: icon('mask', 13) }), 'Private') : '',
    h('button', { class: 'icon-btn ts-tidy', title: 'Tidy up tabs', html: icon('sparkles', 15), onclick: (e) => tidyMenu(e.currentTarget) }),
    controls || '');
  strip.addEventListener('dblclick', (e) => {
    if (e.target === strip || e.target.classList.contains('ts-fill') || e.target === list) window.lumen.win.maximize();
  });
}

function groupChip(g, tabs) {
  const color = GROUP_COLORS[g.color] || GROUP_COLORS.blue;
  const chip = h('button', {
    class: `ts-group${g.collapsed ? ' collapsed' : ''}`,
    style: { '--group': color },
    title: `${g.name}: ${tabs.length} tab${tabs.length === 1 ? '' : 's'}\nClick to ${g.collapsed ? 'expand' : 'collapse'}`,
  }, h('span', { class: 'ts-group-name' }, g.name), g.collapsed ? h('span', { class: 'ts-group-count' }, String(tabs.length)) : null);
  chip.addEventListener('click', () => { g.collapsed = !g.collapsed; changed(); });
  chip.addEventListener('contextmenu', (e) => { e.preventDefault(); groupMenu(g, null, e.clientX, e.clientY); });
  bindDrop(chip, { groupId: g.id });
  return chip;
}

function stripTab(t, color) {
  const el = h('div', tabAttrs(t, `ttab${color ? ' grouped' : ''}`));
  if (color) el.style.setProperty('--group', color);
  el.append(tabIcon(t), h('span', { class: 'tab-title' }, t.title || hostOf(t.url) || 'New Tab'), ...tabExtras(t, el));
  bindTabEvents(el, t);
  return el;
}

export function renderTabstrip() {
  if (!list || !tabsOnTop() || isDraggingTab()) return;
  const items = [];
  for (const g of S.groups) {
    const tabs = S.tabs.filter((t) => !t.pinned && t.groupId === g.id);
    if (!tabs.length) continue; // an empty group has nothing to show here; it's still in the tab menu
    const color = GROUP_COLORS[g.color] || GROUP_COLORS.blue;
    items.push(groupChip(g, tabs));
    // A collapsed group still shows the tab you're on, like the sidebar.
    for (const t of g.collapsed ? tabs.filter((x) => x.id === S.activeId) : tabs) items.push(stripTab(t, color));
  }
  for (const t of S.tabs.filter((x) => !x.pinned && !S.groups.some((g) => g.id === x.groupId))) items.push(stripTab(t, null));
  const scrolled = list.scrollLeft;
  list.replaceChildren(...items);
  list.scrollLeft = scrolled;
  if (shownActive !== S.activeId) {
    shownActive = S.activeId;
    list.querySelector('.ttab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
