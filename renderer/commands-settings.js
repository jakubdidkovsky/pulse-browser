// Settings → Commands: the user's saved slash commands (/order, /reply…), each a set of rules the agent follows when run.
import { S, setSetting } from './state.js';
import { h, uid } from './util.js';
import { icon } from './icons.js';
import { openModal, toast, confirmDialog } from './ui.js';
import { normalizeName, isValidName, INSTRUCTIONS_MAX, DRAFT_SYSTEM, draftPrompt, cleanDraft } from './commands.js';
import { askOnce } from './ai-once.js';

const DESCRIPTION_MAX = 80;
const EXAMPLE = {
  name: 'order',
  description: 'Fill in an order form with my details',
  instructions: [
    'Find the order form on the site I’m on (or open shop.example.com/order).',
    'Fill it in with my details:',
    '- Name: …',
    '- Company: …',
    '- Delivery address: …',
    '- Email and phone: …',
    'Use the items and quantities I write after /order.',
    'Stop before the final submit and show me a short summary to check.',
  ].join('\n'),
};

const commands = () => (Array.isArray(S.settings.ai.commands) ? S.settings.ai.commands : []);
const save = (list) => setSetting('ai.commands', list);

export function commandsSection() {
  const wrap = h('div', {});
  const draw = () => {
    const list = commands();
    const card = h('div', { class: 'set-card' });
    if (!list.length) card.append(h('div', { class: 'empty-note' }, 'No commands yet.'));
    for (const c of list) {
      card.append(h('div', { class: 'set-row' },
        h('div', { class: 'set-label' }, h('span', { class: 'cmd-title' }, `/${c.name}`), h('small', {}, c.description || firstLine(c.instructions))),
        h('div', { class: 'set-control' },
          h('button', { class: 'btn small', onclick: () => editCommand(c, draw) }, 'Edit'),
          h('button', { class: 'icon-btn small', title: 'Delete', html: icon('trash', 13), onclick: () => remove(c, draw) }))));
    }
    wrap.replaceChildren(h('section', { class: 'set-group' },
      h('h4', {}, 'Commands'),
      h('p', { class: 'set-note' }, 'Type / in the AI panel to run a command. Each one is a set of instructions the agent follows every time, like a saved task with your own rules. What you type after the name is added to it, e.g. “/order 2x margherita”.'),
      card,
      h('div', { class: 'cmd-actions' },
        h('button', { class: 'btn small', onclick: () => editCommand(null, draw) }, h('span', { html: icon('plus', 12) }), 'Add Command'),
        list.length ? null : h('button', { class: 'btn small', onclick: () => editCommand(null, draw, EXAMPLE) }, 'Start from an Example'))));
  };
  draw();
  return wrap;
}

