// Chat view: the open conversation of Pulse's AI panel, its approval cards, and a composer for new tasks.
import { h, icon } from './dom.js';
import { store, command, go } from './api.js';

// Markdown loads on its own: browsers that can't parse it (iOS Safari before 16.4) still get the app,
// with answers as plain text.
let md = null; // { marked, purify } once loaded
const lastOf = (list) => list[list.length - 1];

const SUGGESTIONS = ['Summarize this page', 'Organize my tabs', 'What’s new in my inbox?'];
const STICK_PX = 120;

let root;
let list;
let input;
let sendBtn;
let modeBox;
let modePick = null; // the mode chosen on the phone until Pulse confirms it
const rendered = []; // per message: { json, el }

// No images: text from web pages could otherwise make the phone load a URL that carries data out.
const markdown = (text) => md.purify.sanitize(md.marked.parse(text || ''), { FORBID_TAGS: ['style', 'form', 'input', 'img'], FORBID_ATTR: ['style'] });

function answerEl(m) {
  const cls = `md${m.pending ? ' streaming' : ''}`;
  return md ? h('div', { class: cls, html: markdown(m.content) }) : h('div', { class: `${cls} plain` }, m.content);
}

function loadMarkdown() {
  Promise.all([import('/vendor/marked.js'), import('/vendor/purify.js')]).then(([m, p]) => {
    m.marked.setOptions({ gfm: true, breaks: false });
    md = { marked: m.marked, purify: p.default };
    rendered.length = 0; // draw the answers again, now formatted
    if (store.chat) renderMessages(store.chat);
  }).catch(() => {});
}

function stepsEl(m) {
  if (!m.steps.length) return null;
  return h('div', { class: 'steps' },
    m.earlierSteps ? h('div', { class: 'step more' }, `${m.earlierSteps} earlier step${m.earlierSteps > 1 ? 's' : ''}`) : null,
    ...m.steps.map((st, i) => (st.user
      ? h('div', { class: 'step user' }, st.label.replace(/^You: /, ''))
      : h('div', { class: `step${st.error ? ' err' : ''}${m.pending && i === m.steps.length - 1 && !m.ask && !m.confirm ? ' live' : ''}` }, st.label))));
}

function askEl(m) {
  const { id, question, options } = m.ask;
  const reply = h('input', { class: 'field', placeholder: 'Type your answer', enterkeyhint: 'send', dataset: { ask: id } });
  const answer = (text) => { if (text.trim()) command('chat.answer', { id, text: text.trim() }); };
  reply.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); answer(reply.value); } });
  return h('div', { class: 'card ask' },
    h('div', { class: 'card-q' }, h('span', { html: icon('chat', 16) }), question),
    options.length ? h('div', { class: 'choices' }, ...options.map((o) => h('button', { class: 'btn', onclick: () => answer(o) }, o))) : null,
    h('div', { class: 'reply' }, reply, h('button', { class: 'btn primary', onclick: () => answer(reply.value) }, 'Reply')));
}

