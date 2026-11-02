// History sheet: search, grouped by day, delete entries, clear ranges.
import { S, removeHistory, changed } from './state.js';
import { h, favicon, dayLabel, timeOf, prettyUrl, isStart, timeAgo } from './util.js';
import { icon } from './icons.js';
import { openModal, showMenu, confirmDialog, toast, segmented } from './ui.js';
import * as Tabs from './tabs.js';

const REASONS = { closed: 'Closed', archived: 'Auto-archived', agent: 'Closed by AI', auto: 'Site limit' };

export function openHistory(view = 'history') {
  const search = h('input', { class: 'input search', placeholder: view === 'archive' ? 'Search archived tabs' : 'Search history', spellcheck: 'false' });
  const list = h('div', { class: 'history-list' });
  let limit = 300;

  const renderArchive = () => {
    const q = search.value.trim().toLowerCase();
    const items = q ? S.archive.filter((e) => e.title?.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)) : S.archive;
    list.replaceChildren();
    if (!items.length) {
      list.append(h('div', { class: 'empty-note' }, q ? 'No matches.' : 'Tabs you close, or that Pulse archives after a while, show up here ready to reopen.'));
      return;
    }
    let day = null;
    for (const e of items) {
      const label = dayLabel(e.at || Date.now());
      if (label !== day) {
        day = label;
        list.append(h('div', { class: 'history-day' }, label));
      }
      const row = h('div', { class: 'history-row', title: e.url },
        h('span', { class: 'history-time' }, timeOf(e.at || Date.now())),
        favicon(e, 16),
        h('span', { class: 'history-text' }, h('span', { class: 'history-title' }, e.title || e.url), h('span', { class: 'history-url' }, prettyUrl(e.url))),
        h('span', { class: `reason-badge ${e.reason || 'closed'}` }, REASONS[e.reason] || 'Closed'),
        h('button', { class: 'row-btn', title: 'Remove', html: icon('x', 12), onclick: (ev) => { ev.stopPropagation(); S.archive = S.archive.filter((x) => x !== e); changed(); renderArchive(); } }));
      row.addEventListener('click', () => { Tabs.restoreEntry(e, { background: true }); toast('Tab restored', { iconName: 'undo', timeout: 1400 }); renderArchive(); });
      list.append(row);
    }
  };

  const render = () => {
    if (view === 'archive') return renderArchive();
    const q = search.value.trim().toLowerCase();
    const items = q ? S.history.filter((e) => e.title?.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)) : S.history;
    list.replaceChildren();
    if (!items.length) {
      list.append(h('div', { class: 'empty-note' }, q ? 'No matches.' : 'Your browsing history will appear here.'));
      return;
    }
    let day = null;
    for (const e of items.slice(0, limit)) {
      const label = dayLabel(e.ts);
      if (label !== day) {
        day = label;
        list.append(h('div', { class: 'history-day' }, label));
      }
      const row = h('div', { class: 'history-row', title: e.url },
        h('span', { class: 'history-time' }, timeOf(e.ts)),
        favicon(e, 16),
        h('span', { class: 'history-text' }, h('span', { class: 'history-title' }, e.title || e.url), h('span', { class: 'history-url' }, prettyUrl(e.url))),
        h('button', { class: 'row-btn', title: 'Remove', html: icon('x', 12), onclick: (ev) => { ev.stopPropagation(); removeHistory((x) => x === e); render(); } }));
      row.addEventListener('click', (ev) => {
        const tab = Tabs.activeTab();
        m.close();
        if (!ev.ctrlKey && !ev.metaKey && tab && isStart(tab.url)) Tabs.navigate(tab, e.url);
        else Tabs.open(e.url, { background: ev.ctrlKey || ev.metaKey });
      });
      list.append(row);
    }
    if (items.length > limit) {
      list.append(h('button', { class: 'btn small more-btn', onclick: () => { limit += 500; render(); } }, `Show more (${items.length - limit})`));
    }
  };

  const clearBtn = h('button', { class: 'btn' }, view === 'archive' ? 'Clear Archive' : 'Clear History…');
  clearBtn.addEventListener('click', async () => {
    if (view === 'archive') {
      if (!(await confirmDialog({ title: 'Clear the archive?', message: 'Archived tabs can’t be reopened afterwards.', confirm: 'Clear', danger: true }))) return;
      S.archive = [];
      changed();
      render();
      return;
    }
    const ranges = [['the last hour', 3600e3], ['today', 'today'], ['the last 7 days', 7 * 86400e3], ['all time', Infinity]];
    showMenu(0, 0, ranges.map(([label, span]) => ({
      label: `Clear ${label}`,
      danger: span === Infinity,
      action: async () => {
        if (!(await confirmDialog({ title: `Clear history from ${label}?`, message: 'This can’t be undone.', confirm: 'Clear', danger: true }))) return;
        const now = Date.now();
        const from = span === 'today' ? new Date().setHours(0, 0, 0, 0) : now - span;
        removeHistory((e) => e.ts >= from);
        toast('History cleared', { iconName: 'check' });
        render();
      },
    })), { anchor: clearBtn });
  });

  const count = h('small', { class: 'muted' });
  const setCount = () => { count.textContent = view === 'archive' ? `${S.archive.length} archived tabs` : `${S.history.length.toLocaleString()} visits`; };
  const tabsSwitch = segmented([['history', 'History'], ['archive', 'Archived Tabs']], view, (v) => {
    view = v;
    search.placeholder = v === 'archive' ? 'Search archived tabs' : 'Search history';
    clearBtn.textContent = v === 'archive' ? 'Clear Archive' : 'Clear History…';
    limit = 300;
    setCount();
    render();
  });
  const m = openModal({
    title: 'History',
    width: 680,
    className: 'history-modal',
    body: h('div', { class: 'history' }, h('div', { class: 'history-top' }, tabsSwitch), h('div', { class: 'history-search' }, h('span', { html: icon('search', 15) }), search), list),
    footer: [count, h('div', { class: 'spacer' }), clearBtn],
  });
  setCount();
  search.addEventListener('input', () => { limit = 300; render(); });
  render();
  setTimeout(() => search.focus(), 40);
}
