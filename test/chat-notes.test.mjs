// Unit tests for Pulse chats saved as Obsidian notes: topics, the note text and writing into a folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { saveNotes, renderNote, topicFor, compileTopics, safeTitle, neutralizeLinks, topicTag, OTHER_TOPIC } = require('../lib/chat-notes.js');

const TOPICS = compileTopics([
  { name: 'Robotika', patterns: ['robot', '\\w*bag\\b'] },
  { name: 'Nákupy', patterns: ['nakup', 'alza'] },
  { name: 'Broken', patterns: ['('] },
]);
const at = (h, m) => new Date(2026, 10, 6, h, m).getTime();
const CHAT = {
  id: 'abc123def456', title: 'najdi mi notebook do 30k', mode: 'agent', site: 'www.alza.cz', created: at(14, 2),
  messages: [
    { role: 'user', text: 'najdi mi notebook do 30k', ts: at(14, 2), context: ['Alza.cz'] },
    { role: 'assistant', who: 'Claude', text: 'Vybral jsem [Lenovo](https://alza.cz/x) a [[Poznamka]].', ts: at(14, 5), steps: ['Opened alza.cz', 'Searched “notebook”'] },
  ],
};
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-notes-'));

test('topics match word starts without diacritics, title and site first', () => {
  assert.deepEqual(TOPICS.map((t) => t.name), ['Robotika', 'Nákupy']); // the invalid rule is left out
  assert.equal(topicFor(CHAT, TOPICS), 'Nákupy'); // from the site
  assert.equal(topicFor({ title: 'x', messages: [{ role: 'user', text: 'Nahraj rosbag z robota' }] }, TOPICS), 'Robotika');
  assert.equal(topicFor({ title: 'notrobot', messages: [] }, TOPICS), OTHER_TOPIC); // not at a word start
  assert.equal(topicFor(CHAT, []), null);
  assert.equal(topicTag('Claude & AI'), 'claude/tema/claude-ai');
  assert.equal(topicTag('Nákupy'), 'claude/tema/nakupy');
});

test('a note has the vault properties, topic link, messages and agent steps', () => {
  const note = renderNote(CHAT, { topics: TOPICS, user: 'Jakub' });
  assert.ok(note.startsWith('---\ntitle: "najdi mi notebook do 30k"\ndate: 2026-11-06T14:02\nzdroj: Pulse (Agent)\nweb: "www.alza.cz"\ntema: Nákupy\npulse_id: abc123def456\ntags:\n  - claude/chat\n  - pulse\n  - claude/tema/nakupy\n---\n'));
  assert.ok(note.includes('\nTéma: [[Nákupy]] · Zdroj: Pulse (Agent) · Web: www.alza.cz\n'));
  assert.ok(note.includes('### Jakub · 14:02\n\n*Kontext: Alza.cz*\n\nnajdi mi notebook do 30k'));
  assert.ok(note.includes('### Claude · 14:05\n\nVybral jsem [Lenovo](https://alza.cz/x) a `[[Poznamka]]`.'));
  assert.ok(note.includes('> [!example]- Kroky agenta (2)\n> - Opened alza.cz\n> - Searched “notebook”'));
  assert.ok(!note.includes('session_id'), 'the Claude Code sync must never mistake it for its own note');
});

test('file names and links are safe', () => {
  assert.equal(safeTitle('a/b: c?  d#'), 'a b c d');
  assert.equal(safeTitle('...'), 'Untitled');
  assert.equal(safeTitle('Reply with ok, nothing else.'), 'Reply with ok, nothing else');
  assert.equal(safeTitle('ž'.repeat(120)).length, 80);
  assert.ok(Buffer.byteLength(safeTitle('😀'.repeat(80))) <= 200);
  assert.equal(neutralizeLinks('see [file](/home/x/a.txt) and [a.txt](a.txt)'), 'see file (`/home/x/a.txt`) and `a.txt`');
  assert.equal(neutralizeLinks('```\n[[keep]]\n```'), '```\n[[keep]]\n```');
});

test('saveNotes writes one note per chat, skips unchanged ones and keeps other notes', () => {
  const dir = tmpDir();
  const other = path.join(dir, '2026-11-06 najdi mi notebook do 30k.md');
  fs.writeFileSync(other, '---\ntitle: "x"\nsession_id: 1234\n---\n');
  assert.equal(saveNotes(dir, [CHAT], { topics: TOPICS, user: 'Jakub' }), 1);
  const ours = path.join(dir, '2026-11-06 najdi mi notebook do 30k (abc123de).md'); // the name was taken
  assert.ok(fs.readFileSync(ours, 'utf8').includes('pulse_id: abc123def456'));
  assert.equal(fs.readFileSync(other, 'utf8'), '---\ntitle: "x"\nsession_id: 1234\n---\n');
  assert.equal(saveNotes(dir, [CHAT], { topics: TOPICS, user: 'Jakub' }), 0);
  const longer = { ...CHAT, messages: [...CHAT.messages, { role: 'user', text: 'a levnejsi?', ts: at(14, 9) }] };
  assert.equal(saveNotes(dir, [longer], { topics: TOPICS, user: 'Jakub' }), 1);
  assert.ok(fs.readFileSync(ours, 'utf8').includes('a levnejsi?'));
  assert.deepEqual(fs.readdirSync(dir).sort(), [path.basename(other), path.basename(ours)].sort());
});

test('saveNotes refuses a missing folder and ignores malformed chats', () => {
  assert.throws(() => saveNotes('relative/dir', [CHAT]), /Choose a folder/);
  assert.throws(() => saveNotes(path.join(os.tmpdir(), 'pulse-no-such-dir-xyz'), [CHAT]), /doesn’t exist/);
  const dir = tmpDir();
  assert.equal(saveNotes(dir, [null, { id: '../evil', messages: [] }, { id: 'ok', messages: 'x' }], { topics: [] }), 0);
  assert.deepEqual(fs.readdirSync(dir), []);
});
