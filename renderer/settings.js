// Settings window: General, Appearance, AI accounts, Groups, Privacy, Shortcuts, About.
import { S, setSetting, ACCENTS, GROUP_COLORS, PRIVATE } from './state.js';
import { h, SEARCH_ENGINES } from './util.js';
import { icon, logo } from './icons.js';
import { openModal, toggle, segmented, select, confirmDialog, toast } from './ui.js';
import { PROVIDERS, statusOf, modelFor, prettyModel, providerById } from './providers.js';
import { refreshStatus, selectProvider, cliLogin, loadModels, modelCache, serverEnabled, rememberServers } from './ai.js';
import { editGroup, modKey } from './sidebar.js';
import * as Tabs from './tabs.js';
import { setStartMode, editShortcut, removeShortcut, siteName } from './start.js';
import { listExtensions, removeExtension } from './extensions.js';
import { openWelcome } from './welcome.js';
import * as Usage from './usage.js';

const SECTIONS = [
  ['general', 'General', 'settings'],
  ['appearance', 'Appearance', 'palette'],
  ['ai', 'AI', 'sparkles'],
  ['usage', 'Usage', 'chart'],
  ['extensions', 'Extensions', 'puzzle'],
  ['groups', 'Groups', 'folder'],
  ['privacy', 'Privacy', 'shield'],
  ['shortcuts', 'Shortcuts', 'keyboard'],
  ['about', 'About', 'info'],
];

let modal = null;

export function openSettings(section = 'general') {
  if (modal) modal.close();
  const nav = h('nav', { class: 'settings-nav' });
  const pane = h('div', { class: 'settings-pane' });
  const show = (id) => {
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    pane.replaceChildren(RENDER[id]());
    pane.scrollTop = 0;
  };
  for (const [id, label, ic] of SECTIONS) {
    nav.append(h('button', { dataset: { id }, onclick: () => show(id) }, h('span', { html: icon(ic, 15) }), label));
  }
  modal = openModal({ title: 'Settings', width: 820, className: 'settings-modal', body: h('div', { class: 'settings' }, nav, pane), onClose: () => { modal = null; } });
  show(section);
}

const row = (label, control, help) => h('div', { class: 'set-row' },
  h('div', { class: 'set-label' }, h('span', {}, label), help ? h('small', {}, help) : null),
  h('div', { class: 'set-control' }, control));
const group = (title, ...rows) => h('section', { class: 'set-group' }, title ? h('h4', {}, title) : null, h('div', { class: 'set-card' }, ...rows));

