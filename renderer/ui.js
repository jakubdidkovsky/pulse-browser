// Reusable UI primitives: context menus, popovers, modals, toasts.
import { h, $ } from './util.js';
import { icon } from './icons.js';

const root = () => $('#overlay-root');

// ---------------------------------------------------------------- menus

let openMenu = null;

export function closeMenu() {
  if (!openMenu) return;
  const layer = openMenu;
  openMenu = null;
  layer.remove();
  layer.onMenuClose?.();
}

function buildMenu(items, close) {
  const menu = h('div', { class: 'menu', role: 'menu' });
  let sub = null;
  const closeSub = () => { sub?.remove(); sub = null; };
  for (const it of items) {
    if (!it) continue;
    if (it.type === 'separator') { menu.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.type === 'header') { menu.append(h('div', { class: 'menu-header' }, it.label)); continue; }
    if (it.type === 'custom') { menu.append(it.el); continue; }
    const row = h('div', {
      class: `menu-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}${it.checked ? ' checked' : ''}`,
      role: 'menuitem',
    });
    const lead = it.logo
      ? h('span', { class: 'menu-icon', html: it.logo })
      : it.color
        ? h('span', { class: 'menu-icon' }, h('span', { class: 'dot', style: { background: it.color } }))
        : h('span', { class: 'menu-icon', html: it.checked ? icon('check', 14) : it.icon ? icon(it.icon, 15) : '' });
    row.append(lead, h('span', { class: 'menu-label' }, it.label, it.sub ? h('small', {}, it.sub) : null));
    if (it.badge) row.append(h('span', { class: `menu-badge ${it.badgeClass || ''}` }, it.badge));
    if (it.hint) row.append(h('span', { class: 'menu-hint' }, it.hint));
    if (it.submenu) row.append(h('span', { class: 'menu-hint', html: icon('chevronRight', 12) }));
    row.addEventListener('mouseenter', () => {
      closeSub();
      if (!it.submenu || it.disabled) return;
      sub = buildMenu(typeof it.submenu === 'function' ? it.submenu() : it.submenu, close);
      sub.classList.add('submenu');
      menu.parentElement.append(sub);
      const r = row.getBoundingClientRect();
      place(sub, r.right - 4, r.top - 5, r.left + 4);
    });
    if (!it.submenu) {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.disabled) return;
        if (!it.keepOpen) close();
        it.action?.();
      });
    }
    menu.append(row);
  }
  return menu;
}

