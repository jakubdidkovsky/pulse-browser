// Saved slash commands: typing "/order 2x margherita" runs the instructions the user wrote for /order in Settings.
// Pure helpers without DOM or settings access, so they can be unit tested.

export const NAME_MAX = 32;
export const INSTRUCTIONS_MAX = 8000; // characters; every run sends them to the model, so they cost tokens each time
const NAME = /^[a-z0-9][a-z0-9_-]*$/;
const INVOCATION = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/;

// "Order Form" -> "order-form", "/Objednávka" -> "objednavka".
export function normalizeName(raw) {
  return String(raw || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^\/+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[-_]+/, '')
    .slice(0, NAME_MAX);
}

export const isValidName = (name) => typeof name === 'string' && name.length <= NAME_MAX && NAME.test(name);

// Settings can hold anything after a hand edit or an older version: keep only usable commands.
export function usableCommands(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((c) => c && isValidName(c.name) && typeof c.instructions === 'string' && c.instructions.trim());
}

// The saved command a message starts with, and what was typed after it.
export function parseCommand(text, commands = []) {
  const m = INVOCATION.exec(String(text || '').trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  const command = usableCommands(commands).find((c) => c.name === name);
  return command ? { command, args: (m[2] || '').trim() } : null;
}

// Suggestions while the command name is being typed ("/or" -> /order): name prefix matches first, then the rest.
// Returns null when the text isn't a command name in progress, so the caller can close its menu.
export function matchCommands(text, commands = []) {
  const m = /^\/([^\s/]*)$/.exec(String(text || ''));
  if (!m) return null;
  const query = normalizeName(m[1]);
  const all = usableCommands(commands);
  const starts = all.filter((c) => c.name.startsWith(query));
  const contains = all.filter((c) => !c.name.startsWith(query) && (c.name.includes(query) || String(c.description || '').toLowerCase().includes(query)));
  return [...starts, ...contains];
}

// The command's standing rules as the model sees them.
export function commandRules(command) {
  return [
    `<saved_command name="/${command.name}">`,
    `The user's own standing instructions for their command /${command.name}. Follow them for this task:`,
    command.instructions.trim().slice(0, INSTRUCTIONS_MAX),
    '</saved_command>',
  ].join('\n');
}

// What the model receives for "/name details": the rules, then the details typed this time.
export function commandPrompt({ command, args }) {
  return `${commandRules(command)}\n\n${args || `Run /${command.name} now.`}`;
}

// ---- "Write with AI" in the command editor: one request that drafts or tidies the instructions.
// Kept short on purpose: whatever it writes is sent to the agent on every run of the command.
export const DRAFT_SYSTEM = `You write the instructions for a saved command in Pulse, a web browser whose AI agent opens pages, clicks, types and fills in forms in the user's own signed-in tabs. When the user types /name, optionally followed by details, the agent gets these instructions as the user's own standing rules for the task.

Write instructions the agent can follow without guessing:
- Short numbered steps: which site or page to use (a URL when known), what to find, what to fill in or do, and when the task is done.
- Keep every fact the user gave (sites, names, addresses, amounts, tone, rules). Never invent personal details: where one is needed but unknown, write a placeholder in square brackets, like [delivery address], for the user to fill in.
- Say how to use the details typed after the command name (items, recipient, date) and what to do when none are given.
- The agent always asks before paying. Before submitting a form, sending a message or deleting anything, it stops and shows a short summary to confirm, unless the user's notes clearly say to go ahead without asking.
- Under 180 words. Plain text, no Markdown headings or bold, no preamble or closing remarks: reply with the instructions only.
- Write in the language of the user's notes or description; English when they wrote neither.
- Never use long dashes as punctuation; use commas, periods, colons or parentheses.`;

// The drafting request: the name, the description and the notes the user already typed.
export function draftPrompt({ name, description, instructions }) {
  const notes = String(instructions || '').trim();
  return [
    `Command: /${name || 'untitled'}`,
    description ? `Description: ${String(description).trim()}` : null,
    notes
      ? `The user's notes so far. Turn them into clear instructions and keep every fact:\n<notes>\n${notes.slice(0, INSTRUCTIONS_MAX)}\n</notes>`
      : 'The user has written no notes yet: draft the instructions from the name and description.',
  ].filter(Boolean).join('\n');
}

// The model's reply as instructions, also while it is still streaming: no code fence, no long dashes, within the limit.
export function cleanDraft(text) {
  return String(text || '')
    .replace(/^\s*```[^\n]*\n/, '')
    .replace(/\n?```\s*$/, '')
    .replace(/\s*—\s*/g, ' - ')
    .replace(/–/g, '-')
    .trim()
    .slice(0, INSTRUCTIONS_MAX);
}
