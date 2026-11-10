// Settings → Remote: turn the phone remote on, pair a phone with a QR code, see and remove paired phones.
import { S, setSetting, PRIVATE } from './state.js';
import { h, timeAgo } from './util.js';
import { icon } from './icons.js';
import { toggle, segmented, toast, confirmDialog } from './ui.js';

const TAILSCALE_DOWNLOAD = 'https://tailscale.com/download';

const row = (label, control, help) => h('div', { class: 'set-row' },
  h('div', { class: 'set-label' }, h('span', {}, label), help ? h('small', {}, help) : null),
  h('div', { class: 'set-control' }, control));
const group = (title, ...rows) => h('section', { class: 'set-group' }, title ? h('h4', {}, title) : null, h('div', { class: 'set-card' }, ...rows));
const note = (text) => h('p', { class: 'set-note' }, text);

function switches() {
  const r = S.settings.remote || {};
  return group('Phone remote',
    row('Control Pulse from your phone', toggle(!!r.enabled, (v) => setSetting('remote.enabled', v)),
      'Give the agent tasks, approve its steps, switch tabs and tap around the page from your phone.'),
    row('Also allow on local Wi-Fi', toggle(!!r.lan, (v) => setSetting('remote.lan', v)),
      'Without this, only devices in your Tailscale network can connect. Traffic on local Wi-Fi isn’t encrypted.'),
    row('Keep this computer awake', toggle(!!r.awake, (v) => setSetting('remote.awake', v)),
      'Stops the computer from going to sleep while the remote is on, so your phone can always reach it.'));
}

let pickedVia = null; // 'tailscale' | 'wifi', when both are offered

// Without a phone in the tailnet the link can't open on the phone (it just keeps loading), so say so up front.
function tailscaleWarning(ts) {
  if (!ts || ts.phones == null) return null;
  const account = ts.login ? ` as ${ts.login}` : ' with the same account as this computer';
  if (!ts.phones) return `No phone is in your Tailscale network yet. Sign in to the Tailscale app on your phone${account} and turn it on. Phone signed in with another account? Share this computer with that account: Machines, then ${ts.name?.split('.')[0] || 'this computer'}, then Share. Then scan the code.`;
  if (!ts.phonesOnline) return 'Your phone is in Tailscale but not connected. Open the Tailscale app on the phone and turn it on.';
  return null;
}

const TAILSCALE_MACHINES = 'https://login.tailscale.com/admin/machines';
const LAN_ADDRESS = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

// Whether anything reached Pulse: a phone stuck on a blank or loading page usually never got here at all.
function contactNote(st) {
  const { lastContact: c, lastRefused: r } = st;
  if (r && (!c || r.at > c.at)) {
    const hint = LAN_ADDRESS.test(r.address) ? ' Devices on your Wi-Fi need “Also allow on local Wi-Fi”.' : '';
    return `Pulse refused a connection from ${r.address} ${timeAgo(r.at)}.${hint}`;
  }
  if (c) return `Last heard from ${c.address} ${timeAgo(c.at)}.`;
  return 'No device has reached Pulse yet. If the link only keeps loading on the phone, the phone can’t reach this computer.';
}