function place(el, x, y, altX) {
  el.style.left = '0px';
  el.style.top = '0px';
  const r = el.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  let left = x;
  if (left + r.width > W - 8) left = altX != null ? altX - r.width : W - r.width - 8;
  let top = y;
  if (top + r.height > H - 8) top = Math.max(8, H - r.height - 8);
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${top}px`;
}

// items: [{label, icon, hint, action, danger, disabled, checked, color, submenu} | {type:'separator'} | {type:'header', label}]
export function showMenu(x, y, items, { align = 'left', anchor = null, className = '', minWidth = 0, onClose = null } = {}) {
  closeMenu();
  const layer = h('div', { class: 'menu-layer' });
  layer.onMenuClose = onClose;
  const close = () => closeMenu();
  layer.addEventListener('mousedown', (e) => { if (e.target === layer) close(); });
  layer.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });
  const menu = buildMenu(items, close);
  if (className) menu.classList.add(...className.split(' '));
  if (minWidth) menu.style.minWidth = `${minWidth}px`;
  layer.append(menu);
  root().append(layer);
  openMenu = layer;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth; // layout width; the opening animation scales the box
    place(menu, align === 'right' ? r.right - mw : r.left, r.bottom + 6);
  } else {
    place(menu, x, y);
  }
  requestAnimationFrame(() => menu.classList.add('in'));
  return close;
}

// ---------------------------------------------------------------- popovers (arbitrary content anchored to an element)

export function popover(anchor, content, { align = 'left', width = 300, onClose } = {}) {
  closeMenu();
  const layer = h('div', { class: 'menu-layer' });
  const box = h('div', { class: 'popover', style: { width: `${width}px` } }, content);
  const close = () => { if (openMenu === layer) closeMenu(); onClose?.(); };
  layer.addEventListener('mousedown', (e) => { if (e.target === layer) close(); });
  layer.append(box);
  root().append(layer);
  openMenu = layer;
  const r = anchor.getBoundingClientRect();
  place(box, align === 'right' ? r.right - width : r.left, r.bottom + 8);
  requestAnimationFrame(() => box.classList.add('in'));
  return close;
}

// ---------------------------------------------------------------- modals

const modalStack = [];

export function openModal({ title, body, footer, width = 560, className = '', onClose, dismissable = true } = {}) {
  closeMenu();
  const backdrop = h('div', { class: 'modal-backdrop' });
  const dialog = h('div', { class: `modal ${className}`, style: { width: `min(${width}px, calc(100vw - 32px))` }, role: 'dialog' });
  if (title) {
    dialog.append(h('div', { class: 'modal-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', title: 'Close', html: icon('x', 15), onclick: () => close() })));
  }
  const bodyEl = h('div', { class: 'modal-body' });
  if (body) bodyEl.append(body);
  dialog.append(bodyEl);
  if (footer) dialog.append(h('div', { class: 'modal-foot' }, footer));
  backdrop.append(dialog);
  root().append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('in'));

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    const i = modalStack.indexOf(api);
    if (i >= 0) modalStack.splice(i, 1);
    backdrop.classList.remove('in');
    backdrop.classList.add('out');
    setTimeout(() => backdrop.remove(), 180);
    onClose?.();
  }
  if (dismissable) backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  const api = { close, el: dialog, body: bodyEl, dismissable };
  modalStack.push(api);
  return api;
}

export function topModal() {
  return modalStack.at(-1) || null;
}

export function confirmDialog({ title, message, confirm = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal({
      width: 380,
      className: 'alert',
      body: h('div', { class: 'alert-body' }, h('h3', {}, title), message ? h('p', {}, message) : null),
      footer: [
        h('button', { class: 'btn', onclick: () => m.close() }, cancel),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { result = true; m.close(); } }, confirm),
      ],
      onClose: () => resolve(result),
    });
    setTimeout(() => m.el.querySelector('.btn.primary, .btn.danger')?.focus(), 30);
  });
}

// ---------------------------------------------------------------- toasts

export function toast(text, { action, timeout = 3200, iconName, progress } = {}) {
  let host = $('#toasts');
  if (!host) {
    host = h('div', { id: 'toasts' });
    root().append(host);
  }
  const bar = progress != null ? h('div', { class: 'toast-progress' }, h('i', { style: { width: `${progress * 100}%` } })) : null;
  const label = h('span', { class: 'toast-text' }, text);
  const el = h('div', { class: 'toast' },
    iconName ? h('span', { class: 'toast-icon', html: icon(iconName, 15) }) : null,
    h('div', { class: 'toast-main' }, label, bar));
  let actionBtn = null;
  if (action) {
    actionBtn = h('button', { class: 'toast-action', onclick: () => { action.fn(); dismiss(); } }, action.label);
    el.append(actionBtn);
  }
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  let timer = timeout ? setTimeout(dismiss, timeout) : null;
  function dismiss() {
    clearTimeout(timer);
    el.classList.remove('in');
    setTimeout(() => el.remove(), 220);
  }
  return {
    dismiss,
    update({ text: t, progress: p, action: a, timeout: to } = {}) {
      if (t != null) label.textContent = t;
      if (p != null && bar) bar.firstChild.style.width = `${Math.round(p * 100)}%`;
      if (p === null && bar) bar.remove();
      if (a && !actionBtn) {
        actionBtn = h('button', { class: 'toast-action', onclick: () => { a.fn(); dismiss(); } }, a.label);
        el.append(actionBtn);
      }
      if (to) { clearTimeout(timer); timer = setTimeout(dismiss, to); }
    },
  };
}

// ---------------------------------------------------------------- form controls

export function toggle(checked, onchange) {
  const input = h('input', { type: 'checkbox', class: 'switch' });
  input.checked = !!checked;
  input.addEventListener('change', () => onchange(input.checked));
  return input;
}

export function segmented(options, value, onchange) {
  const el = h('div', { class: 'segmented' });
  for (const [val, label] of options) {
    const b = h('button', { class: val === value ? 'on' : '' }, label);
    b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onchange(val);
    });
    el.append(b);
  }
  return el;
}

// A macOS-style pop-up button: shows the current choice and opens a rounded menu with a check by it
// (the native <select> list is a square system box on Linux). onchange gets the value as a string.
export function select(options, value, onchange) {
  let current = value;
  const label = h('span', { class: 'select-label' });
  const el = h('button', { type: 'button', class: 'select', 'aria-haspopup': 'menu' },
    label, h('span', { class: 'select-chevron', html: icon('chevronUpDown', 12) }));
  const sync = () => { label.textContent = options.find(([v]) => String(v) === String(current))?.[1] ?? ''; };
  sync();
  el.addEventListener('click', () => {
    el.classList.add('open');
    showMenu(0, 0, options.map(([v, text]) => ({
      label: text,
      checked: String(v) === String(current),
      action: () => { current = v; sync(); onchange(String(v)); },
    })), {
      anchor: el, className: 'select-menu', minWidth: Math.max(140, el.getBoundingClientRect().width),
      align: el.getBoundingClientRect().left > window.innerWidth / 2 ? 'right' : 'left',
      onClose: () => el.classList.remove('open'),
    });
  });
  return el;
}
