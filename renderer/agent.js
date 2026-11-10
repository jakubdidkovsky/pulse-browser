// Browser agent driver: runs the AI's tool calls in the controlled tab with a visible cursor.
import { S, changed, GROUP_COLORS, PRIVATE, setSetting, askBefore } from './state.js';
import { h, $, hostOf, isStart, uid } from './util.js';
import { icon } from './icons.js';
import * as Tabs from './tabs.js';
import * as Split from './split.js';
import * as Lens from './lens.js';
import { searchHistory, formatPages } from './recall.js';
import { normId } from './readable.js';
import * as Board from './board-model.js';
import { snapshotBoard, showBoard, loadImage } from './board-view.js';

const runs = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MEMORY_PATH = /\/Pulse\/(MEMORY\.md|sites\/[^/]+\/CONTEXT\.md)$|(^|\/)CLAUDE(\.local)?\.md$|\/\.claude\/projects\/[^/]+\/memory\/[^/]+\.md$/;
// Clicks that can't be undone, grouped with the words a user would use to ask for them: a click
// only waits for an OK when the user's own instructions for this task didn't ask for it.
const RISK_GROUPS = [
  { kind: 'send', label: /\b(send|post|publish|odeslat|poslat|publikovat)\b/i, said: /\b(send|post|publish|submit|po[sš]li|po[sš]lete|poslat|ode[sš]li|ode[sš]lete|odeslat|publikuj|zve[rř]ejni)\w*/i },
  { kind: 'pay', label: /\b(pay|buy|purchase|checkout|place order|order now|confirm (order|purchase|payment)|zaplatit|koupit|objednat)\b/i, said: /\b(pay|buy|purchase|order|checkout|zapla[tť]|kup|koupit|objednej|objednat)\w*/i },
  { kind: 'delete', label: /\b(delete|remove|smazat|odstranit)\b/i, said: /\b(delete|remove|sma[zž]|odstra[nň]|vyma[zž])\w*/i },
  { kind: 'send', label: /\bsubscribe\b/i, said: /\b(subscribe|odeb[ií]r|p[rř]ihla[sš])\w*/i },
  { kind: 'pay', label: /\b(transfer|withdraw|převést)\b/i, said: /\b(transfer|withdraw|p[rř]eve[dď]|p[rř]ev[eé]st)\w*/i },
  { kind: 'change', label: /\bpotvrdit\b/i, said: /\b(confirm|potvr[dď])\w*/i },
];
// Shell commands that only look at things run without asking: every part of the pipeline is a
// known read-only program, with no redirects into files, substitutions or "run something" flags.
const READ_ONLY_PROGRAMS = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'fd', 'wc', 'file', 'stat',
  'du', 'df', 'pwd', 'echo', 'printf', 'which', 'whereis', 'type', 'date', 'uname', 'whoami', 'id', 'hostname', 'tree', 'jq',
  'sort', 'uniq', 'cut', 'tr', 'column', 'diff', 'cmp', 'md5sum', 'sha256sum', 'basename', 'dirname', 'realpath', 'readlink',
  'printenv', 'ps', 'free', 'uptime', 'lsblk', 'lscpu', 'nproc', 'cd', 'true']);
const READ_ONLY_GIT = new Set(['status', 'log', 'diff', 'show', 'ls-files', 'rev-parse', 'blame', 'describe']);
const WRITING_FLAGS = /(^|\s)(-exec|-execdir|-ok|-okdir|-delete|-fprint\S*|-fls|-o|--output\S*)(\s|=|$)/;