function confirmEl(m) {
  const c = m.confirm;
  return h('div', { class: 'card confirm' },
    h('div', { class: 'card-q' }, h('span', { html: icon('shield', 16) }), h('div', {}, h('b', {}, c.title), c.where ? h('small', {}, c.where) : null)),
    c.said ? h('p', { class: 'said' }, c.said) : null,
    c.fields?.length ? h('dl', { class: 'fields' }, ...c.fields.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null,
    c.detail ? h('pre', { class: 'detail' }, c.detail) : null,
    c.body ? h('div', { class: 'body' }, c.body) : null,
    c.raw ? h('details', { class: 'raw' }, h('summary', {}, 'All details'), h('pre', { class: 'detail' }, c.raw)) : null,
    h('div', { class: 'choices' }, ...c.choices.map(([label, value, style]) =>
      h('button', { class: `btn ${style || ''}`, onclick: () => command('chat.settle', { id: c.id, value }) }, label))),
    c.note ? h('small', { class: 'note' }, c.note) : null);
}

function messageEl(m) {
  if (m.role === 'user') return h('div', { class: 'msg user' }, h('div', { class: 'bubble' }, m.content));
  const parts = [stepsEl(m)];
  if (m.ask) parts.push(askEl(m));
  if (m.confirm) parts.push(confirmEl(m));
  if (m.content) parts.push(answerEl(m));
  else if (m.pending && !m.steps.length && !m.ask && !m.confirm) parts.push(h('div', { class: 'typing' }, h('i'), h('i'), h('i')));
  if (m.notice) parts.push(h('div', { class: 'notice' }, m.notice));
  if (m.error) parts.push(h('div', { class: 'error' }, m.error));
  if (!m.pending && m.meta) parts.push(h('small', { class: 'meta' }, m.meta));
  return h('div', { class: 'msg assistant' }, ...parts);
}

function emptyEl(chat) {
  if (!chat.ready) return h('div', { class: 'empty' }, h('span', { html: icon('sparkles', 34) }), h('p', {}, 'Set up an AI in Pulse on your computer first: Settings, then AI.'));
  return h('div', { class: 'empty' },
    h('span', { html: icon('sparkles', 34) }),
    h('p', {}, chat.agent ? 'Give Pulse a task. It works in your browser while you watch.' : 'Ask anything about the page you have open.'),
    h('div', { class: 'suggestions' }, ...SUGGESTIONS.map((s) => h('button', { class: 'chip', onclick: () => send(s) }, s))));
}

// Only messages that changed are rebuilt, so a reply being typed in an ask card keeps its text and focus.
function renderMessages(chat) {
  const stick = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_PX;
  if (!chat.messages.length) {
    rendered.length = 0;
    list.replaceChildren(emptyEl(chat));
    return;
  }
  if (!rendered.length) list.replaceChildren();
  chat.messages.forEach((m, i) => {
    const json = JSON.stringify(m);
    if (rendered[i]?.json === json) return;
    const el = messageEl(m);
    if (rendered[i]) rendered[i].el.replaceWith(el);
    else list.append(el);
    rendered[i] = { json, el };
  });
  while (rendered.length > chat.messages.length) rendered.pop().el.remove();
  if (stick) list.scrollTop = list.scrollHeight;
}

const pending = (chat) => lastOf(chat.messages)?.ask || lastOf(chat.messages)?.confirm;
const currentMode = (chat) => modePick || (chat.agent ? 'agent' : 'chat');

function renderComposer(chat) {
  const mode = currentMode(chat);
  modeBox.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === mode);
    b.disabled = chat.busy || (b.dataset.mode === 'agent' && !chat.canAgent);
  });
  const last = lastOf(chat.messages);
  input.placeholder = last?.ask ? 'Type your answer' : chat.busy && chat.agent ? 'Add to the task' : mode === 'agent' ? 'Give Pulse a task' : 'Ask about this page';
  const stop = chat.busy && !input.value.trim();
  sendBtn.innerHTML = icon(stop ? 'stop' : 'arrowUp', 18);
  sendBtn.classList.toggle('stop', stop);
  sendBtn.setAttribute('aria-label', stop ? 'Stop' : 'Send');
}

async function send(text) {
  const t = text.trim();
  if (!t) return;
  const chat = store.chat;
  input.value = '';
  autosize();
  const ok = await command('chat.send', { text: t, mode: chat?.busy ? undefined : currentMode(chat || {}) });
  if (!ok) input.value = t;
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(140, input.scrollHeight)}px`;
}

// Links in answers open in a Pulse tab, then the phone shows that tab.
async function onClick(e) {
  const a = e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (/^https?:/i.test(href) && await command('tab.open', { text: href })) go('screen');
}

export function mount() {
  loadMarkdown();
  list = h('div', { class: 'messages' });
  list.addEventListener('click', onClick);
  input = h('textarea', { class: 'composer-input', rows: 1, placeholder: 'Give Pulse a task', enterkeyhint: 'send' });
  input.addEventListener('input', () => { autosize(); if (store.chat) renderComposer(store.chat); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  sendBtn = h('button', { class: 'send', type: 'button', html: icon('arrowUp', 18) });
  sendBtn.addEventListener('click', () => {
    if (sendBtn.classList.contains('stop')) command('chat.stop');
    else send(input.value);
  });
  modeBox = h('div', { class: 'segmented' },
    h('button', { type: 'button', dataset: { mode: 'chat' } }, 'Ask'),
    h('button', { type: 'button', dataset: { mode: 'agent' } }, 'Agent'));
  modeBox.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b || b.disabled) return;
    modePick = b.dataset.mode;
    if (store.chat) renderComposer(store.chat);
  });
  root = h('section', { class: 'view chat-view' }, list,
    h('div', { class: 'composer' }, modeBox, h('div', { class: 'composer-row' }, input, sendBtn)));
  return root;
}

export function update(part) {
  if (part !== 'chat' || !store.chat) return;
  if (modePick === (store.chat.agent ? 'agent' : 'chat')) modePick = null;
  renderMessages(store.chat);
  renderComposer(store.chat);
}

export const title = () => store.chat?.title || 'Chat';
export const needsYou = () => !!(store.chat && pending(store.chat));

export function shown() {
  list.scrollTop = list.scrollHeight;
}