function firstLine(text) {
  const line = String(text || '').trim().split('\n')[0];
  return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX)}…` : line;
}

async function remove(c, onDone) {
  const ok = await confirmDialog({ title: `Delete /${c.name}?`, message: 'Its instructions are deleted too.', confirm: 'Delete', danger: true });
  if (!ok) return;
  save(commands().filter((x) => x.id !== c.id));
  onDone();
}

// Problems with the form, in the order the user should fix them; null when it can be saved.
function problem(item, existing) {
  if (!isValidName(item.name)) return ['name', 'Give the command a name, like “order”.'];
  if (commands().some((c) => c.name === item.name && c.id !== existing?.id)) return ['name', `/${item.name} already exists.`];
  if (!item.instructions) return ['instructions', 'Write what the agent should do.'];
  return null;
}

export function editCommand(existing, onDone, template = null) {
  const start = existing || template || {};
  const name = h('input', { class: 'input cmd-name-input', placeholder: 'order', value: start.name || '', spellcheck: 'false', maxlength: 40 });
  const description = h('input', { class: 'input', placeholder: 'Shown in the list when you type /', value: start.description || '', maxlength: DESCRIPTION_MAX });
  const instructions = h('textarea', {
    class: 'input cmd-instructions', rows: 12, maxlength: INSTRUCTIONS_MAX, spellcheck: 'true',
    placeholder: 'What the agent should do, step by step: which site or form, which details to use, and where to stop and ask you.',
  });
  instructions.value = start.instructions || '';
  const count = h('small', { class: 'cmd-count' });
  const showCount = () => { count.textContent = `${instructions.value.length} / ${INSTRUCTIONS_MAX}`; };
  showCount();
  name.addEventListener('blur', () => { name.value = normalizeName(name.value); });

  // "Write with AI": drafts the instructions from the name and description, or turns rough notes into clear steps.
  let drafting = null; // AbortController while the AI writes
  const draftBtn = h('button', { class: 'cmd-draft', type: 'button', onclick: () => draft() });
  const showDraftBtn = () => {
    draftBtn.replaceChildren(
      drafting ? h('span', { class: 'spinner' }) : h('span', { html: icon('sparkles', 13) }),
      drafting ? 'Stop' : instructions.value.trim() ? 'Improve with AI' : 'Write with AI');
    draftBtn.title = drafting ? 'Stop writing' : instructions.value.trim() ? 'Rewrite your notes as clear steps for the agent' : 'Draft the instructions from the name and description';
    instructions.readOnly = !!drafting;
    instructions.classList.toggle('drafting', !!drafting);
  };
  const show = (text) => { instructions.value = text; showCount(); };
  const draft = async () => {
    if (drafting) { drafting.abort(); return; }
    const before = instructions.value;
    const ask = { name: normalizeName(name.value), description: description.value.trim(), instructions: before };
    if (!ask.name && !ask.description && !before.trim()) {
      name.focus();
      toast('Give the command a name or a description first, like “Fill in the order form on shop.example.com”.', { iconName: 'info', timeout: 3200 });
      return;
    }
    drafting = new AbortController();
    showDraftBtn();
    try {
      const text = cleanDraft(await askOnce({
        system: DRAFT_SYSTEM, prompt: draftPrompt(ask), signal: drafting.signal,
        onText: (t) => { show(cleanDraft(t)); instructions.scrollTop = instructions.scrollHeight; },
      }));
      if (!text) throw new Error('The AI sent back nothing. Try again.');
      // Typed in as one edit, so Ctrl+Z brings the earlier text back.
      instructions.readOnly = false;
      show(before);
      instructions.focus();
      instructions.select();
      document.execCommand('insertText', false, text);
      instructions.setSelectionRange(0, 0);
      instructions.scrollTop = 0;
      toast(text.includes('[') ? 'Fill in the parts in [brackets], then save.' : 'Check the instructions, then save.', {
        iconName: 'sparkles', timeout: 6000, action: { label: 'Undo', fn: () => { show(before); showDraftBtn(); } },
      });
    } catch (err) {
      show(before);
      if (err.name !== 'AbortError') toast(err.message, { iconName: 'warn', timeout: 4500 });
    } finally {
      drafting = null;
      showDraftBtn();
    }
  };
  instructions.addEventListener('input', () => { showCount(); showDraftBtn(); });
  showDraftBtn();

  const fields = { name, instructions };
  const submit = () => {
    if (drafting) { toast('Still writing. Wait a moment or press Stop.', { iconName: 'info', timeout: 2200 }); return; }
    const item = {
      id: existing?.id || uid(),
      name: normalizeName(name.value),
      description: description.value.trim().slice(0, DESCRIPTION_MAX),
      instructions: instructions.value.trim().slice(0, INSTRUCTIONS_MAX),
    };
    const issue = problem(item, existing);
    if (issue) { fields[issue[0]].focus(); toast(issue[1], { iconName: 'info', timeout: 2200 }); return; }
    const list = commands();
    save(existing ? list.map((c) => (c.id === existing.id ? item : c)) : [...list, item]);
    m.close();
    onDone?.();
  };

  const m = openModal({
    title: existing ? `Edit /${existing.name}` : 'New Command',
    width: 560,
    onClose: () => drafting?.abort(),
    body: h('div', { class: 'form' },
      h('label', { class: 'field' }, h('span', {}, 'Name'), h('div', { class: 'cmd-name-field' }, h('b', {}, '/'), name)),
      h('label', { class: 'field' }, h('span', {}, 'Description'), description),
      // A div, not a label: a label would pass clicks on its title to the button.
      h('div', { class: 'field' }, h('div', { class: 'cmd-field-head' }, h('span', {}, 'Instructions'), draftBtn), instructions, count),
      h('p', { class: 'set-note' }, 'The agent still asks before paying. Otherwise these instructions count as yours: if they say to send something, it may send without asking first.')),
    footer: [h('div', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: submit }, existing ? 'Save' : 'Add')],
  });
  for (const el of [name, description]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => (start.name ? instructions : name).focus(), 40);
}
