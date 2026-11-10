'use strict';
// Pulse chats as Markdown notes in a folder the user picks (Settings → AI → Save chats to Obsidian).
// The notes follow the format of Jakub's Claude Code chat sync (~/.claude/obsidian-sync), so both kinds sit side by
// side in the vault: the same properties (title, date, zdroj, tema), topic tags and a "Téma: [[…]]" link that puts the
// chat into its topic note. Topics come from that sync's own rules file when it exists.
// Pure Node (no Electron) so it can be unit tested.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOPICS_FILE = path.join(os.homedir(), '.claude', 'obsidian-sync', 'temata.json');
const OTHER_TOPIC = 'Ostatní'; // the sync's topic for chats that match no rule
const TOPIC_TAG_PREFIX = 'claude/tema/';
const FIRST_MESSAGE_CHARS = 300; // topic rules look at the start of the first message when the title says nothing
const TITLE_MAX_CHARS = 80;
const TITLE_MAX_BYTES = 200; // + date, "(id)" and ".md" stays under the 255-byte file name limit
const HEADER_BYTES = 2048; // where a note's pulse_id is looked for
const ID_SUFFIX_CHARS = 8;
const STEPS_MAX = 80; // agent steps listed under one answer
const UNTITLED = 'Untitled';
const UNSAFE_FILENAME = /[\\/:*?"<>|#^[\]\x00-\x1f\x7f]/g;
const FENCE_SPLIT = /(```[\s\S]*?```)/;
const MARKDOWN_LINK = /!?\[([^\]\n]*)\]\(([^)\s]+)\)/g;
const WIKILINK = /!?\[\[([^\]\n]+)\]\]/g;
const WEB_LINK = /^(https?:|mailto:|#)/;

// ---- topics (the same matching as chat_topics.py: rules match word starts in text without diacritics)

const fold = (text) => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

const topicTag = (name) => TOPIC_TAG_PREFIX + fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// [{ name, patterns: [regex source] }] → [{ name, re }]; a rule that isn't a valid JS regex is left out.
function compileTopics(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((t) => {
    const patterns = Array.isArray(t?.patterns) ? t.patterns.filter((p) => typeof p === 'string' && p) : [];
    if (typeof t?.name !== 'string' || !t.name.trim() || !patterns.length) return [];
    try {
      return [{ name: t.name.trim(), re: new RegExp(patterns.map((p) => `(?<![a-z0-9])(?:${p})`).join('|')) }];
    } catch {
      return [];
    }
  });
}

let topicsCache = { mtime: -1, topics: [] };
function loadTopics(file = TOPICS_FILE) {
  try {
    const { mtimeMs } = fs.statSync(file);
    if (mtimeMs !== topicsCache.mtime) topicsCache = { mtime: mtimeMs, topics: compileTopics(JSON.parse(fs.readFileSync(file, 'utf8'))) };
    return topicsCache.topics;
  } catch {
    return [];
  }
}

// The first topic whose rule matches the title and site, else the start of the first message; null without rules.
function topicFor(chat, topics) {
  if (!topics.length) return null;
  const first = (chat.messages || []).find((m) => m.role === 'user')?.text || '';
  for (const text of [`${chat.title || ''} ${chat.site || ''}`, first.slice(0, FIRST_MESSAGE_CHARS)]) {
    const folded = fold(text);
    const hit = topics.find((t) => t.re.test(folded));
    if (hit) return hit.name;
  }
  return OTHER_TOPIC;
}

// ---- rendering

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (ts) => (Number.isFinite(ts) ? `${pad(new Date(ts).getHours())}:${pad(new Date(ts).getMinutes())}` : '');

function safeTitle(title) {
  const cleaned = String(title || '').replace(UNSAFE_FILENAME, ' ').split(/\s+/).join(' ').trim().replace(/^\.+/, '');
  let out = [...cleaned].slice(0, TITLE_MAX_CHARS).join('');
  while (Buffer.byteLength(out) > TITLE_MAX_BYTES) out = [...out].slice(0, -1).join('');
  return out.replace(/[.\s]+$/, '') || UNTITLED; // no "Title..md", and Windows drops trailing dots anyway
}

// Links to files and [[wikilinks]] in chat text become code, so they don't add empty notes to the graph.
function neutralizeLinks(text) {
  return String(text).split(FENCE_SPLIT).map((part) => (part.startsWith('```') ? part : part
    .replace(WIKILINK, '`[[$1]]`')
    .replace(MARKDOWN_LINK, (all, label, target) => {
      if (WEB_LINK.test(target)) return all;
      const shown = label.trim();
      return !shown || shown === target || shown === target.split('/').pop() ? `\`${target}\`` : `${shown} (\`${target}\`)`;
    }))).join('');
}

function renderMessage(m, user) {
  const who = m.role === 'user' ? user : (m.who || 'Claude');
  const time = clock(m.ts);
  const body = [];
  if (m.role === 'user' && m.context?.length) body.push(`*Kontext: ${m.context.join(', ')}*`);
  if (m.text?.trim()) body.push(neutralizeLinks(m.text.trim()));
  if (m.steps?.length) {
    const shown = m.steps.slice(0, STEPS_MAX);
    const more = m.steps.length - shown.length;
    body.push([`> [!example]- Kroky agenta (${m.steps.length})`, ...shown.map((s) => `> - ${String(s).replace(/\n/g, ' ')}`),
      ...(more > 0 ? [`> - … a dalších ${more}`] : [])].join('\n'));
  }
  if (m.error) body.push(`*Chyba: ${String(m.error).replace(/\n+/g, ' ')}*`);
  return `### ${who}${time ? ` · ${time}` : ''}\n\n${body.join('\n\n')}`;
}

// chat: { id, title, mode, site, created, messages: [{ role, who, text, ts, steps: [label], context: [label], error }] }
function renderNote(chat, { topics = [], user = 'Me' } = {}) {
  const topic = topicFor(chat, topics);
  const source = chat.mode === 'agent' ? 'Pulse (Agent)' : 'Pulse (Ask)';
  const created = new Date(chat.created || Date.now());
  const properties = [
    '---',
    `title: ${JSON.stringify(String(chat.title || '').trim() || UNTITLED)}`,
    `date: ${localDate(created)}T${clock(created.getTime())}`,
    `zdroj: ${source}`,
    ...(chat.site ? [`web: ${JSON.stringify(chat.site)}`] : []),
    ...(topic ? [`tema: ${topic}`] : []),
    `pulse_id: ${chat.id}`,
    'tags:',
    '  - claude/chat',
    '  - pulse',
    ...(topic ? [`  - ${topicTag(topic)}`] : []),
    '---',
  ];
  const header = [topic ? `Téma: [[${topic}]]` : '', `Zdroj: ${source}`, chat.site ? `Web: ${chat.site}` : ''].filter(Boolean).join(' · ');
  const body = (chat.messages || []).map((m) => renderMessage(m, user)).join('\n\n');
  return `${properties.join('\n')}\n\n${header}\n\n${body}\n`;
}

// ---- writing

function noteId(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const text = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEADER_BYTES, 0));
    return /^pulse_id: (.+)$/m.exec(text.split('\n---')[0])?.[1].trim() || null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// pulse_id → file name, for the notes already in the folder.