function readOnlyCommand(command) {
  const cmd = String(command || '').replace(/\s\d?>\s*\/dev\/null/g, ' ').replace(/\s2>&1/g, ' ');
  if (!cmd.trim() || /[<>`]|\$\(|\|&|(^|[^&])&($|[^&])/.test(cmd)) return false;
  return cmd.split(/&&|\|\||;|\|/).every((part) => {
    const words = part.trim().split(/\s+/);
    const prog = (words[0] || '').split('/').pop();
    if (prog === 'git') return READ_ONLY_GIT.has(words[1]);
    return READ_ONLY_PROGRAMS.has(prog) && !WRITING_FLAGS.test(part);
  });
}

// Ticking a box or picking an option never sends anything by itself.
// These always ask, whatever the settings say: money leaving the account, and shell commands that delete
// or force-change things on the computer with no way back.
const PAYMENT_TOOL = /(^|[_-])(pay|payment|payments|charge|purchase|checkout|transfer|payout|refund|buy|order|send_money)s?([_-]|$)/i;
const DESTRUCTIVE_COMMAND = /(^|[\s;&|(])(sudo|su|rm\s+-\w*[rf]|mkfs\S*|dd\s+if=|shred|shutdown|reboot|poweroff|git\s+push\b[^;&|]*\s(-f|--force)|git\s+reset\s+--hard|git\s+clean\s+-\w*f|chmod\s+-R|chown\s+-R)(\s|$)|\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b|\bfind\b[^;&|]*\s-delete\b/;

const SEND_TOOL = /(^|[_-])(send|post|reply|forward|publish|invite|share|schedule|comment|respond)([_-]|$)/i;
const DELETE_TOOL = /(^|[_-])(delete|remove|trash|archive|cancel|destroy|purge)([_-]|$)/i;
// Which "ask before" setting a connector action falls under.
const toolKind = (tool) => (PAYMENT_TOOL.test(tool) ? 'pay' : DELETE_TOOL.test(tool) ? 'delete' : SEND_TOOL.test(tool) && !/draft/i.test(tool) ? 'send' : 'change');

const SAFE_ROLES = /^(checkbox|radio|switch|option|tab|menuitemcheckbox|menuitemradio|treeitem|combobox|slider|spinbutton|textbox|searchbox|input:)/;
const NEGATED = /\b(don'?t|do not|never|not|nikdy|ne)\s+(\S+\s+)?$/i;

// True when the user's words ask for it ("pošli", "submit it"), not when they forbid it ("don't send").
function userAsked(texts, re) {
  const g = new RegExp(re.source, 'gi');
  return texts.some((text) => [...String(text).matchAll(g)].some((m) => !NEGATED.test(text.slice(Math.max(0, m.index - 20), m.index))));
}

// ---------------------------------------------------------------- in-page helper (injected into the guest page)

function pageAgent() {
  if (window.__lumenAgent) return;
  // This function runs inside the web page, so its constants live here.
  const COMPACT_ELEMENTS = 60; // elements listed after an action (only what's on screen)
  const COMPACT_TEXT = 1200; // chars of visible text after an action
  const SEL ='a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=checkbox],[role=radio],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[role=slider],[role=spinbutton],[role=treeitem],[contenteditable=""],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"])';
  let refs = [];
  const clean = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  // Where a link goes, without tracking noise: random IDs like sxsrf=AKL5yDg… cost many tokens and tell
  // the agent nothing. Readable parameters (q=, id=, page=) stay; same-site links show just the path.
  const TRACKING_PARAM = /^(utm_|gs_|mc_|_ga)|^(gclid|gbraid|wbraid|fbclid|msclkid|igshid|yclid|dclid|ved|ei|sca_esv|sxsrf|sa|ictx|usg|oq|aqs|sourceid|ie|uact|rlz|biw|bih|dpr|spm|scm|ref_src|pvs|trk|si|_gl)$/i;
  const OPAQUE = /[A-Za-z0-9_-]{24,}/;
  const linkTarget = (href) => {
    let u;
    try { u = new URL(href, location.href); } catch { return clean(href, 70); }
    if (!/^https?:$/.test(u.protocol)) return clean(href, 70);
    const params = [...u.searchParams].filter(([k, v]) => !TRACKING_PARAM.test(k) && v.length <= 40 && !OPAQUE.test(v));
    const query = params.length ? `?${params.map(([k, v]) => (v ? `${k}=${v}` : k)).join('&')}` : '';
    return clean(`${u.origin === location.origin ? '' : u.host}${u.pathname}${query}`, 80);
  };
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05;
  };
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = clean(by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '));
      if (t) return t;
    }
    if (el.labels && el.labels.length) return clean([...el.labels].map((l) => l.innerText).join(' '));
    const t = clean(el.innerText || el.textContent);
    if (t) return t;
    return clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.querySelector?.('img[alt]')?.alt || (el.type !== 'password' ? el.value : '') || el.getAttribute('name') || '');
  };
  const roleOf = (el) => {
    const role = el.getAttribute('role');
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') return t;
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
      return `input:${t}`;
    }
    if (el.isContentEditable) return 'editable';
    return tag;
  };
  const describe = (el, id, where) => {
    let s = `[${id}] ${roleOf(el)}`;
    const name = nameOf(el);
    if (name) s += ` "${name}"`;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.type === 'password') s += el.value ? ' (filled)' : ' (empty)';
      else if (el.type === 'checkbox' || el.type === 'radio') s += el.checked ? ' checked' : '';
      else if (el.value) s += ` value="${clean(el.value, 60)}"`;
      else if (el.placeholder && el.placeholder !== name) s += ` placeholder="${clean(el.placeholder, 40)}"`;
    } else if (el.tagName === 'SELECT') {
      s += ` = "${clean(el.selectedOptions?.[0]?.text, 40)}"`;
    }
    if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true') s += ' selected';
    const exp = el.getAttribute('aria-expanded');
    if (exp) s += exp === 'true' ? ' expanded' : ' collapsed';
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      if (href && !/^javascript:/i.test(href) && href !== '#') s += ` → ${linkTarget(href)}`;
    }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') s += ' (disabled)';
    if (where) s += ` (${where})`;
    const pointed = window.__pulsePointed;
    if (pointed && pointed.isConnected && (el === pointed || el.contains(pointed))) s += ' ← the user pointed at this';
    return s;
  };
  const deepAll = (root, out) => {
    out.push(...root.querySelectorAll(SEL));
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) deepAll(el.shadowRoot, out);
    return out;
  };
  const visibleText = (max) => {
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const out = [];
    let len = 0;
    const cache = new Map();
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const p = n.parentElement;
      if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/i.test(p.tagName)) continue;
      const t = clean(n.nodeValue, 300);
      if (!t) continue;
      let vis = cache.get(p);
      if (vis === undefined) {
        const r = p.getBoundingClientRect();
        vis = r.width > 0 && r.bottom > 0 && r.top < innerHeight;
        cache.set(p, vis);
      }
      if (!vis) continue;
      out.push(t);
      len += t.length + 1;
      if (len > max) break;
    }
    return out.join(' ').slice(0, max);
  };
  const get = (id) => {
    const e = refs[id];
    if (!e || !e.isConnected) throw new Error(`Element [${id}] is no longer on the page. Take a new snapshot.`);
    return e;
  };
  const scrollableAt = (x, y) => {
    let n = document.elementFromPoint(x, y);
    while (n && n !== document.body && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4 && n.clientHeight > innerHeight * 0.5) return n;
      n = n.parentElement;
    }
    return null;
  };
  let gotMouse = false;
  let gotKey = false;
  addEventListener('mousedown', (e) => { if (e.isTrusted) gotMouse = true; }, true);
  addEventListener('keydown', (e) => { if (e.isTrusted) gotKey = true; }, true);
  const setNativeValue = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  window.__lumenAgent = {
    arm() { gotMouse = false; gotKey = false; },
    received() { return { mouse: gotMouse, key: gotKey }; },
    domClick(id, double) {
      const e = get(id);
      const r = e.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, view: window };
      e.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
      e.dispatchEvent(new MouseEvent('mousedown', opts));
      if (typeof e.focus === 'function') e.focus({ preventScroll: true });
      e.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
      e.dispatchEvent(new MouseEvent('mouseup', opts));
      e.click();
      if (double) e.dispatchEvent(new MouseEvent('dblclick', opts));
    },
    focusRef(id) {
      const e = get(id);
      if (typeof e.focus === 'function') e.focus({ preventScroll: true });
      return document.activeElement === e || e.contains(document.activeElement);
    },
    valueOf(id) {
      const e = get(id);
      return 'value' in e && e.tagName !== 'BUTTON' ? String(e.value) : e.isContentEditable ? e.innerText : null;
    },
    domType(id, text, clear) {
      const e = id == null ? document.activeElement : get(id);
      if (!e) throw new Error('Nothing is focused to type into.');
      if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') {
        e.focus({ preventScroll: true });
        setNativeValue(e, (clear ? '' : e.value) + text);
        return;
      }
      if (e.isContentEditable) {
        e.focus();
        if (clear) document.execCommand('selectAll');
        document.execCommand('insertText', false, text);
        return;
      }
      throw new Error('That element does not accept text.');
    },
    domEnter(id) {
      const e = id == null ? document.activeElement : get(id);
      if (!e) return false;
      const ev = (type) => new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true });
      const go = e.dispatchEvent(ev('keydown'));
      e.dispatchEvent(ev('keypress'));
      e.dispatchEvent(ev('keyup'));
      if (go && e.form && e.tagName === 'INPUT') { e.form.requestSubmit ? e.form.requestSubmit() : e.form.submit(); }
      return true;
    },
    snapshot(opts = {}) {
      const vh = innerHeight;
      const all = deepAll(document, []);
      refs = [];
      const picked = new Set();
      const lines = [];
      let above = 0;
      let below = 0;
      // compact: after an action only what's on screen, to keep each step's result small.
      const limit = opts.full ? 500 : opts.compact ? COMPACT_ELEMENTS : 160;
      for (const el of all) {
        if (picked.has(el) || !isVisible(el)) continue;
        const parent = el.parentElement?.closest(SEL);
        if (parent && picked.has(parent) && nameOf(parent) === nameOf(el)) continue;
        const r = el.getBoundingClientRect();
        let where = '';
        if (r.bottom < 0) {
          where = 'above';
          if (!opts.full && (opts.compact || r.bottom < -vh)) { above++; continue; }
        } else if (r.top > vh) {
          where = 'below';
          if (!opts.full && (opts.compact || r.top > vh * 2)) { below++; continue; }
        }
        if (lines.length >= limit) { below++; continue; }
        picked.add(el);
        lines.push(describe(el, refs.push(el) - 1, where));
      }
      const active = document.activeElement && document.activeElement !== document.body ? refs.indexOf(document.activeElement) : -1;
      return {
        url: location.href, title: document.title, scrollY: Math.round(scrollY),
        scrollH: document.documentElement.scrollHeight, vw: innerWidth, vh,
        elements: lines.join('\n'), above, below, text: visibleText(opts.compact ? COMPACT_TEXT : 3500),
        focused: active >= 0 ? `[${active}]` : '',
        dialog: !!document.querySelector('dialog[open],[role=dialog]:not([aria-hidden=true]),[aria-modal=true]'),
      };
    },
    locate(id) {
      const e = get(id);
      e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = e.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      const covered = top && !e.contains(top) && !top.contains(e) ? clean(nameOf(top) || top.tagName, 40) : '';
      return { x, y, left: r.left, top: r.top, w: r.width, h: r.height, name: nameOf(e) || roleOf(e), role: roleOf(e), password: e.type === 'password', covered };
    },
    selectAll(id) {
      const e = get(id);
      if ((e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') && typeof e.select === 'function') { e.focus(); e.select(); return; }
      if (e.isContentEditable) {
        e.focus();
        const range = document.createRange();
        range.selectNodeContents(e);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    },
    choose(id, value) {
      const e = get(id);
      if (e.tagName !== 'SELECT') throw new Error(`[${id}] is not a <select>. Click it and pick the option instead.`);
      const v = String(value).trim().toLowerCase();
      const opts = [...e.options];
      const opt = opts.find((o) => o.value.toLowerCase() === v) || opts.find((o) => o.text.trim().toLowerCase() === v) || opts.find((o) => o.text.toLowerCase().includes(v));
      if (!opt) throw new Error(`No option "${value}". Options: ${opts.map((o) => o.text.trim()).slice(0, 40).join(' | ')}`);
      e.value = opt.value;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return opt.text.trim();
    },
    scroll(screens) {
      const dy = screens * innerHeight;
      const box = scrollableAt(innerWidth / 2, innerHeight / 2);
      if (box) box.scrollBy({ top: dy, behavior: 'instant' });
      else window.scrollBy({ top: dy, behavior: 'instant' });
      return Math.round(box ? box.scrollTop : scrollY);
    },
    reveal(id) {
      get(id).scrollIntoView({ block: 'center', behavior: 'instant' });
    },
    // The image to search with: inside element `id`, else the one the user pointed at, else the largest in view.
    imageOf(id) {
      const pick = (el) => (el ? (el.matches('img,video,canvas,svg') ? el : el.querySelector('img,video,canvas')) : null);
      let img = id == null ? pick(window.__pulsePointed?.isConnected ? window.__pulsePointed : null) : pick(get(id));
      if (!img && id == null) {
        let best = 0;
        for (const el of document.querySelectorAll('img,video,canvas')) {
          const r = el.getBoundingClientRect();
          const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
          if (area > best) { best = area; img = el; }
        }
      }
      const target = img || (id != null ? get(id) : null);
      if (!target) throw new Error('No image found. Give the ref of the image (or the card/link that contains it).');
      target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const r = target.getBoundingClientRect();
      const bg = !img && getComputedStyle(target).backgroundImage.match(/url\("?(.*?)"?\)/)?.[1];
      return { src: img?.currentSrc || img?.src || bg || '', rect: { x: r.left, y: r.top, w: r.width, h: r.height }, alt: clean(img?.alt || target.getAttribute('aria-label'), 80) };
    },
    text(id, max) {
      const t = (id == null ? document.body : get(id))?.innerText || '';
      return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').slice(0, max);
    },
    quiet(idle, max) {
      return new Promise((resolve) => {
        let timer;
        const done = () => { obs.disconnect(); clearTimeout(timer); resolve(true); };
        const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, idle); });
        obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        timer = setTimeout(done, idle);
        setTimeout(done, max);
      });
    },
  };
}

const INSTALL = `(${pageAgent.toString()})();`;

async function page(tab, expr, timeout = 8000) {
  if (tab?.closed) throw new Error('The pop-up window was closed.');
  if (!tab?.wv || !tab.ready) throw new Error('The page is not ready yet.');
  const code = `${INSTALL}(async () => { try { return { ok: true, v: await (${expr}) }; } catch (e) { return { ok: false, e: String(e && e.message || e) }; } })()`;
  const res = await Promise.race([
    tab.wv.executeJavaScript(code),
    sleep(timeout).then(() => ({ ok: false, e: 'The page did not respond in time.' })),
  ]);
  if (!res?.ok) throw new Error(res?.e || 'Script failed on this page.');
  return res.v;
}

// ---------------------------------------------------------------- virtual cursor + glow (drawn above the webview)

// Where the tab's page sits inside the content area (it is offset in split view).
const paneOffset = (tab) => (S.split && tab?.wv?.offsetParent ? { x: tab.wv.offsetLeft, y: tab.wv.offsetTop } : { x: 0, y: 0 });

const overlay = {
  layer: null, cursor: null, ring: null, box: null, pill: null, label: null,
  x: 0, y: 0, visible: false, tabId: null,
  build() {
    if (this.layer) return;
    this.cursor = h('div', { class: 'agent-cursor' },
      h('div', { class: 'agent-arrow', html: '<svg viewBox="0 0 24 24" width="22" height="22"><defs><linearGradient id="agc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5e5ce6"/><stop offset=".55" stop-color="#bf5af2"/><stop offset="1" stop-color="#ff5e8a"/></linearGradient></defs><path d="M4.2 2.6 19.6 10a.8.8 0 0 1-.1 1.5l-6.1 1.9a1.6 1.6 0 0 0-1 1l-1.9 6.1a.8.8 0 0 1-1.5.1L1.6 5.2A1.9 1.9 0 0 1 4.2 2.6Z" fill="url(#agc)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>' }),
      this.label = h('div', { class: 'agent-label' }, 'Claude'));
    this.ring = h('div', { class: 'agent-ring' });
    this.box = h('div', { class: 'agent-target' });
    this.pill = h('div', { class: 'agent-pill' },
      h('span', { class: 'agent-pill-dot' }),
      h('span', { class: 'agent-pill-text' }, 'Claude is working'),
      h('button', { class: 'agent-pill-stop', onclick: () => [...runs.values()].forEach((r) => r.ui.stop?.()) }, 'Stop'));
    this.layer = h('div', { id: 'agent-layer' }, h('div', { class: 'agent-glow' }), this.box, this.ring, this.cursor, this.pill);
    $('#content').append(this.layer);
  },
  // The cursor, glow and pill only show while the agent is actually acting on the visible page.
  activeTabId: null, activeUntil: 0, holds: 0, hideTimer: null,
  sync() {
    this.build();
    const run = [...runs.values()].find((r) => r.tabId === this.activeTabId && Tabs.onScreen(Tabs.getTab(r.tabId)));
    const busy = this.holds > 0 || Date.now() < this.activeUntil;
    const on = !!run && busy;
    if (on && !this.layer.classList.contains('on') && !this.visible) {
      const c = $('#content').getBoundingClientRect();
      this.x = c.width / 2;
      this.y = c.height / 2;
      this.place(0);
      this.visible = true;
    }
    this.layer.classList.toggle('on', on);
    if (run) this.label.textContent = run.name;
  },
  activate(tab) {
    if (!tab) return;
    this.activeTabId = tab.id;
    this.activeUntil = Date.now() + 2500;
    this.sync();
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.sync(), 2600);
  },
  hold() { this.holds++; this.sync(); },
  release() { this.holds = Math.max(0, this.holds - 1); this.activeUntil = Date.now() + 1500; this.sync(); clearTimeout(this.hideTimer); this.hideTimer = setTimeout(() => this.sync(), 1600); },
  start() {
    this.build();
    this.sync();
  },
  place(dur) {
    this.cursor.style.transitionDuration = `${dur}ms`;
    this.cursor.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
  },
  async moveTo(tab, px, py) {
    const o = paneOffset(tab);
    const x = px + o.x;
    const y = py + o.y;
    const dist = Math.hypot(x - this.x, y - this.y);
    this.x = x;
    this.y = y;
    if (!Tabs.onScreen(tab)) return;
    const dur = Math.round(Math.max(90, Math.min(320, dist * 0.38)));
    this.place(dur);
    await sleep(dur);
  },
  target(tab, r, z) {
    if (!Tabs.onScreen(tab)) return;
    const o = paneOffset(tab);
    Object.assign(this.box.style, { left: `${r.left * z - 3 + o.x}px`, top: `${r.top * z - 3 + o.y}px`, width: `${r.w * z + 6}px`, height: `${r.h * z + 6}px` });
    this.box.classList.remove('show');
    void this.box.offsetWidth;
    this.box.classList.add('show');
  },
  click(tab) {
    if (!Tabs.onScreen(tab)) return;
    this.ring.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
    this.ring.classList.remove('pulse');
    void this.ring.offsetWidth;
    this.ring.classList.add('pulse');
    this.cursor.classList.remove('press');
    void this.cursor.offsetWidth;
    this.cursor.classList.add('press');
  },
  status(text) {
    this.build();
    this.pill.querySelector('.agent-pill-text').textContent = text;
  },
  end() {
    if (!runs.size) { this.visible = false; this.activeUntil = 0; this.holds = 0; }
    this.sync();
  },
};

Tabs.on('onActivate', () => overlay.layer && overlay.sync());

// ---------------------------------------------------------------- run lifecycle

export function beginRun(runId, { tabId, name, ui, key, task, images = [] }) {
  const run = { id: runId, tabId, name, ui, key, images, queue: Promise.resolve(), allowRisky: false, log: [], inbox: [], said: [task || ''] };
  runs.set(runId, run);
  const tab = Tabs.getTab(tabId);
  if (tab) tab.agent = true;
  changed({ persist: false });
  overlay.start(run);
  overlay.status(`${name} is working`);
  return run;
}

export function endRun(runId) {
  const run = runs.get(runId);
  runs.delete(runId);
  const tab = Tabs.getTab(run?.tabId);
  if (tab && ![...runs.values()].some((r) => r.tabId === tab.id)) tab.agent = false;
  if (run?.boardWatch && ![...runs.values()].some((r) => r.boardWatch)) Board.setPresence(null);
  changed({ persist: false });
  overlay.end();
  return run;
}

// Messages the user sends while the agent works ride along with the next tool result.
export function steer(runId, text) {
  const run = runs.get(runId);
  if (!run) return false;
  run.inbox.push(text);
  run.said.push(text);
  overlay.status('Got your message, adjusting');
  return true;
}

// While the agent works with the whiteboard, each tool result also says what the user changed there.
function deliverBoard(run, res) {
  if (!run.boardWatch || !Board.currentBoard()) return;
  const changes = Board.describeChanges();
  if (!changes) return;
  Board.markSeen();
  res.content = [...(res.content || []), { type: 'text', text: `\n<whiteboard_update>\nMeanwhile the user changed the whiteboard:\n${changes}\n</whiteboard_update>` }];
}

function deliverInbox(run, res) {
  if (!run.inbox.length) return;
  const msgs = run.inbox.splice(0);
  res.content = [...(res.content || []), {
    type: 'text',
    text: `\n<user_update key="${run.key}">\nThe user sent ${msgs.length > 1 ? 'new messages' : 'a new message'} while you were working. Take it into account right away; where it conflicts with earlier instructions, it wins (it may change or replace the task):\n${msgs.map((m) => `"${m}"`).join('\n')}\n</user_update>`,
  }];
  run.ui.delivered?.(msgs);
}

export function isRunning() {
  return runs.size > 0;
}

// ---------------------------------------------------------------- pop-up windows (OAuth sign-in etc.)
// They stay real windows so window.opener keeps working; main lets the agent drive them like a tab.

const popups = new Map(); // popup webContents id -> pseudo tab

function popupTab(info) {
  const api = window.lumen.popup;
  const id = info.id;
  const p = {
    id: `popup-${id}`, popup: true, wcId: id, openerId: info.openerId,
    url: 'about:blank', title: '', loading: true, ready: false, closed: false, zoom: 1,
    wv: {
      executeJavaScript: (code) => api.exec(id, code),
      sendInputEvent: (ev) => api.input(id, ev),
      insertText: (t) => api.insertText(id, t),
      focus: () => api.focus(id),
      getZoomFactor: () => p.zoom,
    },
  };
  return p;
}

function updatePopup(p, info) {
  if (info.url) p.url = info.url;
  p.title = info.title || p.title;
  p.loading = !!info.loading;
  p.ready = p.ready || !!info.ready;
  p.zoom = info.zoom || 1;
}

function onPopup(type, info) {
  if (type === 'open') {
    const p = popupTab(info);
    updatePopup(p, info);
    popups.set(info.id, p);
    // A pop-up opened by the page the agent drives (e.g. "Sign in with Google") becomes the controlled page.
    for (const run of runs.values()) {
      if (agentTab(run)?.wcId === info.openerId) { run.popupId = info.id; run.popupNote = 'opened'; }
    }
    return;
  }
  const p = popups.get(info.id);
  if (!p) return;
  if (type === 'update') { updatePopup(p, info); return; }
  p.closed = true;
  popups.delete(info.id);
  for (const run of runs.values()) {
    if (run.popupId !== info.id) continue;
    run.popupId = popups.has(p.openerId) ? p.openerId : null;
    run.popupNote = 'closed';
  }
}

function popupLabel(p) {
  return short(p.title || hostOf(p.url) || 'pop-up window', 60);
}

// Tells the model when the controlled page changed under it because a pop-up opened or closed.
function popupNotice(run) {
  const note = run.popupNote;
  run.popupNote = null;
  if (note === 'opened') {
    const p = popups.get(run.popupId);
    step(run, 'layers', `Switched to the pop-up “${p ? popupLabel(p) : 'window'}”`);
    return 'A pop-up window opened (typically a sign-in window) and is now the controlled page. Finish the step there; when it closes you are back on the original tab automatically.\n\n';
  }
  if (note === 'closed') {
    step(run, 'layers', 'The pop-up closed, back on the tab');
    return 'The pop-up window closed; you are back on the original tab.\n\n';
  }
  return '';
}

export function initAgent() {
  window.lumen.popup.onEvent(onPopup);
  window.lumen.agent.onTool((runId, callId, name, args) => {
    const run = runs.get(runId);
    if (!run) {
      window.lumen.agent.result(callId, fail('No active agent task.'));
      return;
    }
    run.queue = run.queue
      .then(() => execute(run, name, args || {}))
      .catch((err) => fail(err?.message || String(err)))
      .then((res) => {
        deliverBoard(run, res);
        deliverInbox(run, res);
        run.log.push({ name, args: redact(name, args), result: (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').slice(0, 1500), error: !!res.isError });
        window.lumen.agent.result(callId, res);
      });
  });
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });
const short = (s, n = 40) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

function redact(name, args) {
  if (name !== 'browser_act') return args;
  return { actions: (args.actions || []).map((a) => (a.type === 'type' && a._password ? { ...a, text: '••••' } : a)) };
}

function step(run, iconName, label, extra = {}) {
  const s = { icon: iconName, label, ...extra };
  run.ui.step?.(s);
  overlay.status(label);
  return s;
}

// The real tab the run works in (never a pop-up).
function runTab(run) {
  let tab = Tabs.getTab(run.tabId);
  if (!tab) {
    tab = Tabs.activeTab();
    if (tab) run.tabId = tab.id;
  }
  return tab;
}

// The page the agent controls: a pop-up it is working in, otherwise its tab.
function agentTab(run) {
  const popup = run.popupId != null && popups.get(run.popupId);
  return popup || runTab(run);
}

// After acting in a pop-up it may close itself (sign-in finished); continue on whatever is controlled now.
async function currentTarget(run, tab) {
  if (tab?.popup && !tab.closed) {
    try { await page(tab, '1', 1500); } catch { await sleep(300); }
  }
  const now = agentTab(run);
  if (now && now !== tab) await settle(now);
  return now;
}

async function waitReady(tab, max = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max && !tab.closed && (!tab.wv || !tab.ready || tab.loading)) await sleep(80);
}

async function settle(tab) {
  await sleep(100);
  await waitReady(tab, 10000);
  try { await page(tab, '__lumenAgent.quiet(220, 1500)', 3000); } catch {}
}

const zoomOf = (tab) => { try { return tab.wv.getZoomFactor() || 1; } catch { return 1; } };

// full: every element on the page; compact: only what's on screen, with less text (after an action).
async function describePage(tab, { full = false, compact = false } = {}) {
  if (!tab || isStart(tab.url) || !tab.wv) return 'No web page is open in the controlled tab. Use browser_navigate to open one.';
  await waitReady(tab);
  if (tab.error) return `The page failed to load: ${tab.error.description || tab.error.code} (${tab.error.url}).`;
  const s = await page(tab, `__lumenAgent.snapshot(${JSON.stringify({ full, compact })})`);
  const opened = [...popups.values()].filter((p) => p.openerId === tab.wcId);
  return [
    tab.popup ? 'Controlled page: a pop-up window (not a tab).' : '',
    `URL: ${s.url}`,
    `Title: ${s.title}`,
    `Scroll: ${s.scrollY}px of ${s.scrollH}px (viewport ${s.vw}×${s.vh})${s.dialog ? ' · a dialog is open' : ''}${s.focused ? ` · focused ${s.focused}` : ''}`,
    ...opened.map((p) => `This page has a pop-up window open: "${popupLabel(p)}" (id=${p.id}). Use browser_tabs switch to work there.`),
    '',
    'Interactive elements:',
    s.elements || '(none visible)',
    s.above || s.below ? `(${s.above ? `${s.above} more above` : ''}${s.above && s.below ? ', ' : ''}${s.below ? `${s.below} more below` : ''}; scroll, or ${compact ? 'browser_snapshot' : 'browser_snapshot with full=true'})` : '',
    '',
    'Visible text:',
    s.text || '(none)',
  ].join('\n');
}

// ---------------------------------------------------------------- input

const KEYS = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Esc: 'Escape', Return: 'Enter', ' ': 'Space', Spacebar: 'Space', Del: 'Delete' };
const MODS = { ctrl: 'control', control: 'control', cmd: 'meta', command: 'meta', meta: 'meta', super: 'meta', alt: 'alt', option: 'alt', shift: 'shift' };

function press(tab, combo) {
  const parts = String(combo).split('+').map((p) => p.trim()).filter(Boolean);
  const raw = parts.pop() || 'Enter';
  const modifiers = parts.map((m) => MODS[m.toLowerCase()]).filter(Boolean);
  const keyCode = KEYS[raw] || (raw.length === 1 ? raw.toUpperCase() : raw);
  const wv = tab.wv;
  wv.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  const plain = !modifiers.some((m) => m === 'control' || m === 'meta' || m === 'alt');
  if (plain) {
    if (keyCode === 'Enter') wv.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    else if (keyCode === 'Space') wv.sendInputEvent({ type: 'char', keyCode: ' ', modifiers });
    else if (raw.length === 1) wv.sendInputEvent({ type: 'char', keyCode: raw, modifiers });
  }
  wv.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

function mouse(tab, type, x, y, clickCount = 1) {
  tab.wv.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount });
}

// Real input first (trusted events, works with any site); if the page didn't receive it
// (background tab, hidden window), fall back to DOM events so the agent never stalls.
async function realClick(tab, ref, t, double) {
  await page(tab, '__lumenAgent.arm()');
  mouse(tab, 'mouseDown', t.sx, t.sy, 1);
  mouse(tab, 'mouseUp', t.sx, t.sy, 1);
  if (double) {
    mouse(tab, 'mouseDown', t.sx, t.sy, 2);
    mouse(tab, 'mouseUp', t.sx, t.sy, 2);
  }
  await sleep(45);
  const got = await page(tab, '__lumenAgent.received()').catch(() => ({ mouse: true }));
  if (!got.mouse) await page(tab, `__lumenAgent.domClick(${Number(ref)}, ${!!double})`).catch(() => {});
}

async function realEnter(tab, ref) {
  await page(tab, '__lumenAgent.arm()').catch(() => {});
  press(tab, 'Enter');
  await sleep(45);
  const got = await page(tab, '__lumenAgent.received()').catch(() => ({ key: true }));
  if (!got.key) await page(tab, `__lumenAgent.domEnter(${ref == null ? 'null' : Number(ref)})`).catch(() => {});
}

async function pointAt(run, tab, ref) {
  overlay.activate(tab);
  const r = await page(tab, `__lumenAgent.locate(${Number(ref)})`);
  const z = zoomOf(tab);
  overlay.target(tab, r, z);
  await overlay.moveTo(tab, r.x * z, r.y * z);
  mouse(tab, 'mouseMove', r.x * z, r.y * z);
  return { ...r, sx: r.x * z, sy: r.y * z };
}

async function confirmRisky(run, label, role) {
  if (run.allowRisky || SAFE_ROLES.test(role || '')) return;
  const group = RISK_GROUPS.find((g) => g.label.test(label));
  if (!group || userAsked(run.said, group.said) || !askBefore(group.kind)) return;
  overlay.status('Waiting for your OK');
  overlay.hold();
  const answer = await run.ui.confirm?.(`Click “${short(label, 60)}”?`).finally(() => overlay.release());
  if (answer === 'all') run.allowRisky = true;
  else if (!answer) throw new Error(`The user declined: click "${label}". Don't retry it; ask the user or continue another way.`);
}

async function act(run, tab, a) {
  switch (a.type) {
    case 'click': {
      if (a.ref == null) throw new Error('click needs a ref.');
      const peek = await page(tab, `__lumenAgent.locate(${Number(a.ref)})`);
      await confirmRisky(run, peek.name, peek.role);
      const t = await pointAt(run, tab, a.ref);
      overlay.click(tab);
      await realClick(tab, a.ref, t, a.double);
      step(run, 'cursor', `${a.double ? 'Double-clicked' : 'Clicked'} “${short(t.name)}”`);
      return `Clicked [${a.ref}] ${t.role} "${short(t.name, 60)}"${t.covered ? ` (note: it was covered by "${t.covered}", which received the click)` : ''}.`;
    }
    case 'type': {
      let t = null;
      const value = String(a.text ?? '');
      const clear = a.clear !== false;
      if (a.ref != null) {
        t = await pointAt(run, tab, a.ref);
        overlay.click(tab);
        await realClick(tab, a.ref, t, false);
        await page(tab, `__lumenAgent.focusRef(${Number(a.ref)})`).catch(() => {});
        if (clear) await page(tab, `__lumenAgent.selectAll(${Number(a.ref)})`);
      }
      a._password = !!t?.password;
      overlay.activate(tab);
      overlay.status('Typing…');
      const before = a.ref != null ? await page(tab, `__lumenAgent.valueOf(${Number(a.ref)})`).catch(() => null) : null;
      tab.wv.focus();
      await tab.wv.insertText(value);
      await sleep(30);
      if (a.ref != null && value) {
        const after = await page(tab, `__lumenAgent.valueOf(${Number(a.ref)})`).catch(() => null);
        if (after != null && after === before && !after.includes(value)) {
          await page(tab, `__lumenAgent.domType(${Number(a.ref)}, ${JSON.stringify(value)}, ${clear})`);
        }
      }
      if (a.submit) {
        await sleep(30);
        await realEnter(tab, a.ref);
      }
      step(run, 'keyboard', `Typed ${t?.password ? 'a password' : `“${short(a.text, 32)}”`}${t ? ` into “${short(t.name, 24)}”` : ''}${a.submit ? ' and pressed Enter' : ''}`);
      return `Typed into ${t ? `[${a.ref}] "${short(t.name, 40)}"` : 'the focused element'}${a.submit ? ' and pressed Enter' : ''}.`;
    }
    case 'press': {
      const key = a.key || 'Enter';
      overlay.activate(tab);
      if (/^(enter|return)$/i.test(key)) await realEnter(tab, null);
      else press(tab, key);
      step(run, 'keyboard', `Pressed ${key}`);
      return `Pressed ${key}.`;
    }
    case 'select': {
      if (a.ref == null) throw new Error('select needs a ref.');
      await pointAt(run, tab, a.ref);
      overlay.click(tab);
      const chosen = await page(tab, `__lumenAgent.choose(${Number(a.ref)}, ${JSON.stringify(String(a.value ?? ''))})`);
      step(run, 'cursor', `Selected “${short(chosen)}”`);
      return `Selected "${chosen}" in [${a.ref}].`;
    }
    case 'scroll': {
      if (a.ref != null) {
        await page(tab, `__lumenAgent.reveal(${Number(a.ref)})`);
        step(run, 'scroll', 'Scrolled to an element');
        return `Scrolled [${a.ref}] into view.`;
      }
      overlay.activate(tab);
      const amount = Math.max(0.1, Math.min(10, Number(a.amount) || 0.8)) * (a.direction === 'up' ? -1 : 1);
      const y = await page(tab, `__lumenAgent.scroll(${amount})`);
      step(run, 'scroll', `Scrolled ${a.direction === 'up' ? 'up' : 'down'}`);
      return `Scrolled ${a.direction === 'up' ? 'up' : 'down'} (now at ${y}px).`;
    }
    case 'hover': {
      if (a.ref == null) throw new Error('hover needs a ref.');
      const t = await pointAt(run, tab, a.ref);
      step(run, 'cursor', `Hovered “${short(t.name)}”`);
      return `Hovering [${a.ref}].`;
    }
    case 'wait': {
      const ms = Math.max(0, Math.min(10000, Number(a.ms) || 500));
      await sleep(ms);
      return `Waited ${ms} ms.`;
    }
    default:
      throw new Error(`Unknown action "${a.type}".`);
  }
}

// ---------------------------------------------------------------- tools

async function execute(run, name, args) {
  let tab = agentTab(run);
  switch (name) {
    case 'browser_snapshot': {
      step(run, 'eye', `Reading ${tab && !isStart(tab.url) ? hostOf(tab.url) || 'the page' : 'the tab'}`);
      const notice = popupNotice(run);
      return text(notice + await describePage(tab, { full: !!args.full }));
    }
    case 'browser_act': {
      if (run.popupNote) {
        // The refs in these actions belong to the page that was controlled before the pop-up opened/closed.
        const notice = popupNotice(run);
        await settle(tab);
        return fail(`${notice}None of the actions ran because the controlled page changed. Use the refs below.\n\n${await describePage(tab)}`);
      }
      if (!tab?.wv || isStart(tab.url)) return fail('No web page is open. Use browser_navigate first.');
      await waitReady(tab);
      const done = [];
      for (let i = 0; i < args.actions.length; i++) {
        try {
          done.push(await act(run, tab, args.actions[i]));
        } catch (err) {
          await settle(tab);
          const now = await currentTarget(run, tab);
          const msg = `Action ${i + 1} (${args.actions[i].type}) failed: ${err.message}`;
          step(run, 'warn', short(err.message, 70), { error: true });
          return { content: [{ type: 'text', text: `${done.join('\n')}${done.length ? '\n' : ''}${msg}\n\n${popupNotice(run)}${await describePage(now).catch(() => '')}` }], isError: !done.length };
        }
        if (i < args.actions.length - 1) await sleep(60);
        // A click that opened or closed a pop-up changes the page the remaining actions belong to.
        if (run.popupNote) break;
      }
      await settle(tab);
      const now = await currentTarget(run, tab);
      const skipped = args.actions.length - done.length;
      return text(`${done.join('\n')}${skipped ? `\n(${skipped} remaining action${skipped > 1 ? 's were' : ' was'} skipped because the controlled page changed.)` : ''}\n\n${popupNotice(run)}${await describePage(now, { compact: true })}`);
    }
    case 'browser_navigate': {
      const target = String(args.url || '').trim();
      // Navigation always happens in the tab; a pop-up the agent was in stays open on its own.
      run.popupId = null;
      tab = runTab(run);
      if (!tab) tab = Tabs.open('lumen:start');
      run.tabId = tab.id;
      if (/^(back|forward|reload)$/i.test(target)) {
        const t = target.toLowerCase();
        if (t === 'back') Tabs.goBack(tab);
        else if (t === 'forward') Tabs.goForward(tab);
        else Tabs.reload(tab);
        step(run, 'globe', t === 'reload' ? 'Reloaded the page' : `Went ${t}`);
      } else {
        const url = /^[a-z]+:/i.test(target) ? target : `https://${target}`;
        Tabs.navigate(tab, url);
        overlay.activate(tab);
        step(run, 'globe', `Opened ${short(url.replace(/^https?:\/\/(www\.)?/, ''), 48)}`);
      }
      await sleep(150);
      await settle(tab);
      return text(await describePage(tab));
    }
    case 'approve_tool': {
      const name = String(args.tool_name || '');
      if (!name.startsWith('mcp__')) {
        // Claude Code's own tools: reading is fine, shell commands and file changes ask.
        const input = args.input || {};
        const shell = name === 'Bash';
        // Memory files are always writable: Pulse's own notes and Claude's CLAUDE.md / memory folders.
        const memory = /^(Write|Edit|MultiEdit)$/.test(name) && MEMORY_PATH.test(String(input.file_path || ''));
        if (memory) step(run, 'pin', 'Updated memory');
        const looking = shell && readOnlyCommand(input.command);
        if (looking) step(run, 'terminal', `Command: ${short(input.command, 60)}`);
        const free = !askBefore('computer') && !(shell && DESTRUCTIVE_COMMAND.test(String(input.command || '')));
        if (free && shell && !looking) step(run, 'terminal', `Command: ${short(input.command, 60)}`);
        let ok = memory || looking || free || /^(Read|Glob|Grep|LS)$/.test(name) || (shell ? run.allowShell : run.allowEdits);
        if (!ok) {
          overlay.status('Waiting for your OK');
          const answer = await run.ui.confirmTool?.({ name, server: 'Computer', tool: name, input });
          if (answer === 'task') { if (shell) run.allowShell = true; else run.allowEdits = true; }
          ok = !!answer;
          overlay.status(`${run.name} is working`);
        }
        return text(JSON.stringify(ok
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'The user declined this. Don\'t retry it; ask what they want instead.' }));
      }
      const { server, tool } = prettyTool(name);
      const toolName = name.split('__').pop() || name;
      const input = args.input || {};
      const sent = SLACK_MESSAGE.test(name) ? withLinkedEmails(input) : input; // the card shows how it will read
      const readOnly = /(^|[_-])(search|list|get|read|fetch|query|find|lookup|view|retrieve|describe|count|check|status|preview)([_-]|$)/i.test(toolName);
      let ok = S.settings.ai.toolAllow?.includes(name) || (S.settings.ai.autoAllowRead !== false && readOnly)
        || !askBefore(toolKind(toolName));
      if (!ok) {
        overlay.status('Waiting for your OK');
        const answer = await run.ui.confirmTool?.({ name, server, tool, input });
        if (answer === 'always') setSetting('ai.toolAllow', [...new Set([...(S.settings.ai.toolAllow || []), name])]);
        ok = !!answer;
        overlay.status(`${run.name} is working`);
      }
      return text(JSON.stringify(ok
        ? { behavior: 'allow', updatedInput: sent }
        : { behavior: 'deny', message: `The user declined ${server} · ${tool}. Don't retry it; continue another way or ask.` }));
    }
    case 'tabs_settings': {
      const out = tabSettings(args);
      if (out.changed) step(run, 'settings', 'Updated tab housekeeping');
      return text(out.report);
    }
    case 'tabs_organize': {
      const out = organize(run, args);
      step(run, 'layers', short(out[0] || 'Organized tabs', 60));
      return text(`${out.join('\n') || 'Nothing to change.'}\n\n${tabsReport(run)}`);
    }
    case 'browser_tabs': {
      const list = () => tabsReport(run);
      if (args.action === 'list') {
        step(run, 'layers', `Looked at ${S.tabs.length} tabs`);
        return text(list());
      }
      if (args.action === 'close' && Array.isArray(args.tab_ids)) {
        const closed = Tabs.closeMany(args.tab_ids, { reason: 'agent', label: `${run.name} closed ${args.tab_ids.length} tab${args.tab_ids.length > 1 ? 's' : ''}` });
        step(run, 'x', `Closed ${closed.length} tab${closed.length === 1 ? '' : 's'}`);
        if (!Tabs.getTab(run.tabId)) run.tabId = S.activeId;
        return text(`Closed ${closed.length} tabs (pinned tabs are never closed).\n\n${list()}`);
      }
      if (args.action === 'open') {
        if (!args.url) return fail('open needs a url.');
        const url = /^[a-z]+:/i.test(args.url) ? args.url : `https://${args.url}`;
        const t = Tabs.open(url, { afterId: run.tabId });
        const prev = runTab(run);
        if (prev) prev.agent = false;
        run.tabId = t.id;
        run.popupId = null;
        t.agent = true;
        changed({ persist: false });
        step(run, 'plus', `Opened a new tab: ${hostOf(url)}`);
        await sleep(150);
        await settle(t);
        return text(await describePage(t, { compact: true }));
      }
      if (args.action === 'split') {
        const kind = Split.showTabs((args.tab_ids || []).map(String), args.layout);
        if (!kind) return fail(`split needs 2 to 4 tab_ids of open web pages (not new-tab pages).\n${list()}`);
        step(run, 'layers', `Split the window: ${kind === 'grid' ? '2×2 grid' : kind === 'rows' ? 'stacked' : 'side by side'}`);
        return text(`Split view on (${kind}).\n\n${list()}`);
      }
      if (args.action === 'unsplit') {
        Split.exitSplit();
        step(run, 'layers', 'Back to a single page');
        return text(`Split view off.\n\n${list()}`);
      }
      const popup = [...popups.values()].find((p) => p.id === args.tab_id);
      if (popup) {
        if (args.action === 'close') {
          window.lumen.popup.close(popup.wcId);
          step(run, 'x', `Closed the pop-up “${popupLabel(popup)}”`);
          if (run.popupId === popup.wcId) run.popupId = null;
          run.popupNote = null;
          await sleep(200);
          return text(`Closed the pop-up window.\n\n${list()}`);
        }
        run.popupId = popup.wcId;
        run.popupNote = null;
        step(run, 'layers', `Switched to the pop-up “${popupLabel(popup)}”`);
        await waitReady(popup);
        return text(await describePage(popup));
      }
      const t = Tabs.getTab(args.tab_id);
      if (!t) return fail(`No tab with id ${args.tab_id}.\n${list()}`);
      if (args.action === 'switch') {
        const prev = runTab(run);
        if (prev) prev.agent = false;
        run.tabId = t.id;
        run.popupId = null;
        t.agent = true;
        Tabs.activate(t.id);
        overlay.sync();
        step(run, 'layers', `Switched to “${short(t.title)}”`);
        await waitReady(t);
        return text(await describePage(t));
      }
      if (args.action === 'close') {
        Tabs.closeTab(t.id);
        step(run, 'x', `Closed “${short(t.title)}”`);
        if (run.tabId === t.id) run.tabId = S.activeId;
        return text(`Closed.\n${list()}`);
      }
      return fail('Unknown tabs action.');
    }
    case 'whiteboard_draw': {
      if (!Board.currentBoard()) Board.newBoard({ title: args.title, temporary: args.save !== true });
      else if (args.title) Board.renameBoard(args.title);
      if (args.save) Board.keepBoard();
      joinBoard(run);
      const notes = Board.describeChanges();
      const elements = await withImages(run, tab, Array.isArray(args.elements) ? args.elements : []);
      const ids = Board.apply({
        elements,
        remove: Array.isArray(args.remove) ? args.remove : [],
        clear: !!args.clear,
        layout: args.layout || null,
      });
      const b = Board.currentBoard();
      Board.markSeen();
      step(run, 'board', `Drew on the whiteboard (${ids.length} item${ids.length === 1 ? '' : 's'})`);
      return text(`Board "${b.title}" (${b.temporary ? 'temporary, erased when the user closes it' : 'saved'}) now has ${b.elements.length} elements. Added or updated: ${ids.join(', ') || 'none'}.${notes ? `\n\nBefore that, the user had changed the board:\n${notes}` : ''}`);
    }
    case 'whiteboard_read': {
      const b = Board.currentBoard();
      if (!b) return text('No whiteboard is open. Use whiteboard_draw to start one.');
      joinBoard(run);
      showBoard(true);
      await sleep(250);
      return boardView(run, b, 'Looked at the whiteboard');
    }
    case 'whiteboard_wait': {
      if (!Board.currentBoard()) return fail('No whiteboard is open. Draw with whiteboard_draw first.');
      joinBoard(run);
      showBoard(true);
      const secs = Math.max(5, Math.min(WAIT_MAX_S, Number(args.timeout_seconds) || WAIT_DEFAULT_S));
      step(run, 'board', 'Watching the whiteboard…');
      overlay.status('Your turn on the whiteboard');
      const why = await Board.waitForUser(secs * 1000, () => !runs.has(run.id) || run.inbox.length > 0);
      overlay.status(`${run.name} is working`);
      if (why === 'timeout') return text(`The user didn't change the board in ${secs} s. Wait again, add something yourself, or finish if the work is done.`);
      if (why === 'stopped') return text('The user sent a message instead of drawing. Read it and continue.');
      return boardView(run, Board.currentBoard(), 'Saw your changes on the whiteboard');
    }
    case 'browser_history': {
      const query = String(args.query || '').trim();
      const found = searchHistory(query, { days: Number(args.days), limit: args.limit });
      step(run, 'history', query ? `Searched history for “${short(query, 40)}”` : 'Looked at recent history');
      if (!found.length) return text(`Nothing in the history matches "${query}"${args.days ? ` in the last ${args.days} days` : ''}. Try other words (e.g. a part of the URL or an English/Czech variant).`);
      return text(`${found.length} page${found.length > 1 ? 's' : ''} from the history${query ? ` matching "${query}"` : ''}:\n${formatPages(found)}`);
    }
    case 'image_search': {
      let src = attachedImage(run, String(args.image_url || '').trim());
      let rect = null;
      let source = null;
      if (!src) {
        if (!tab?.wv || isStart(tab.url)) return fail('No web page is open. Give image_url or open the page with the image.');
        await waitReady(tab);
        const info = await page(tab, `__lumenAgent.imageOf(${args.ref == null ? 'null' : Number(args.ref)})`);
        ({ src, rect } = info);
        source = tab;
        await sleep(120); // let the page repaint after scrolling the image into view
      }
      step(run, 'search', 'Searching Google Lens for similar images');
      const lens = await Lens.searchImage({ src, tab: source, rect, afterId: runTab(run)?.id });
      const prev = runTab(run);
      if (prev) prev.agent = false;
      run.tabId = lens.id;
      run.popupId = null;
      lens.agent = true;
      changed({ persist: false });
      await settle(lens);
      return text(`Google Lens results are open in a new tab (now the controlled tab). Look at "Visual matches" (Czech: "Vizuální shody") and "Exact matches" ("Přesné shody") for products, shops and prices; open promising ones with browser_navigate or browser_act.\n\n${await describePage(lens)}`);
    }
    case 'browser_read': {
      if (!tab?.wv || isStart(tab.url)) return fail('No web page is open.');
      await waitReady(tab);
      const max = Math.max(1000, Math.min(150000, Number(args.max_chars) || 40000));
      const t = await page(tab, `__lumenAgent.text(${args.ref == null ? 'null' : Number(args.ref)}, ${max})`);
      step(run, 'page', 'Read the page text');
      return text(t || '(no text)');
    }
    case 'browser_screenshot': {
      if (!tab?.wcId || isStart(tab.url)) return fail('No web page is open.');
      await waitReady(tab);
      const data = await Promise.race([window.lumen.capture(tab.wcId), sleep(5000).then(() => null)]);
      step(run, 'camera', 'Took a screenshot');
      if (!data) return fail('The screenshot failed.');
      return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }, { type: 'text', text: `Screenshot of ${tab.url}` }] };
    }
    case 'ask_user': {
      overlay.status('Waiting for you');
      const answer = await run.ui.ask?.(String(args.question || ''), Array.isArray(args.options) ? args.options.map(String).slice(0, 6) : []);
      overlay.status(`${run.name} is working`);
      return text(`The user answered: ${answer}`);
    }
    case 'name_ids': {
      const map = {};
      for (const [id, name] of Object.entries(args.names || {}).slice(0, 50)) {
        const key = normId(String(id).replace(/^[a-z]+:\/\//i, ''));
        if (/^[0-9a-f]{32}$/.test(key) && name) map[key] = String(name).slice(0, 120);
      }
      run.ui.names?.(map);
      return text(`Noted ${Object.keys(map).length} name${Object.keys(map).length === 1 ? '' : 's'} for the approval card.`);
    }
    case 'site_memory_save': {
      if (PRIVATE) return text('Private window: notes are not saved.');
      if (args.scope === 'general') {
        const line = await window.lumen.sites.generalNote(String(args.note || ''));
        step(run, 'pin', 'Remembered about you');
        return text(`Saved to your general notes: ${line}`);
      }
      const host = hostOf(runTab(run)?.url || '') || run.ui.site?.() || 'general';
      const line = await window.lumen.sites.note(host, String(args.note || ''));
      step(run, 'pin', `Remembered for ${host}`);
      return text(`Saved to ${host} notes: ${line}`);
    }
    default:
      return fail(`Unknown tool ${name}.`);
  }
}

