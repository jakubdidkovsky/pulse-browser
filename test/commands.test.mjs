// Unit tests for saved slash commands: names, parsing "/name details", suggestions and the prompt sent to the model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, isValidName, usableCommands, parseCommand, matchCommands, commandPrompt, commandRules, draftPrompt, cleanDraft, INSTRUCTIONS_MAX } from '../renderer/commands.js';

const ORDER = { name: 'order', description: 'Fill in the supplier order form', instructions: 'Open shop.example.com/order and fill in my details.' };
const ORDERS = { name: 'orders', description: 'Show my past orders', instructions: 'List my orders.' };
const REPLY = { name: 'reply', description: 'Draft an order reply', instructions: 'Draft a reply in my tone.' };
const ALL = [ORDER, ORDERS, REPLY];

test('normalizeName turns a typed label into a command name', () => {
  assert.equal(normalizeName('Order Form'), 'order-form');
  assert.equal(normalizeName('/Objednávka'), 'objednavka');
  assert.equal(normalizeName('  //fill   it! '), 'fill-it');
  assert.equal(normalizeName('-x'), 'x');
  assert.equal(normalizeName('a'.repeat(50)).length, 32);
  assert.equal(normalizeName(null), '');
});

test('isValidName accepts only normalized names', () => {
  assert.ok(isValidName('order'));
  assert.ok(isValidName('order-form_2'));
  assert.ok(!isValidName(''));
  assert.ok(!isValidName('Order'));
  assert.ok(!isValidName('-order'));
  assert.ok(!isValidName('two words'));
  assert.ok(!isValidName(42));
});

test('usableCommands drops broken entries', () => {
  assert.deepEqual(usableCommands(null), []);
  assert.deepEqual(usableCommands([ORDER, null, { name: 'Bad Name', instructions: 'x' }, { name: 'empty', instructions: '  ' }, { name: 'noinstr' }]), [ORDER]);
});

test('parseCommand finds the command and the details typed after it', () => {
  assert.deepEqual(parseCommand('/order 2x margherita', ALL), { command: ORDER, args: '2x margherita' });
  assert.deepEqual(parseCommand('  /ORDER  ', ALL), { command: ORDER, args: '' });
  assert.deepEqual(parseCommand('/reply\nthanks, line two', ALL), { command: REPLY, args: 'thanks, line two' });
});

test('parseCommand ignores text that is not a saved command', () => {
  assert.equal(parseCommand('order 2x margherita', ALL), null);
  assert.equal(parseCommand('/unknown thing', ALL), null);
  assert.equal(parseCommand('/home/jakub/file.txt', ALL), null);
  assert.equal(parseCommand('/order', []), null);
  assert.equal(parseCommand('', ALL), null);
});

test('matchCommands suggests while the name is being typed', () => {
  assert.deepEqual(matchCommands('/', ALL), ALL);
  assert.deepEqual(matchCommands('/ord', ALL), [ORDER, ORDERS, REPLY]); // name prefix first, then the description match
  assert.deepEqual(matchCommands('/rep', ALL), [REPLY]);
  assert.deepEqual(matchCommands('/past', ALL), [ORDERS]);
  assert.deepEqual(matchCommands('/zzz', ALL), []);
});

test('matchCommands stays quiet once the name is done or the text is no command', () => {
  assert.equal(matchCommands('/order ', ALL), null);
  assert.equal(matchCommands('hello', ALL), null);
  assert.equal(matchCommands('/home/jakub', ALL), null);
});

test('commandPrompt sends the saved rules and then the details', () => {
  const prompt = commandPrompt({ command: ORDER, args: '2x margherita' });
  assert.ok(prompt.startsWith('<saved_command name="/order">'));
  assert.ok(prompt.includes(ORDER.instructions));
  assert.ok(prompt.endsWith('</saved_command>\n\n2x margherita'));
  assert.ok(commandPrompt({ command: ORDER, args: '' }).endsWith('Run /order now.'));
  assert.ok(!commandRules(ORDER).includes('Run /order now.'));
});

test('draftPrompt hands over the name, description and notes', () => {
  const withNotes = draftPrompt({ name: 'order', description: 'Order from the supplier', instructions: '  vypln objednavku na shop.cz  ' });
  assert.ok(withNotes.startsWith('Command: /order\nDescription: Order from the supplier\n'));
  assert.ok(withNotes.includes('<notes>\nvypln objednavku na shop.cz\n</notes>'));
  const bare = draftPrompt({ name: '', description: '', instructions: ' ' });
  assert.ok(bare.startsWith('Command: /untitled\n'));
  assert.ok(!bare.includes('Description:'));
  assert.ok(bare.includes('no notes yet'));
});

test('cleanDraft strips fences and long dashes, also mid-stream', () => {
  assert.equal(cleanDraft('```text\n1. Open shop.cz — the order page\n```'), '1. Open shop.cz - the order page');
  assert.equal(cleanDraft('```\n1. Open'), '1. Open');
  assert.equal(cleanDraft('Pages 2–3'), 'Pages 2-3');
  assert.equal(cleanDraft(null), '');
  assert.equal(cleanDraft('x'.repeat(INSTRUCTIONS_MAX + 50)).length, INSTRUCTIONS_MAX);
});
