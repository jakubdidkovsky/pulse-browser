'use strict';
// Cookie banners: DuckDuckGo's Autoconsent (rules for hundreds of consent popups plus a heuristic
// fallback) runs in every page and answers the banner for the user — the agent's pages included.
const fs = require('node:fs');
const path = require('node:path');
const { webFrameMain } = require('electron');

const BUNDLE = path.join(__dirname, '..', 'node_modules', '@duckduckgo', 'autoconsent', 'dist', 'autoconsent.standalone.js');
// smart: reject optional cookies; where a site only offers "accept" (e.g. consent-or-pay walls), accept.
const ACTIONS = { smart: 'optOut', reject: 'optOut', accept: 'optIn' };
const FALLBACK_POLL_MS = 500;
const FALLBACK_POLLS = 30;
// Consent popups that live in their own iframe (Sourcepoint, TrustArc, consentmanager…).
const CMP_FRAME = /consent|cmp|privacy|cookie|gdpr|sp-prod|sourcepoint|trustarc|didomi|usercentrics/i;

let bundle = null;

// The standalone build configures itself; make its action configurable and its logging quiet.
function loadBundle() {
  if (bundle !== null) return bundle;
  try {
    const src = fs.readFileSync(BUNDLE, 'utf8');
    const patched = src
      .replace('isMainWorld: true,', 'isMainWorld: true, autoAction: globalThis.__pulseCookieAction || "optOut",')
      .replace(/logs: \{\s*lifecycle: true,\s*rulesteps: true,[^}]*\}/, 'logs: { lifecycle: false, rulesteps: false, detectionsteps: false, evals: false, errors: false, messages: false, waits: false }')
      .replace('logMessage(message);', '')
      .replace('console.log("autoconsent standalone initialized"', 'void ("autoconsent standalone initialized"');
    bundle = patched.includes('__pulseCookieAction') ? patched : '';
    if (!bundle) console.warn('Cookie banners: the Autoconsent bundle changed shape; automation is off.');
  } catch (err) {
    console.warn('Cookie banners unavailable:', err.message);
    bundle = '';
  }
  return bundle;
}

// Smart mode: if rejecting wasn't possible on a detected banner, accept it instead.
const ACCEPT_IF_REJECT_FAILED = `(() => {
  const st = window.autoconsentStandalone;
  if (!st) return;
  let polls = 0;
  const timer = setInterval(() => {
    const failed = st.messages.find((m) => m.type === 'optOutResult' && !m.result && m.cmp !== 'none');
    const settled = st.messages.some((m) => m.type === 'autoconsentDone' || (m.type === 'optOutResult' && m.result));
    if (failed) { clearInterval(timer); st.instance.doOptIn().catch(() => {}); }
    else if (settled || ++polls > ${FALLBACK_POLLS}) clearInterval(timer);
  }, ${FALLBACK_POLL_MS});
})();`;

// Banners Autoconsent has no rule for (e.g. "Rozumím / Podrobné nastavení"): find the cookie
// box by its text and press the matching button, or hide it. Headers and menus are never touched.
const GENERIC_FALLBACK = String.raw`((mode) => {
  if (window.__pulseCookieFallback) return;
  window.__pulseCookieFallback = true;
  const WORDS = /cookie|souhlas|consent|gdpr|súhlas|zgod|einwillig/i;
  const REJECT = /^(odmítnout( vše| všechny| volitelné)?|nesouhlasím|(pouze|jen) (nezbytné|nutné)( cookies)?|reject( all)?( cookies)?|decline( all)?|deny|refuse( all)?|(use )?(only )?(necessary|essential|required)( cookies)?( only)?|alle ablehnen|ablehnen|nur (notwendige|erforderliche)( cookies)?|odmietnuť( všetko)?|odrzuć( wszystkie)?)$/i;
  const ACCEPT = /^(přijmout( vše| všechny)?( cookies)?|souhlasím( a pokračovat)?|rozumím|povolit( vše| všechny)?|ok|accept( all)?( cookies)?|agree|i agree|allow( all)?( cookies)?|got it|alle akzeptieren|akzeptieren|zustimmen|prijať( všetko)?|súhlasím|zgadzam się|akceptuj(ę)?( wszystkie)?)$/i;
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const label = (b) => (b.innerText || b.value || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  const isChrome = (e) => /^(HEADER|NAV|FOOTER)$/.test(e.tagName) || /banner|navigation|contentinfo/.test(e.getAttribute('role') || '') || !!e.querySelector('nav');
  const banners = () => {
    const found = [];
    for (const e of document.querySelectorAll('body *')) {
      const dialog = e.getAttribute('role') === 'dialog' || e.getAttribute('aria-modal') === 'true';
      if (!dialog && e.offsetParent !== null && getComputedStyle(e).position !== 'sticky') continue;
      if (!dialog && !/fixed|sticky/.test(getComputedStyle(e).position)) continue;
      if (!visible(e) || isChrome(e)) continue;
      const text = e.innerText || '';
      if (text.length >= 60 && text.length < 4000 && WORDS.test(text)) found.push(e);
    }
    return found.filter((e) => !found.some((o) => o !== e && o.contains(e)));
  };
  const settled = () => {
    const st = window.autoconsentStandalone;
    return !!st && st.messages.some((m) => m.type === 'autoconsentDone' || ((m.type === 'optOutResult' || m.type === 'optInResult') && m.result));
  };
  const handle = () => {
    if (settled()) return true;
    const list = banners();
    if (!list.length) return false;
    for (const box of list) {
      const buttons = [...box.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]')].filter(visible);
      const find = (re) => buttons.find((b) => { const t = label(b); return t.length <= 40 && re.test(t); });
      const pick = mode === 'accept' ? find(ACCEPT) : find(REJECT) || (mode === 'smart' ? find(ACCEPT) : null);
      if (pick) pick.click();
      else box.style.setProperty('display', 'none', 'important');
    }
    for (const el of [document.documentElement, document.body]) {
      if (el && getComputedStyle(el).overflow === 'hidden') el.style.setProperty('overflow', 'auto', 'important');
    }
    return true;
  };
  let tries = 0;
  const tick = () => { if (handle() || ++tries >= 4) return; setTimeout(tick, 2500); };
  setTimeout(tick, 2500);
})`;

function scriptFor(mode, mainFrame) {
  const action = ACTIONS[mode];
  const code = action ? loadBundle() : '';
  if (!code) return '';
  return [
    `window.__pulseCookieAction = ${JSON.stringify(action)};`,
    code,
    mode === 'smart' ? ACCEPT_IF_REJECT_FAILED : '',
    mainFrame ? `${GENERIC_FALLBACK}(${JSON.stringify(mode)});` : '',
  ].join('\n');
}

function run(frame, getMode, mainFrame = false) {
  if (!frame || frame.isDestroyed?.()) return;
  const code = scriptFor(getMode(), mainFrame);
  if (code) frame.executeJavaScript(code).catch(() => {});
}

function attach(contents, getMode) {
  contents.on('dom-ready', () => run(contents.mainFrame, getMode, true));
  contents.on('did-frame-finish-load', (_e, isMainFrame, processId, routingId) => {
    if (isMainFrame) return;
    const frame = webFrameMain.fromId(processId, routingId);
    if (frame && CMP_FRAME.test(frame.url)) run(frame, getMode);
  });
}

module.exports = { attach };