// ---------------------------------------------------------------- whiteboard helpers

const WAIT_DEFAULT_S = 60;
const WAIT_MAX_S = 180;

function joinBoard(run) {
  if (!run.boardWatch) { run.boardWatch = true; Board.markSeen(); }
  Board.setPresence(run.name);
}

// The board as text (with what the user changed since the agent last looked) plus a picture.
async function boardView(run, b, label) {
  const changes = Board.describeChanges();
  Board.markSeen();
  step(run, 'board', label);
  const image = await snapshotBoard();
  const content = [{ type: 'text', text: `${changes ? `What the user changed since you last looked:\n${changes}\n\n` : ''}Board "${b.title}" (${b.temporary ? 'temporary' : 'saved'}), ${b.elements.length} elements:\n${Board.describeElements() || '(empty)'}` }];
  if (image) content.push({ type: 'image', data: image, mimeType: 'image/jpeg' });
  return { content };
}

// Slack's connector turns a bare e-mail address into a link that reads "mailto:…"; an explicit Markdown
// link keeps the address as its text. Code and existing links are left alone.
const SLACK_MESSAGE = /slack.*(send_message|message_draft|schedule_message|update_message)/i;
const BARE_EMAIL = /(^|[\s(,;:])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?=$|[\s),.;:!?])/g;
const linkEmails = (md) => String(md)
  .split(/(```[\s\S]*?```|`[^`\n]*`|\[[^\]]*\]\([^)]*\)|<[^>\n]*>)/)
  .map((part, i) => (i % 2 ? part : part.replace(BARE_EMAIL, (_m, pre, mail) => `${pre}[${mail}](mailto:${mail})`)))
  .join('');
const withLinkedEmails = (input) => (typeof input.message === 'string' ? { ...input, message: linkEmails(input.message) } : input);

// "attached:2" → the second image the user pasted into their message (as a data: URL).
function attachedImage(run, src) {
  const n = /^attached:(\d+)$/i.exec(src);
  if (!n) return src;
  const im = run.images?.[Number(n[1]) - 1];
  if (!im) throw new Error(`There is no attached image ${n[1]}; the user attached ${run.images?.length || 0}.`);
  return `data:${im.mime};base64,${im.data}`;
}

// Image elements from the agent: "screenshot" = the page it controls; URLs are fetched and stored.
async function withImages(run, tab, elements) {
  const out = [];
  for (const e of elements) {
    if (e?.type !== 'image') { out.push(e); continue; }
    let src = attachedImage(run, String(e.src || ''));
    if (src === 'screenshot') {
      if (!tab?.wcId) throw new Error('No page is open to take a screenshot of.');
      const shot = await window.lumen.capture(tab.wcId);
      if (!shot) throw new Error('The screenshot failed.');
      src = `data:image/jpeg;base64,${shot}`;
    } else if (/^https?:/i.test(src)) {
      const got = await window.lumen.fetchImage(src).catch(() => null);
      if (got) src = `data:${got.mime};base64,${got.data}`;
    }
    const img = await loadImage(src).catch(() => null);
    if (!img) throw new Error(`Couldn't load the image ${String(e.src).slice(0, 80)}.`);
    const w = Number(e.w) || (Number(e.h) ? (Number(e.h) * img.w) / img.h : img.w);
    out.push({ ...e, src: img.src, w, h: Number(e.h) || (w * img.h) / img.w });
  }
  return out;
}

