// First-run setup: a short Apple-style walkthrough of the choices that matter most —
// which AI to use, what the agent may do, privacy, tab housekeeping and the look.
import { S, setSetting, ACCENTS } from './state.js';
import { h } from './util.js';
import { icon, logo } from './icons.js';
import { openModal, toggle, segmented, select } from './ui.js';
import { PROVIDERS, statusOf } from './providers.js';
import { selectProvider } from './ai.js';
import { setStartMode } from './start.js';
import * as Tabs from './tabs.js';

const SETUP_VERSION = 1;
const WEB_STORE_URL = 'https://chromewebstore.google.com/';
const mod = window.lumen.platform === 'darwin' ? '⌘' : 'Ctrl+';

export const needsSetup = () => (S.settings.onboarded || 0) < SETUP_VERSION;

// One line of the walkthrough: icon, title, explanation and its control.
const line = (iconName, title, help, control) => h('div', { class: 'wl-row' },
  h('span', { class: 'wl-row-icon', html: icon(iconName, 17) }),
  h('div', { class: 'wl-row-text' }, h('b', {}, title), help ? h('small', {}, help) : null),
  control ? h('div', { class: 'wl-row-control' }, control) : null);

const heading = (iconName, title, sub) => h('div', { class: 'wl-head' },
  h('div', { class: 'wl-glyph', html: icon(iconName, 26) }), h('h2', {}, title), sub ? h('p', {}, sub) : null);

function welcomeStep() {
  const feature = (iconName, title, text) => h('div', { class: 'wl-feature' },
    h('span', { html: icon(iconName, 18) }), h('div', {}, h('b', {}, title), h('small', {}, text)));
  return h('div', { class: 'wl-step wl-hello' },
    h('div', { class: 'wl-logo', html: icon('sparkles', 40) }),
    h('h1', {}, 'Welcome to Pulse'),
    h('p', { class: 'wl-lead' }, 'A fast browser with an AI that does the work for you. Let’s set it up — it takes a minute.'),
    h('div', { class: 'wl-features' },
      feature('agent', 'An agent that uses the web', 'It clicks, types and fills forms in your tabs while you watch.'),
      feature('splitGrid', 'Split view', 'Two or four pages side by side.'),
      feature('puzzle', 'Chrome extensions', 'Straight from the Chrome Web Store.'),
      feature('shield', 'Quiet & private', 'Cookie banners answered for you.')));
}

function aiStep(redraw) {
  const cards = PROVIDERS.filter((p) => p.kind === 'cli' || p.id === 'anthropic').map((p) => {
    const st = statusOf(p);
    const ready = st.cls === 'ok';
    const on = S.settings.ai.provider === p.id;
    return h('button', {
      class: `wl-ai${on ? ' on' : ''}${ready ? '' : ' off'}`,
      title: ready ? `Use ${p.name}` : `${st.label} — set it up later in Settings → AI`,
      onclick: () => { if (ready) { selectProvider(p.id); redraw(); } },
    },
    h('span', { class: 'wl-ai-logo', html: logo(p.logo, 26) }),
    h('span', { class: 'wl-ai-text' }, h('b', {}, p.name), h('small', {}, p.via || p.sub)),
    h('span', { class: `wl-ai-state ${st.cls}` }, on ? 'Selected' : st.label));
  });
  const anyReady = PROVIDERS.some((p) => (p.kind === 'cli' || p.id === 'anthropic') && statusOf(p).cls === 'ok');
  return h('div', { class: 'wl-step' },
    heading('sparkles', 'Which AI should work for you?', 'Your existing subscription works — Pulse uses the app you’re already signed in to. No extra API key needed.'),
    h('div', { class: 'wl-ais' }, ...cards),
    anyReady ? null : h('p', { class: 'wl-note' }, 'Nothing installed yet. Install Claude Code (claude.ai/install) or add an API key later in Settings → AI.'),
    h('div', { class: 'wl-card' },
      line('agent', 'Start in Agent mode', 'The AI acts in your tabs when you ask it to do something; questions get a direct answer.',
        segmented([['agent', 'Agent'], ['chat', 'Ask only']], S.settings.ai.mode || 'agent', (v) => { setSetting('ai.mode', v); setSetting('ai.modeChosen', true); }))));
}