function indexNotes(folder) {
  const index = new Map();
  for (const name of fs.readdirSync(folder)) {
    if (!name.endsWith('.md')) continue;
    const id = noteId(path.join(folder, name));
    if (id) index.set(id, name);
  }
  return index;
}

// "2026-11-06 Title.md", with the chat's id added when another note already has that name.
function noteName(folder, chat, existing) {
  const base = `${localDate(new Date(chat.created || Date.now()))} ${safeTitle(chat.title)}`;
  const plain = `${base}.md`;
  const file = path.join(folder, plain);
  if (plain === existing || !fs.existsSync(file) || noteId(file) === String(chat.id)) return plain;
  return `${base} (${String(chat.id).slice(0, ID_SUFFIX_CHARS)}).md`;
}

function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

const validChat = (c) => c && typeof c === 'object' && /^[\w-]{1,64}$/.test(String(c.id)) && Array.isArray(c.messages);

// Writes or updates one note per chat. Returns how many notes changed.
function saveNotes(folder, chats, { topics = loadTopics(), user = 'Me' } = {}) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Choose a folder for the notes in Settings → AI.');
  if (!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`The notes folder ${folder} doesn’t exist anymore. Choose another in Settings → AI.`);
  const index = indexNotes(folder);
  let saved = 0;
  for (const chat of (Array.isArray(chats) ? chats : []).filter(validChat)) {
    const existing = index.get(String(chat.id));
    const name = noteName(folder, chat, existing);
    const file = path.join(folder, name);
    const text = renderNote(chat, { topics, user });
    if (name === existing && fs.readFileSync(file, 'utf8') === text) continue;
    writeAtomic(file, text);
    if (existing && existing !== name) fs.rmSync(path.join(folder, existing), { force: true });
    index.set(String(chat.id), name);
    saved += 1;
  }
  return saved;
}

// The user's first name for the "### Jakub · 14:02" headings: the account name, capitalized.
function userName() {
  try {
    const name = os.userInfo().username.split(/[._-]/)[0];
    return name ? name[0].toUpperCase() + name.slice(1) : 'Me';
  } catch {
    return 'Me';
  }
}

// Where notes go when the user turns this on: the vault's Claude chats folder, else the vault, else nothing.
function defaultFolder(home = os.homedir()) {
  const vault = path.join(home, 'Documents', 'Obsidian Vault');
  return [path.join(vault, 'Claude', 'Chaty'), vault].find((d) => fs.statSync(d, { throwIfNoEntry: false })?.isDirectory()) || '';
}

module.exports = { saveNotes, renderNote, topicFor, compileTopics, loadTopics, safeTitle, neutralizeLinks, topicTag, userName, defaultFolder, OTHER_TOPIC };