// ---------------------------------------------------------------- tab management helpers

function tabsReport(run) {
  const dupOf = new Map();
  for (const list of Tabs.duplicateSets()) for (const t of list.slice(1)) dupOf.set(t.id, list[0].id);
  const groupName = (t) => S.groups.find((g) => g.id === t.groupId)?.name;
  const controlled = agentTab(run)?.id;
  const lines = Tabs.orderedTabs().map((t) => {
    const bits = [
      t.pinned ? 'pinned' : groupName(t) ? `group "${groupName(t)}"` : 'no group',
      t.keep ? 'protected: never close' : '',
      `last used ${Tabs.lastUsedLabel(t)}`,
      !t.wv && !isStart(t.url) && t.id !== S.activeId ? 'sleeping' : '',
      t.audible ? 'playing audio' : '',
      dupOf.has(t.id) ? `duplicate of id=${dupOf.get(t.id)}` : '',
    ].filter(Boolean);
    return `- id=${t.id}${t.id === controlled ? ' [controlled]' : ''}${t.id === S.activeId ? ' [visible]' : ''} ${isStart(t.url) ? '(new tab)' : `${short(t.title, 70)} - ${short(t.url, 90)}`} · ${bits.join(' · ')}`;
  });
  const groups = S.groups.map((g) => `- "${g.name}" (${g.color}${g.rules?.length ? `, auto-opens: ${g.rules.join(', ')}` : ''}): ${S.tabs.filter((t) => !t.pinned && t.groupId === g.id).length} tabs`);
  const opener = (p) => S.tabs.find((t) => t.wcId === p.openerId) || [...popups.values()].find((x) => x.wcId === p.openerId);
  const pops = [...popups.values()].map((p) => `- id=${p.id}${p.id === controlled ? ' [controlled]' : ''} ${short(p.title || 'Pop-up', 70)} - ${short(p.url, 90)}${opener(p) ? ` · opened by id=${opener(p).id}` : ''}`);
  const split = S.split ? `\n\nSplit view (${S.split.layout}): ${S.split.panes.map((id) => (id ? `id=${id}` : 'empty')).join(', ')}` : '';
  return `Open tabs (${S.tabs.length}):\n${lines.join('\n') || '(none)'}${split}${pops.length ? `\n\nPop-up windows (switch to control one, close to dismiss it):\n${pops.join('\n')}` : ''}\n\nGroups:\n${groups.join('\n') || '(none)'}`;
}