function agentStep(redraw) {
  const ai = S.settings.ai;
  return h('div', { class: 'wl-step' },
    heading('agent', 'What may the agent do?', 'You can change any of this later in Settings → AI.'),
    h('div', { class: 'wl-card' },
      line('terminal', 'Work on this computer', 'Run commands and edit files in a folder, like Claude Code. Reading is automatic; changes ask first.',
        toggle(ai.computer !== false, (v) => { setSetting('ai.computer', v); redraw(); })),
      ai.computer !== false ? line('folder', 'Working folder', null,
        h('button', { class: 'btn small', onclick: async () => { const d = await window.lumen.pickFolder(ai.workdir); if (d) { setSetting('ai.workdir', d); redraw(); } } },
          (ai.workdir || '~').replace(/^\/home\/[^/]+/, '~'))) : null,
      line('bolt', 'Use my Claude connectors', 'Gmail, Calendar, Notion, Slack… connected in Claude. Sending or changing anything asks first.',
        toggle(ai.connectors !== false, (v) => setSetting('ai.connectors', v))),
      line('warn', 'Ask before paying, sending or deleting', 'Skipped when you asked for exactly that (“pošli to”).',
        toggle(ai.agentConfirm !== false, (v) => setSetting('ai.agentConfirm', v))),
      line('cursor', 'Speed', 'How much the agent thinks before each step.',
        segmented([['low', 'Fastest'], ['medium', 'Balanced'], ['high', 'Thorough']], ai.agentEffort || 'low', (v) => setSetting('ai.agentEffort', v)))));
}

function privacyStep() {
  const P = S.settings.privacy;
  const ask = (key) => select([['ask', 'Ask'], ['allow', 'Allow'], ['block', 'Block']], P.permissions[key] || 'ask', (v) => setSetting(`privacy.permissions.${key}`, v));
  return h('div', { class: 'wl-step' },
    heading('shield', 'Privacy, without the pop-ups', 'Pulse can answer the annoying questions for you.'),
    h('div', { class: 'wl-card' },
      line('check', 'Cookie banners', 'Smart rejects optional cookies and accepts only where a site leaves no other choice. Works for the agent too.',
        segmented([['smart', 'Smart'], ['reject', 'Reject'], ['accept', 'Accept'], ['off', 'Off']], P.cookies || 'smart', (v) => setSetting('privacy.cookies', v))),
      line('globe', 'Sites asking for your location', null, ask('location')),
      line('info', 'Sites asking to send notifications', null, ask('notifications')),
      line('camera', 'Camera & microphone', null, ask('media'))));
}

function tabsStep(redraw) {
  const t = S.settings.tabs;
  const rule = (t.rules || []).find((r) => r.id === 'default');
  return h('div', { class: 'wl-step' },
    heading('layers', 'Tabs that tidy themselves', 'Everything closed can be reopened from History → Archived Tabs.'),
    h('div', { class: 'wl-card' },
      line('eye', 'Put unused tabs to sleep', 'After 45 minutes — frees memory, the tab stays in the sidebar.',
        toggle(t.sleepAfter > 0, (v) => setSetting('tabs.sleepAfter', v ? 45 : 0))),
      line('history', 'Archive tabs you haven’t opened for a day', 'Pinned tabs are never archived.',
        toggle(t.archiveAfter > 0, (v) => setSetting('tabs.archiveAfter', v ? 24 : 0))),
      rule ? line('window', 'At most 5 tabs per site', 'Older extras close after 10 minutes unused.',
        toggle(rule.enabled, (v) => { setSetting('tabs.rules', t.rules.map((r) => (r.id === 'default' ? { ...r, enabled: v } : r))); redraw(); })) : null,
      line('pin', 'Favorites bar', 'Pinned pages one click away under the address bar.',
        toggle(S.settings.favbar !== false, (v) => setSetting('favbar', v))),
      line('search', 'New tab shows', null,
        segmented([['frequent', 'Frequent'], ['custom', 'Shortcuts'], ['none', 'Nothing']], S.settings.start?.mode || 'frequent', (v) => setStartMode(v)))));
}

