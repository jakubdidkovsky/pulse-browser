// The list above the AI composer while "/" is typed: pick a saved command with the arrows and Enter or Tab, or click it.
// Called from renderer/ai.js before its own keydown handler, so keys the menu uses never reach submit().
import { h } from './util.js';
import { icon } from './icons.js';
import { matchCommands } from './commands.js';

const MAX_ITEMS = 8;

export function attachCommandMenu(input, { commands, onCreate }) {
  const menu = h('div', { class: 'cmd-menu', role: 'listbox' });
  menu.hidden = true;
  let rows = []; // [{ el, run }]
  let index = 0;

  const close = () => { menu.hidden = true; rows = []; };
  const highlight = (i) => {
    index = (i + rows.length) % rows.length;
    rows.forEach((r, n) => r.el.classList.toggle('on', n === index));
    rows[index]?.el.scrollIntoView({ block: 'nearest' });
  };
  const complete = (c) => {
    input.value = `/${c.name} `;
    input.dispatchEvent(new Event('input', { bubbles: true })); // resizes the box and closes this menu
    input.focus();
  };
  const row = (iconName, title, detail, run) => {
    const el = h('button', { class: 'cmd-item', role: 'option', tabindex: -1, onmousedown: (e) => { e.preventDefault(); run(); } },
      h('span', { class: 'cmd-icon', html: icon(iconName, 14) }),
      h('span', { class: 'cmd-name' }, title),
      detail ? h('span', { class: 'cmd-desc' }, detail) : null);
    return { el, run };
  };

  const refresh = () => {
    const all = commands();
    const found = matchCommands(input.value, all);
    if (!found) { close(); return; }
    if (!all.length && input.value === '/') {
      rows = [row('plus', 'Create a Command', 'Save instructions you can run with /name', () => { close(); onCreate(); })];
    } else {
      rows = found.slice(0, MAX_ITEMS).map((c) => row('slash', `/${c.name}`, c.description, () => complete(c)));
    }
    if (!rows.length) { close(); return; }
    menu.replaceChildren(...rows.map((r) => r.el));
    menu.hidden = false;
    highlight(0);
  };

  const onKey = (e) => {
    if (menu.hidden || e.isComposing) return;
    const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { take(); highlight(index + (e.key === 'ArrowDown' ? 1 : -1)); return; }
    if (e.key === 'Escape') { take(); close(); return; }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      // A fully typed name sends on Enter like any message; otherwise Enter completes the name first.
      const typed = input.value.trim().toLowerCase();
      const chosen = rows[index];
      if (e.key === 'Enter' && chosen && typed === chosen.el.querySelector('.cmd-name').textContent) { close(); return; }
      take();
      chosen?.run();
    }
  };

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', close);
  return menu;
}
