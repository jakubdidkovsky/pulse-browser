// Settings → AI → Chat Notes: save every Pulse chat as a Markdown note in a folder, e.g. an Obsidian vault.
// The notes are written by lib/chat-notes.js through exportChatNotes() in renderer/ai.js.
import { S, setSetting, PRIVATE } from './state.js';
import { h } from './util.js';
import { toggle, toast } from './ui.js';
import { exportChatNotes } from './ai.js';

const LABEL_MAX_CHARS = 36;
const shortPath = (p) => String(p || '').replace(/^\/home\/[^/]+|^\/Users\/[^/]+/, '~');
// "~/Documents/Obsidian Vault/Claude/Chaty" → "…/Obsidian Vault/Claude/Chaty" when it's too long for the button.
function folderLabel(p) {
  const full = shortPath(p);
  if (full.length <= LABEL_MAX_CHARS) return full;
  const parts = full.split('/');
  let tail = parts.pop();
  while (parts.length && `…/${parts.at(-1)}/${tail}`.length <= LABEL_MAX_CHARS) tail = `${parts.pop()}/${tail}`;
  return tail.length > LABEL_MAX_CHARS ? `…${tail.slice(-LABEL_MAX_CHARS)}` : `…/${tail}`;
}

async function pickFolder() {
  const start = S.settings.ai.notesFolder || await window.lumen.notes.defaultFolder();
  return window.lumen.pickFolder(start || undefined);
}

async function saveAll() {
  const res = await exportChatNotes({ all: true });
  if (!res.ok) toast(res.error, { iconName: 'warn', timeout: 5000 });
  else toast(res.saved ? `Saved ${res.saved} ${res.saved === 1 ? 'chat' : 'chats'} to ${folderLabel(S.settings.ai.notesFolder)}` : 'Your notes are up to date.', { iconName: 'check', timeout: 3500 });
}

export function chatNotesGroup(redraw) {
  const on = !!S.settings.ai.saveNotes;
  const turn = async (want) => {
    if (want && !S.settings.ai.notesFolder) {
      const folder = (await window.lumen.notes.defaultFolder()) || await pickFolder();
      if (!folder) { redraw(); return; }
      setSetting('ai.notesFolder', folder);
    }
    setSetting('ai.saveNotes', want);
    redraw();
    if (want) saveAll();
  };
  const choose = async () => {
    const folder = await pickFolder();
    if (!folder) return;
    setSetting('ai.notesFolder', folder);
    redraw();
    saveAll();
  };
  const row = (label, control, help) => h('div', { class: 'set-row' },
    h('div', { class: 'set-label' }, h('span', {}, label), help ? h('small', {}, help) : null),
    h('div', { class: 'set-control' }, control));
  return h('section', { class: 'set-group' },
    h('h4', {}, 'Chat Notes'),
    h('div', { class: 'set-card' },
      row('Save chats to Obsidian', toggle(on, turn),
        PRIVATE ? 'Private windows never save chats.'
          : 'Every Ask and Agent chat becomes a Markdown note that keeps up as the chat goes on. Notes get the same topics as your Claude Code chats in Obsidian. Deleting a chat in Pulse keeps its note, and private windows are never saved.'),
      on ? row('Folder', h('button', { class: 'btn small', title: `${S.settings.ai.notesFolder}\nClick to choose another folder`, onclick: choose }, folderLabel(S.settings.ai.notesFolder) || 'Choose…')) : null));
}