const RENDER = {
  general() {
    return h('div', {},
      group('Search',
        row('Search engine', select(Object.entries(SEARCH_ENGINES).map(([k, v]) => [k, v.name]), S.settings.engine, (v) => setSetting('engine', v))),
        row('Search suggestions', toggle(S.settings.suggestions, (v) => setSetting('suggestions', v)), 'Shows suggestions from your search engine while you type.')),
      startPage(),
      group('Pinned pages',
        row('Show pinned pages in', segmented([['bar', 'Top bar'], ['sidebar', 'Sidebar']], S.settings.pinsLocation || 'bar', (v) => setSetting('pinsLocation', v)), 'Top bar keeps them one click away even when the sidebar is hidden.'),
        row('Show favorites bar', toggle(S.settings.favbar !== false, (v) => setSetting('favbar', v)), `Toggle anytime with ${modKey('⇧B')}.`)),
      group('Tabs',
        row('Put unused tabs to sleep after', select([[0, 'Never'], [15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [120, '2 hours']], S.settings.tabs?.sleepAfter ?? 45, (v) => setSetting('tabs.sleepAfter', +v)), 'Sleeping tabs stay in the sidebar but free their memory; they reload when you click them.'),
        row('Archive tabs not opened for', select([[0, 'Never'], [12, '12 hours'], [24, '1 day'], [72, '3 days'], [168, '1 week']], S.settings.tabs?.archiveAfter ?? 24, (v) => setSetting('tabs.archiveAfter', +v)), 'Pinned tabs are never archived. Only time while Pulse is open counts. Archived tabs are one click away in History → Archived Tabs.')),
      tabRules(),
      group('Window',
        row('Keep window on top', toggle(S.settings.alwaysOnTop, (v) => { setSetting('alwaysOnTop', v); window.lumen.win.setOnTop(v); }), 'Pins Pulse above other apps.'),
        row('Show sidebar', toggle(S.settings.sidebarVisible, (v) => window.dispatchEvent(new CustomEvent('lumen:sidebar', { detail: v })))),
        row('Reveal hidden sidebar on hover', toggle(S.settings.sidebarPeek, (v) => setSetting('sidebarPeek', v)), 'Slides the sidebar in when the pointer touches the left edge.')),
    );
  },

  appearance() {
    const accents = h('div', { class: 'swatches' });
    for (const [k, hex] of Object.entries(ACCENTS)) {
      const b = h('button', { class: `swatch${S.settings.accent === k ? ' on' : ''}`, style: { background: hex }, title: k });
      b.addEventListener('click', () => {
        setSetting('accent', k);
        document.documentElement.dataset.accent = k;
        accents.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      });
      accents.append(b);
    }
    return h('div', {},
      group('Theme',
        row('Appearance', segmented([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], S.settings.theme, (v) => { setSetting('theme', v); window.lumen.setTheme(v); })),
        row('Accent color', accents)));
  },

  ai() {
    const wrap = h('div', {});
    const draw = () => {
      const p = providerById(S.settings.ai.provider);
      wrap.replaceChildren(
        group('Assistant',
          row('Default AI', select(PROVIDERS.map((x) => [x.id, x.kind === 'cli' ? `${x.name} — ${x.via}` : x.kind === 'web' ? `${x.name} (web)` : x.name]), p?.id, (v) => { selectProvider(v); draw(); })),
          row('Share the current page', toggle(S.settings.ai.sharePage, (v) => setSetting('ai.sharePage', v)), 'The AI sees the page text, your selection, open tabs and recent activity. You can turn it off per message.'),
          row('Include a screenshot', toggle(S.settings.ai.screenshot, (v) => setSetting('ai.screenshot', v)), 'Sends an image of the page to API providers that support vision.'),
          row('Page text limit', select([[20000, 'Short (20k chars)'], [60000, 'Standard (60k)'], [150000, 'Long (150k)'], [400000, 'Very long (400k)']], S.settings.ai.maxChars, (v) => setSetting('ai.maxChars', +v))),
          row('Claude response depth', segmented([['low', 'Fast'], ['medium', 'Balanced'], ['high', 'Deep']], S.settings.ai.effort || 'medium', (v) => setSetting('ai.effort', v)), 'Applies to the Claude API.')),
        group('Agent',
          row('Speed vs. thoroughness', segmented([['low', 'Fastest'], ['medium', 'Balanced'], ['high', 'Thorough']], S.settings.ai.agentEffort || 'low', (v) => setSetting('ai.agentEffort', v)), 'How much the agent thinks before each step. For even more speed pick Sonnet or Haiku as the Claude Code model.'),
          row('Computer access (Claude Code)', toggle(S.settings.ai.computer !== false, (v) => setSetting('ai.computer', v)), 'The agent can run commands and work with files in a folder you choose — like Claude Code in a terminal. Every command and file change asks first.'),
          row('Working folder', h('button', { class: 'btn small', onclick: async () => { const d = await window.lumen.pickFolder(S.settings.ai.workdir); if (d) { setSetting('ai.workdir', d); draw(); } } }, (S.settings.ai.workdir || '~').replace(/^\/home\/[^/]+/, '~')), 'Where commands run. You can also switch it with the folder button under the chat.'),
          row('Ask before risky clicks', toggle(S.settings.ai.agentConfirm !== false, (v) => setSetting('ai.agentConfirm', v)), 'Pay, buy, send, post, delete… the agent waits for your OK — unless you asked for exactly that (e.g. “pošli to”). Ticking boxes and choosing options never asks.'),
          row('Site memory & session files', h('button', { class: 'btn small', onclick: () => window.lumen.sites.open(null) }, 'Open folder'), 'Each website gets a folder with CONTEXT.md (what the agent learned) and full transcripts of every session.')),
        connectorsSection(draw),
        h('section', { class: 'set-group' }, h('h4', {}, 'Use your subscription'), h('p', { class: 'set-note' }, 'These run the vendor’s own command-line app with the account you’re signed in to — no API key needed.'),
          h('div', { class: 'providers' }, ...PROVIDERS.filter((x) => x.kind === 'cli').map((x) => providerCard(x, draw)))),
        h('section', { class: 'set-group' }, h('h4', {}, 'API keys'), h('p', { class: 'set-note' }, 'Keys are encrypted with your system keychain and never leave this computer except to call the provider.'),
          h('div', { class: 'providers' }, ...PROVIDERS.filter((x) => x.kind === 'api').map((x) => providerCard(x, draw)))),
        h('section', { class: 'set-group' }, h('h4', {}, 'Web apps'), h('p', { class: 'set-note' }, 'The official sites in the side panel. Sign in once; “Send page” drops the current page into the chat.'),
          h('div', { class: 'providers' }, ...PROVIDERS.filter((x) => x.kind === 'web').map((x) => providerCard(x, draw)))),
      );
    };
    draw();
    return wrap;
  },

  groups() {
    const list = h('div', { class: 'set-card' });
    if (!S.groups.length) list.append(h('div', { class: 'empty-note' }, 'No groups yet. Groups keep related tabs together — and can automatically catch sites like notion.so.'));
    for (const g of S.groups) {
      list.append(h('div', { class: 'set-row group-row' },
        h('div', { class: 'set-label' },
          h('span', {}, h('i', { class: 'dot', style: { background: GROUP_COLORS[g.color] } }), g.name),
          h('small', {}, g.rules?.length ? `Auto: ${g.rules.join(', ')}` : 'No automatic rules')),
        h('div', { class: 'set-control' }, h('button', { class: 'btn small', onclick: () => { modal?.close(); editGroup(g); } }, 'Edit'))));
    }
    return h('div', {},
      h('section', { class: 'set-group' }, h('h4', {}, 'Tab groups'), list),
      h('button', { class: 'btn', onclick: () => { modal?.close(); editGroup(null); } }, h('span', { html: icon('folderPlus', 14) }), 'New Group'));
  },

  privacy() {
    const clear = (what, title, message) => async () => {
      if (!(await confirmDialog({ title, message, confirm: 'Clear', danger: true }))) return;
      await window.lumen.clearData(what);
      toast('Done', { iconName: 'check' });
    };
    const P = S.settings.privacy;
    const perm = (key, label, help) => row(label,
      select([['ask', 'Ask'], ['allow', 'Allow'], ['block', 'Block']], P.permissions[key] || 'ask', (v) => setSetting(`privacy.permissions.${key}`, v)), help);
    return h('div', {},
      group('Cookie banners',
        row('Answer cookie banners for me',
          segmented([['smart', 'Smart'], ['reject', 'Reject'], ['accept', 'Accept'], ['off', 'Off']], P.cookies || 'smart', (v) => setSetting('privacy.cookies', v)),
          'Smart rejects optional cookies and only accepts where a site offers nothing else (e.g. “consent or pay”). Reject never accepts — the banner is just hidden. Applies to the AI agent’s pages too. Uses DuckDuckGo’s Autoconsent rules.')),
      group('When a site asks for…',
        perm('location', 'Location'),
        perm('media', 'Camera & microphone'),
        perm('notifications', 'Notifications'),
        perm('clipboard', 'Reading your clipboard'),
        perm('screen', 'Sharing your screen'),
        perm('devices', 'USB, serial, HID & MIDI devices', 'Ask shows a prompt the first time; your answer is remembered per site below.')),
      sitePermissions(),
      group('Browsing data',
        row('Cache', h('button', { class: 'btn small', onclick: clear('cache', 'Clear cache?', 'Pages may load a bit slower the next time.') }, 'Clear')),
        row('Cookies & site data', h('button', { class: 'btn small', onclick: clear('site-data', 'Clear cookies and site data?', 'You’ll be signed out of websites, including AI web apps.') }, 'Clear')),
        row('Site permissions', h('button', { class: 'btn small', onclick: clear('permissions', 'Reset site permissions?', 'Sites will ask again for camera, microphone, location, etc.') }, 'Reset')),
        row('History', h('button', { class: 'btn small', onclick: () => { modal?.close(); window.dispatchEvent(new Event('lumen:history')); } }, 'Open History…'))));
  },

  shortcuts() {
    const list = [
      ['New tab / command bar', modKey('T')], ['Command bar', modKey('K')], ['Edit address', modKey('L')],
      ['Close tab', modKey('W')], ['Reopen closed tab', modKey('⇧T')], ['Next / previous tab', 'Ctrl+Tab / Ctrl+⇧Tab'],
      ['Go to tab 1–9', modKey('1…9')], ['Pin / unpin tab', modKey('D')], ['Toggle AI panel', modKey('E')],
      ['Toggle sidebar', `${modKey('\\')}  or  ${modKey('⇧L')}`], ['Find in page', modKey('F')], ['History', modKey('Y')],
      ['Reload', `${modKey('R')} / F5`], ['Back / forward', `${modKey('[')} / ${modKey(']')}`], ['Zoom', `${modKey('+')} / ${modKey('−')} / ${modKey('0')}`],
      ['Copy page link', modKey('⇧C')], ['New private window', modKey('⇧N')], ['Favorites bar', modKey('⇧B')], ['Settings', modKey(',')], ['Developer tools', 'F12'],
    ];
    return group('Keyboard', ...list.map(([a, b]) => row(a, h('kbd', { class: 'kbd-long' }, b))));
  },

  extensions: extensionsSection,
  usage: usageSection,

  about() {
    const box = h('div', { class: 'about' },
      h('div', { class: 'about-logo', html: icon('sparkles', 34) }),
      h('h3', {}, 'Pulse'),
      h('p', { class: 'muted' }, 'A calm, Chromium-based browser with AI built in.'),
      h('button', { class: 'btn small', style: { marginTop: '6px' }, onclick: () => { modal?.close(); openWelcome(); } }, h('span', { html: icon('sparkles', 12) }), 'Run Setup Again'));
    window.lumen.info().then((i) => box.append(
      h('p', { class: 'muted small' }, `Version ${i.version} · Electron ${i.electron} · Chromium ${i.chrome}`),
      h('p', { class: 'muted small mono' }, i.userData)));
    return box;
  },
};

const PERMISSION_NAMES = {
  geolocation: 'Location', media: 'Camera & microphone', notifications: 'Notifications', 'clipboard-read': 'Clipboard',
  'display-capture': 'Screen sharing', midi: 'MIDI', midiSysex: 'MIDI', hid: 'HID devices', serial: 'Serial ports', usb: 'USB devices',
};

// Per-site decisions remembered from permission prompts, each removable.
function sitePermissions() {
  const wrap = h('section', { class: 'set-group' });
  const draw = async () => {
    const list = PRIVATE ? [] : await window.lumen.permissions.list().catch(() => []);
    const rows = list.sort((a, b) => a.origin.localeCompare(b.origin)).map((d) => h('div', { class: 'set-row' },
      h('div', { class: 'set-label' }, h('span', {}, d.origin.replace(/^https?:\/\//, '') || 'Unknown site'), h('small', {}, PERMISSION_NAMES[d.permission] || d.permission)),
      h('div', { class: 'set-control' },
        h('span', { class: `perm-state ${d.allowed ? 'on' : 'off'}` }, d.allowed ? 'Allowed' : 'Blocked'),
        h('button', { class: 'icon-btn small', title: 'Forget — the site will ask again', html: icon('trash', 13), onclick: async () => { await window.lumen.permissions.remove(d.key); draw(); } }))));
    if (!rows.length) rows.push(h('div', { class: 'empty-note' }, 'No site decisions yet.'));
    wrap.replaceChildren(h('h4', {}, 'Decisions for specific sites'), h('div', { class: 'set-card' }, ...rows));
  };
  draw();
  return wrap;
}

const WEB_STORE_URL = 'https://chromewebstore.google.com/';
const USAGE_CHART_DAYS = 14;

const money = (v) => (v > 0 && v < 0.01 ? '< $0.01' : `$${v.toFixed(2)}`);
const tokenCount = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const duration = (ms) => (ms >= 3600e3 ? `${(ms / 3600e3).toFixed(1)} h` : ms >= 60e3 ? `${Math.round(ms / 60e3)} min` : `${Math.round(ms / 1000)} s`);
const runs = (s) => `${s.agent} task${s.agent === 1 ? '' : 's'} · ${s.chat} chat${s.chat === 1 ? '' : 's'}`;

// Daily API-equivalent cost as thin bars; hovering a day shows its numbers.
function usageChart() {
  const days = Usage.byDay(USAGE_CHART_DAYS);
  const max = Math.max(...days.map((d) => d.usd), 0.0001);
  const tip = h('div', { class: 'usage-tip' });
  const label = (d) => new Date(d.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'numeric' });
  const cols = days.map((d, i) => {
    const col = h('div', { class: `usage-col${i === days.length - 1 ? ' today' : ''}`, 'aria-label': `${label(d)}: ${money(d.usd)}, ${runs(d)}` },
      h('div', { class: 'usage-bar', style: { height: d.usd ? `${Math.max(3, Math.round((d.usd / max) * 100))}%` : '0' } }),
      h('small', {}, new Date(d.day).toLocaleDateString(undefined, { weekday: 'narrow' })));
    col.addEventListener('mouseenter', () => {
      tip.replaceChildren(h('b', {}, label(d)), h('span', {}, `${money(d.usd)} · ${runs(d)}`), h('span', {}, `${tokenCount(d.input + d.cacheRead + d.cacheWrite)} in · ${tokenCount(d.output)} out`));
      tip.style.left = `${((i + 0.5) / days.length) * 100}%`;
      tip.classList.add('show');
    });
    col.addEventListener('mouseleave', () => tip.classList.remove('show'));
    return col;
  });
  return h('div', { class: 'usage-chart-wrap' },
    h('div', { class: 'usage-chart-head' }, h('span', {}, `API-equivalent cost per day — last ${USAGE_CHART_DAYS} days`), h('small', {}, `max ${money(max)}`)),
    h('div', { class: 'usage-chart', role: 'img', 'aria-label': `Daily Pulse usage for the last ${USAGE_CHART_DAYS} days` }, ...cols, tip));
}

function usageSection() {
  const wrap = h('div', {});
  let period = 'week';
  const draw = () => {
    const since = Usage.periodStart(period);
    const s = Usage.summary(since);
    const tile = (title, value, sub) => h('div', { class: 'stat-tile' }, h('small', {}, title), h('b', {}, value), sub ? h('span', {}, sub) : null);
    const list = (title, items) => (items.length ? group(title, ...items.map((x) => row(x.name, h('span', { class: 'usage-row-val' }, money(x.usd)), runs(x)))) : null);
    const plan = S.settings.ai.planUsage;
    const used = (w) => (w ? `${Math.round(w.util * 100)}% used` : '—');
    wrap.replaceChildren(
      h('div', { class: 'usage-top' },
        h('p', { class: 'set-note' }, 'Only what Pulse itself uses — chats and agent tasks in this browser. Claude Code in a terminal, claude.ai and other apps are not counted.'),
        segmented([['today', 'Today'], ['week', '7 days'], ['month', '30 days']], period, (v) => { period = v; draw(); })),
      h('div', { class: 'stat-tiles' },
        tile('API-equivalent cost', money(s.usd), 'what these tokens would cost on the Claude API'),
        tile('Agent tasks', String(s.agent), `${s.chat} chat answer${s.chat === 1 ? '' : 's'}`),
        tile('Tokens', tokenCount(s.input + s.cacheRead + s.cacheWrite + s.output), `${tokenCount(s.output)} written · ${tokenCount(s.cacheRead)} from cache`),
        tile('AI working time', duration(s.ms), 'time spent answering')),
      usageChart(),
      list('By website', Usage.breakdown(since, 'site').map((x) => ({ ...x, name: x.name === 'other' ? 'No page' : x.name }))),
      list('By model', Usage.breakdown(since, 'model').map((x) => ({ ...x, name: prettyModel(x.name) || x.name }))),
      group('Whole Claude account (for comparison)',
        row('5-hour limit', h('span', { class: 'usage-row-val' }, used(plan?.fiveHour)), 'Includes everything else you use with your Claude account.'),
        row('Weekly limit', h('span', { class: 'usage-row-val' }, used(plan?.sevenDay)), 'Claude only reports these for the whole account, so Pulse shows its own usage in tokens and cost instead.')),
      h('button', {
        class: 'btn small', onclick: async () => {
          if (!(await confirmDialog({ title: 'Clear usage stats?', message: 'Only Pulse’s own statistics are removed.', confirm: 'Clear', danger: true }))) return;
          Usage.clearUsage();
          draw();
        },
      }, 'Clear Statistics'));
  };
  draw();
  return wrap;
}

function extensionsSection() {
  const wrap = h('div', {});
  const openTab = (url) => { Tabs.open(url, { afterId: S.activeId }); modal?.close(); };
  const extRow = (e, draw) => h('div', { class: 'set-row' },
    h('div', { class: 'set-label' },
      h('span', { class: 'ext-name' },
        h('img', { class: 'ext-row-icon', alt: '', src: `crx://extension-icon/${e.id}/32/2?partition=${encodeURIComponent(Tabs.PARTITION)}` }),
        e.name),
      h('small', {}, `Version ${e.version}${e.description ? ` · ${e.description}` : ''}`)),
    h('div', { class: 'set-control' },
      e.options ? h('button', { class: 'btn small', onclick: () => openTab(e.options) }, 'Options') : null,
      h('button', {
        class: 'icon-btn small', title: 'Remove', html: icon('trash', 13),
        onclick: async () => {
          if (!(await confirmDialog({ title: `Remove “${e.name}”?`, message: 'You can add it again from the Chrome Web Store.', confirm: 'Remove', danger: true }))) return;
          await removeExtension(e.id).catch(() => toast('Couldn’t remove the extension', { iconName: 'warn' }));
          draw();
        },
      })));
  const draw = async () => {
    const list = PRIVATE ? [] : await listExtensions().catch(() => []);
    const rows = list.map((e) => extRow(e, draw));
    if (!rows.length) rows.push(h('div', { class: 'empty-note' }, PRIVATE ? 'Extensions are off in private windows.' : 'No extensions yet. Open the Chrome Web Store and click “Add to Chrome” on any extension.'));
    wrap.replaceChildren(
      h('section', { class: 'set-group' }, h('h4', {}, 'Extensions'), h('div', { class: 'set-card' }, ...rows)),
      PRIVATE ? '' : h('button', { class: 'btn small', onclick: () => openTab(WEB_STORE_URL) }, h('span', { html: icon('plus', 12) }), 'Get Extensions from Chrome Web Store'),
      h('p', { class: 'set-note' }, 'Chrome extensions install straight from the Chrome Web Store. Their buttons appear next to the address bar — click one to open it, right-click for its menu. Most extensions work; ones that need a companion app on your computer or Chrome-only features may not. Extensions don’t run in private windows.'));
  };
  draw();
  return wrap;
}

function connectorsSection(redraw) {
  const servers = S.settings.ai.knownServers || [];
  const statusLabel = { connected: 'Connected', 'needs-auth': 'Sign in at claude.ai', failed: 'Not working', pending: 'Connecting' };
  const rows = [
    row('Use my Claude connectors & MCP servers', toggle(S.settings.ai.connectors !== false, (v) => { setSetting('ai.connectors', v); redraw(); }), 'With Claude Code the agent can also use Gmail, Calendar, Notion, Slack… that you connected in Claude.'),
    row('Run read-only actions without asking', toggle(S.settings.ai.autoAllowRead !== false, (v) => setSetting('ai.autoAllowRead', v)), 'Searching and reading run straight away; sending, creating, editing or deleting always asks first.'),
  ];
  const sorted = [...servers].sort((a, b) => (a.status === 'connected' ? 0 : 1) - (b.status === 'connected' ? 0 : 1) || a.name.localeCompare(b.name));
  for (const sv of sorted) {
    const label = sv.name.replace(/^claude\.ai /, '').replace(/^plugin:[^:]+:/, '');
    rows.push(row(label,
      toggle(serverEnabled(sv.name), (v) => setSetting('ai.serverPrefs', { ...(S.settings.ai.serverPrefs || {}), [sv.name]: v })),
      `${sv.source === 'claudeai' ? 'claude.ai connector' : sv.source === 'plugin' ? 'Claude Code plugin — off by default' : 'MCP server'} · ${statusLabel[sv.status] || sv.status}`));
  }
  const refresh = h('button', { class: 'btn small' }, h('span', { html: icon('reload', 12) }), servers.length ? 'Refresh' : 'Find my connectors');
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    refresh.lastChild.textContent = 'Checking…';
    const res = await window.lumen.agent.connectors();
    if (res?.ok) { rememberServers(res.servers); toast(`${res.servers.filter((x) => x.status === 'connected').length} connected`, { iconName: 'check' }); }
    else toast(res?.error || 'Couldn’t list connectors', { iconName: 'info' });
    redraw();
  });
  const allowed = S.settings.ai.toolAllow || [];
  return h('section', { class: 'set-group' },
    h('h4', {}, 'Connectors'),
    h('div', { class: 'set-card' }, ...rows),
    h('div', { class: 'field-row', style: { marginTop: '8px' } },
      refresh,
      allowed.length ? h('button', { class: 'btn small', onclick: () => { setSetting('ai.toolAllow', []); toast('Always-allowed actions reset', { iconName: 'check' }); redraw(); } }, `Reset ${allowed.length} always-allowed action${allowed.length > 1 ? 's' : ''}`) : ''));
}

function startPage() {
  const wrap = h('section', { class: 'set-group' });
  const draw = () => {
    const mode = S.settings.start?.mode || 'frequent';
    const rows = [row('Show on the start page', segmented([['frequent', 'Frequently visited'], ['custom', 'My shortcuts'], ['none', 'Nothing']], mode, (v) => { setStartMode(v); draw(); }))];
    if (mode === 'custom') {
      for (const s of S.settings.start.shortcuts || []) {
        rows.push(h('div', { class: 'set-row' },
          h('div', { class: 'set-label' }, h('span', {}, s.title || siteName(new URL(s.url).hostname, '')), h('small', {}, s.url)),
          h('div', { class: 'set-control' },
            h('button', { class: 'btn small', onclick: () => editShortcut(s, draw) }, 'Edit'),
            h('button', { class: 'icon-btn small', title: 'Remove', html: icon('trash', 13), onclick: () => { removeShortcut(s); draw(); } }))));
      }
      rows.push(h('div', { class: 'set-row' }, h('button', { class: 'btn small', onclick: () => editShortcut(null, draw) }, h('span', { html: icon('plus', 12) }), 'Add Shortcut')));
    }
    wrap.replaceChildren(h('h4', {}, 'Start page'), h('div', { class: 'set-card' }, ...rows));
  };
  draw();
  return wrap;
}

// "Keep at most N tabs per site, close extras unused for X minutes" rules.
function tabRules() {
  const wrap = h('section', { class: 'set-group' });
  const draw = () => {
    const rules = S.settings.tabs?.rules || [];
    const save = () => setSetting('tabs.rules', rules.map((r) => ({ ...r })));
    const list = h('div', { class: 'set-card' });
    if (!rules.length) list.append(h('div', { class: 'empty-note' }, 'No rules. Add one to keep the number of tabs from one site in check.'));
    for (const r of rules) {
      const site = h('input', { class: 'input small rule-site', placeholder: 'Any site', value: r.site || '', spellcheck: 'false' });
      site.addEventListener('change', () => { r.site = site.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); save(); });
      const max = h('input', { class: 'input small rule-num', type: 'number', min: 1, max: 50, value: r.max });
      max.addEventListener('change', () => { r.max = Math.max(1, Math.min(50, +max.value || 5)); save(); });
      const idle = select([[2, '2 min'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '1 hour'], [240, '4 hours']], r.idle, (v) => { r.idle = +v; save(); });
      list.append(h('div', { class: 'set-row rule-row' },
        toggle(r.enabled, (v) => { r.enabled = v; save(); }),
        h('div', { class: 'rule-text' },
          h('span', {}, 'On'), site, h('span', {}, 'keep at most'), max, h('span', {}, 'tabs per site; close extras unused for'), idle),
        h('button', { class: 'icon-btn small', title: 'Delete rule', html: icon('trash', 13), onclick: () => { rules.splice(rules.indexOf(r), 1); save(); draw(); } })));
    }
    wrap.replaceChildren(
      h('h4', {}, 'Keep tabs tidy automatically'),
      h('p', { class: 'set-note' }, 'When you have more tabs from one site than the limit, Pulse closes the ones you used least recently once they’ve sat unused for the set time. Pinned tabs, the tab you’re on and tabs playing audio are never closed; everything can be undone or reopened from Archived Tabs.'),
      list,
      h('button', { class: 'btn small rule-add', onclick: () => { rules.push({ id: Math.random().toString(36).slice(2, 9), site: '', max: 5, idle: 10, enabled: true }); save(); draw(); } }, h('span', { html: icon('plus', 12) }), 'Add Rule'));
  };
  draw();
  return wrap;
}