function lookStep(redraw) {
  const swatches = h('div', { class: 'swatches' }, ...Object.entries(ACCENTS).map(([k, hex]) => h('button', {
    class: `swatch${S.settings.accent === k ? ' on' : ''}`, style: { background: hex }, title: k,
    onclick: () => { setSetting('accent', k); document.documentElement.dataset.accent = k; redraw(); },
  })));
  return h('div', { class: 'wl-step' },
    heading('palette', 'Make it yours'),
    h('div', { class: 'wl-card' },
      line('sun', 'Appearance', null,
        segmented([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], S.settings.theme || 'system', (v) => { setSetting('theme', v); window.lumen.setTheme(v); })),
      line('palette', 'Accent color', null, swatches)));
}

function doneStep(finish) {
  const tip = (keys, text) => h('div', { class: 'wl-tip' }, h('kbd', {}, keys), h('span', {}, text));
  return h('div', { class: 'wl-step wl-done' },
    h('div', { class: 'wl-logo done', html: icon('check', 40) }),
    h('h1', {}, 'You’re all set'),
    h('p', { class: 'wl-lead' }, 'A few things worth knowing:'),
    h('div', { class: 'wl-tips' },
      tip(`${mod}E`, 'Open the AI — ask anything or tell it what to do'),
      tip('Right-click', '“Ask AI About This” sends the exact spot on the page'),
      tip(`${mod}T`, 'Command bar: open, search, switch tabs, run actions'),
      tip(h('span', { class: 'wl-kbd-icon', html: icon('splitCols', 14) }), 'The layout button next to the address bar splits the window')),
    h('button', { class: 'btn small wl-store', onclick: () => { finish(); Tabs.open(WEB_STORE_URL, { afterId: S.activeId }); } },
      h('span', { html: icon('puzzle', 13) }), 'Add Chrome extensions'));
}

let current = null;

export function openWelcome() {
  if (current) return;
  let step = 0;
  const pane = h('div', { class: 'wl-pane' });
  const dots = h('div', { class: 'wl-dots' });
  const back = h('button', { class: 'btn wl-back' }, 'Back');
  const next = h('button', { class: 'btn primary wl-next' });
  const skip = h('button', { class: 'btn wl-skip' }, 'Skip setup');
  const finish = () => { setSetting('onboarded', SETUP_VERSION); current?.close(); };
  const steps = [welcomeStep, aiStep, agentStep, privacyStep, tabsStep, lookStep, () => doneStep(finish)];

  const draw = (dir = 0) => {
    const body = steps[step](() => draw());
    if (dir) body.classList.add(dir > 0 ? 'from-right' : 'from-left');
    pane.replaceChildren(body);
    dots.replaceChildren(...steps.map((_, i) => h('i', { class: i === step ? 'on' : i < step ? 'done' : '' })));
    back.style.display = step > 0 && step < steps.length - 1 ? '' : 'none';
    skip.style.display = step === 0 ? '' : 'none';
    next.textContent = step === 0 ? 'Get Started' : step === steps.length - 1 ? 'Start Browsing' : 'Continue';
  };
  back.addEventListener('click', () => { if (step > 0) { step--; draw(-1); } });
  next.addEventListener('click', () => { if (step < steps.length - 1) { step++; draw(1); } else finish(); });
  skip.addEventListener('click', finish);

  current = openModal({
    width: 640,
    className: 'welcome',
    body: pane,
    footer: h('div', { class: 'wl-foot' }, dots, h('div', { class: 'grow' }), skip, back, next),
    // Closing it any other way counts as done too, so it never nags on every start.
    onClose: () => { setSetting('onboarded', SETUP_VERSION); current = null; },
  });
  draw();
}