function pairing(st, refresh) {
  if (st.error) return group('Pair a phone', h('div', { class: 'empty-note' }, st.error));
  if (!st.running) return group('Pair a phone', h('div', { class: 'empty-note' }, 'Starting…'));
  if (!st.links.length) {
    return h('section', { class: 'set-group' }, h('h4', {}, 'Pair a phone'),
      h('div', { class: 'set-card remote-empty' },
        h('p', {}, 'Tailscale isn’t running on this computer. Install it here and on your phone, sign in with the same account on both, then come back.'),
        h('button', { class: 'btn small', onclick: () => window.lumen.openExternal(TAILSCALE_DOWNLOAD) }, h('span', { html: icon('external', 13) }), 'Get Tailscale')),
      note('Or turn on “Also allow on local Wi-Fi” to pair a phone on the same network.'));
  }
  const vias = st.links.map((l) => l.via);
  // Same Wi-Fi first when no phone is in the tailnet yet: that one works right away.
  const preferred = vias.includes('wifi') && st.tailscale && !st.tailscale.phonesOnline ? 'wifi' : vias[0];
  const via = vias.includes(pickedVia) ? pickedVia : preferred;
  const link = st.links.find((l) => l.via === via);
  const warning = via === 'tailscale' ? tailscaleWarning(st.tailscale) : null;
  const steps = [
    via === 'tailscale' ? 'Turn on Tailscale on your phone (same account as this computer).' : 'Connect your phone to the same Wi-Fi as this computer.',
    'Scan this code with the phone’s camera and open the link.',
    'Add the page to your home screen to open it like an app.',
  ];
  const minutes = Math.max(1, Math.round((st.pairExpires - Date.now()) / 60000));
  return h('section', { class: 'set-group' }, h('h4', {}, 'Pair a phone'),
    vias.length > 1 ? h('div', { class: 'remote-via' }, segmented([['tailscale', 'Tailscale'], ['wifi', 'Same Wi-Fi']], via, (v) => { pickedVia = v; refresh(); })) : null,
    warning ? h('div', { class: 'remote-warn' }, h('span', { html: icon('warn', 14) }), h('span', {}, warning),
      st.tailscale.phones ? null : h('div', { class: 'remote-warn-actions' },
        h('button', { class: 'btn small', onclick: () => window.lumen.openExternal(TAILSCALE_MACHINES) }, 'Share This Computer'),
        h('button', { class: 'btn small', onclick: () => window.lumen.openExternal(TAILSCALE_DOWNLOAD) }, 'Get Tailscale'))) : null,
    h('div', { class: 'set-card remote-pair' },
      h('img', { class: 'remote-qr', src: link.qr, alt: 'Pairing code', width: 168, height: 168 }),
      h('div', { class: 'remote-steps' },
        h('ol', {}, ...steps.map((s) => h('li', {}, s))),
        h('small', {}, `The code works once and expires in ${minutes} min. Anyone who opens it can control this browser, so don’t share it.`),
        h('div', { class: 'remote-actions' },
          h('button', { class: 'btn small', onclick: () => { navigator.clipboard.writeText(link.pairLink); toast('Pairing link copied', { iconName: 'link', timeout: 1600 }); } }, h('span', { html: icon('link', 13) }), 'Copy Link'),
          h('button', { class: 'btn small', onclick: async () => { await window.lumen.remote.newCode(); refresh(); } }, h('span', { html: icon('reload', 13) }), 'New Code')))),
    note(`Address: ${link.url}`),
    note(contactNote(st)));
}

function devices(st, refresh) {
  const rows = st.devices.map((d) => row(d.name,
    h('button', { class: 'icon-btn small', title: 'Remove. This phone will need a new pairing code.', html: icon('trash', 13), onclick: async () => { await window.lumen.remote.forget(d.id); refresh(); } }),
    d.online ? 'Connected now' : `Paired ${timeAgo(d.created)} · last used ${timeAgo(d.lastSeen)}`));
  if (!rows.length) return group('Paired phones', h('div', { class: 'empty-note' }, 'No phones yet.'));
  const removeAll = async () => {
    const yes = await confirmDialog({ title: 'Remove all phones?', message: 'Every paired phone loses access right away and will need a new pairing code.', confirm: 'Remove All', danger: true });
    if (yes) { await window.lumen.remote.forgetAll(); refresh(); }
  };
  return h('div', {}, group('Paired phones', ...rows),
    h('button', { class: 'btn small danger-text', onclick: removeAll }, 'Remove All Phones'));
}

export function remoteSection() {
  const wrap = h('div', {});
  if (PRIVATE) {
    wrap.append(h('div', { class: 'empty-note' }, 'Open Settings in a regular window to set up the phone remote.'));
    return wrap;
  }
  const refresh = async () => {
    const st = await window.lumen.remote.status().catch(() => null);
    const parts = [switches()];
    if (st && S.settings.remote?.enabled) parts.push(pairing(st, refresh), devices(st, refresh));
    wrap.replaceChildren(...parts);
  };
  // Pulse reports pairings, connections and setting changes; stop listening once Settings shows another page.
  const stop = window.lumen.remote.onChanged(() => (wrap.isConnected ? refresh() : stop()));
  wrap.append(switches());
  refresh();
  return wrap;
}