function tabSettings(args) {
  const cur = S.settings.tabs || {};
  let rules = (cur.rules || []).map((r) => ({ ...r }));
  let changedAny = false;
  const norm = (r) => ({
    id: r.id || uid(),
    site: String(r.site || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase(),
    max: Math.max(1, Math.min(50, Math.round(Number(r.max) || 5))),
    idle: Math.max(1, Math.min(1440, Math.round(Number(r.idle) || 10))),
    enabled: r.enabled !== false,
  });
  if (Array.isArray(args.rules)) { rules = args.rules.map(norm); changedAny = true; }
  if (Array.isArray(args.add_rules) && args.add_rules.length) { rules.push(...args.add_rules.map(norm)); changedAny = true; }
  if (Array.isArray(args.remove_rule_ids) && args.remove_rule_ids.length) {
    const drop = new Set(args.remove_rule_ids.map(String));
    rules = rules.filter((r) => !drop.has(r.id));
    changedAny = true;
  }
  if (changedAny) setSetting('tabs.rules', rules);
  if (Number.isFinite(args.sleep_after_minutes)) { setSetting('tabs.sleepAfter', Math.max(0, Math.round(args.sleep_after_minutes))); changedAny = true; }
  if (Number.isFinite(args.archive_after_hours)) { setSetting('tabs.archiveAfter', Math.max(0, Math.round(args.archive_after_hours))); changedAny = true; }
  if (changedAny) Tabs.housekeeping();
  const t = S.settings.tabs;
  const lines = (t.rules || []).map((r) => `- id=${r.id} ${r.enabled ? 'on' : 'off'}: ${r.site || 'any site'} → keep at most ${r.max} tabs, close extras unused for ${r.idle} min`);
  return {
    changed: changedAny,
    report: `${changedAny ? 'Saved.\n' : ''}Per-site tab limits:\n${lines.join('\n') || '(none)'}\nSleep idle tabs after: ${t.sleepAfter ? `${t.sleepAfter} min` : 'never'}\nArchive unused tabs after: ${t.archiveAfter ? `${t.archiveAfter} h` : 'never'}`,
  };
}

function organize(run, args) {
  const out = [];
  const ids = (list) => (Array.isArray(list) ? list : []).map((id) => Tabs.getTab(String(id))).filter(Boolean);
  const colors = Object.keys(GROUP_COLORS);
  for (const g of Array.isArray(args.groups) ? args.groups : []) {
    const name = String(g.name || '').trim().slice(0, 40);
    if (!name) continue;
    let grp = S.groups.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!grp) {
      grp = { id: uid(), name, color: colors[S.groups.length % 8], collapsed: false, rules: [] };
      S.groups.push(grp);
      out.push(`Created group "${name}".`);
    }
    if (g.color && GROUP_COLORS[g.color]) grp.color = g.color;
    if (Array.isArray(g.rules) && g.rules.length) grp.rules = [...new Set([...(grp.rules || []), ...g.rules.map(String)])];
    const tabs = ids(g.tab_ids);
    for (const t of tabs) { t.pinned = false; t.pinnedUrl = null; t.groupId = grp.id; }
    if (tabs.length) out.push(`Moved ${tabs.length} tab${tabs.length > 1 ? 's' : ''} to "${name}".`);
  }
  for (const t of ids(args.ungroup)) t.groupId = null;
  for (const t of ids(args.pin)) Tabs.setPinned(t, true);
  for (const t of ids(args.unpin)) Tabs.setPinned(t, false);
  const slept = ids(args.sleep).filter((t) => Tabs.sleepTab(t)).length;
  if (slept) out.push(`Put ${slept} tab${slept > 1 ? 's' : ''} to sleep.`);
  if (args.sort) { Tabs.sortTabs(args.sort); out.push(`Sorted tabs by ${args.sort.replace('_', ' ')}.`); }
  const toClose = ids(args.close).map((t) => t.id);
  if (toClose.length) {
    const closed = Tabs.closeMany(toClose, { reason: 'agent', label: `${run.name} closed ${toClose.length} tab${toClose.length > 1 ? 's' : ''}` });
    out.push(`Closed ${closed.length} tab${closed.length === 1 ? '' : 's'} (they can be restored from the archive).`);
    if (!Tabs.getTab(run.tabId)) run.tabId = S.activeId;
  }
  if (args.delete_empty_groups) {
    const before = S.groups.length;
    S.groups = S.groups.filter((g) => S.tabs.some((t) => t.groupId === g.id) || g.rules?.length);
    if (before !== S.groups.length) out.push(`Removed ${before - S.groups.length} empty group(s).`);
  }
  if (args.ungroup?.length) out.push(`Removed ${args.ungroup.length} tab(s) from their groups.`);
  changed();
  return out;
}

// "mcp__claude_ai_Gmail__search_threads" → { server: "Gmail", tool: "search threads" }
export function prettyTool(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name || '');
  if (!m) return { server: 'Computer', tool: name };
  const server = m[1].replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '').replace(/_/g, ' ');
  return { server, tool: m[2].replace(/[_-]+/g, ' ').trim() };
}

export function runLog(runId) {
  return runs.get(runId)?.log || [];
}
