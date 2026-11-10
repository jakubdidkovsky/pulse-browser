// Tabs view: every open tab in Pulse's order. Tap one to show it, close it with ×, or open a new one from the field.
import { h, icon, favicon } from './dom.js';
import { store, command, go } from './api.js';

let root;
let list;
let field;
let lastJson = '';

async function open(text) {
  field.blur();
  field.value = '';
  if (await command('tab.open', { text })) go('screen');
}

function rowEl(t, active) {
  const row = h('div', { class: `tab-row${active ? ' active' : ''}` },
    h('span', { class: 'tab-icon' }, favicon(t)),
    h('span', { class: 'tab-text' },
      h('b', {}, t.title || 'New Tab'),
      h('small', {}, t.pinned ? `Pinned · ${t.host || 'New Tab'}` : t.host || 'New Tab')),
    h('button', { class: 'tab-close', 'aria-label': 'Close tab', html: icon('x', 16), onclick: (e) => { e.stopPropagation(); command('tab.close', { id: t.id }); } }));
  row.addEventListener('click', async () => { if (await command('tab.activate', { id: t.id })) go('screen'); });
  return row;
}

function render() {
  const t = store.tabs;
  if (!t) return;
  const json = JSON.stringify(t);
  if (json === lastJson) return;
  lastJson = json;
  list.replaceChildren(...(t.tabs.length ? t.tabs.map((tab) => rowEl(tab, tab.id === t.activeId)) : [h('div', { class: 'empty' }, h('p', {}, 'No tabs open.'))]));
}

export function mount() {
  field = h('input', { class: 'field', type: 'url', inputmode: 'url', placeholder: 'New tab: search or enter website', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go' });
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && field.value.trim()) { e.preventDefault(); open(field.value); } });
  list = h('div', { class: 'tab-list' });
  root = h('section', { class: 'view tabs-view' },
    h('div', { class: 'tabs-head' }, field, h('button', { class: 'tool', 'aria-label': 'New tab', html: icon('plus', 20), onclick: () => (field.value.trim() ? open(field.value) : open('')) })),
    list);
  return root;
}

export function update(part) {
  if (part === 'tabs') render();
}

export const title = () => `${store.tabs?.tabs.length || 0} Tabs`;