function providerCard(p, redraw) {
  const st = statusOf(p);
  const card = h('div', { class: `provider-card${S.settings.ai.provider === p.id ? ' current' : ''}` });
  const head = h('div', { class: 'pc-head' },
    h('span', { html: logo(p.logo, 28) }),
    h('div', { class: 'pc-text' }, h('b', {}, p.kind === 'cli' ? p.via : p.name), h('small', { title: p.sub }, p.sub)),
    h('span', { class: `status ${st.cls}` }, st.label));
  card.append(head);
  const actions = h('div', { class: 'pc-actions' });

  if (p.kind === 'api') {
    if (!p.noKey) {
      const input = h('input', { class: 'input small', type: 'password', placeholder: S.secrets[p.id] ? '••••••••  saved' : 'API key', spellcheck: 'false', autocomplete: 'off' });
      const save = h('button', { class: 'btn small primary' }, 'Save');
      save.addEventListener('click', async () => {
        if (!input.value.trim()) return;
        await window.lumen.secrets.set(p.id, input.value.trim());
        await refreshStatus();
        toast(`${p.name} key saved`, { iconName: 'check' });
        redraw();
      });
      actions.append(input, save);
      if (S.secrets[p.id]) {
        actions.append(h('button', { class: 'btn small', onclick: async () => { await window.lumen.secrets.set(p.id, null); await refreshStatus(); redraw(); } }, 'Remove'));
      }
      if (p.keyUrl) actions.append(h('button', { class: 'link-btn', onclick: () => Tabs.open(p.keyUrl) }, 'Get key ', h('span', { html: icon('external', 11) })));
    }
    if (p.noKey || p.id === 'openai' || p.id === 'openrouter') {
      const base = h('input', { class: 'input small', placeholder: p.baseUrl, value: S.settings.ai.baseUrls?.[p.id] || '', spellcheck: 'false' });
      base.addEventListener('change', () => setSetting(`ai.baseUrls.${p.id}`, base.value.trim() || undefined));
      card.append(h('div', { class: 'pc-row' }, h('small', {}, 'Base URL'), base));
    }
    const modelSel = h('input', { class: 'input small', value: modelFor(p), list: `models-${p.id}`, spellcheck: 'false' });
    const dl = h('datalist', { id: `models-${p.id}` }, ...[...new Set([...(p.models || []), ...(modelCache[p.id] || [])])].map((m) => h('option', { value: m }, prettyModel(m))));
    modelSel.addEventListener('change', () => setSetting(`ai.models.${p.id}`, modelSel.value.trim() || undefined));
    const refresh = h('button', { class: 'icon-btn small', title: 'Load models', html: icon('reload', 13) });
    refresh.addEventListener('click', async () => {
      const res = await loadModels(p, true);
      if (res.ok) redraw();
    });
    card.append(h('div', { class: 'pc-row' }, h('small', {}, 'Model'), modelSel, dl, refresh));
  } else if (p.kind === 'cli') {
    if (S.clis[p.id]) {
      actions.append(h('small', { class: 'mono muted' }, S.clis[p.id]));
      actions.append(h('div', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => cliLogin(p) }, h('span', { html: icon('key', 12) }), 'Sign in'));
      if (p.models) {
        card.append(h('div', { class: 'pc-row' }, h('small', {}, 'Model'),
          select(p.models.map((m) => [m, prettyModel(m)]), modelFor(p), (v) => setSetting(`ai.models.${p.id}`, v))));
      }
    } else {
      actions.append(
        h('code', { class: 'install-cmd' }, p.installCmd),
        h('button', { class: 'icon-btn small', title: 'Copy', html: icon('copy', 12), onclick: () => { navigator.clipboard.writeText(p.installCmd); toast('Copied', { iconName: 'check', timeout: 1200 }); } }),
        h('button', { class: 'btn small', onclick: async () => { await refreshStatus(); redraw(); } }, 'Check again'));
    }
  } else {
    actions.append(h('button', { class: 'btn small', onclick: () => { modal?.close(); selectProvider(p.id); window.dispatchEvent(new CustomEvent('lumen:ai', { detail: true })); } }, 'Open in panel'));
  }
  card.append(actions);
  if (S.settings.ai.provider !== p.id) {
    head.append(h('button', { class: 'btn small', onclick: () => { selectProvider(p.id); redraw(); } }, 'Use'));
  }
  return card;
}
