// Unit tests for address autocomplete: pinned pages first, then the sites and pages visited most.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkIndex, completeLink, leftPinnedSite, returnsToPin } from '../renderer/link-complete.js';

const visits = (url, n, ts = 1) => Array.from({ length: n }, () => ({ url, title: url, ts }));
const INDEX = linkIndex({
  pinned: [
    { id: 'p1', url: 'https://mail.google.com/mail/u/0/#inbox', label: 'Gmail' },
    { id: 'p2', url: 'https://www.notion.so/', label: 'Notion' },
    { id: 'p3', url: 'chrome://settings', label: 'Broken' },
  ],
  history: [
    ...visits('https://github.com/jakubdidkovsky/pulse-browser', 3, 5),
    ...visits('https://github.com/', 2, 4),
    ...visits('https://gitlab.com/x', 1, 9),
    ...visits('https://www.alza.cz/notebooky', 2, 3),
    ...visits('http://localhost:5173/app', 1, 2),
    { url: 'lumen:start', ts: 1 },
  ],
});

test('pinned pages win and fill in their full address', () => {
  const link = completeLink(INDEX, 'mai');
  assert.equal(link.rest, 'l.google.com/mail/u/0/#inbox');
  assert.equal(link.url, 'https://mail.google.com/mail/u/0/#inbox');
  assert.equal(link.id, 'p1');
  assert.equal(completeLink(INDEX, 'https://www.no').rest, 'tion.so'); // scheme and www are skipped
  assert.equal(INDEX.pins.length, 2, 'a pin that is not a web page is left out');
});

test('history fills in the most visited site, then pages once a path is typed', () => {
  const site = completeLink(INDEX, 'gi');
  assert.equal(site.rest, 'thub.com'); // 5 visits beat gitlab's 1
  assert.equal(site.url, 'https://github.com/');
  assert.equal(completeLink(INDEX, 'gitl').rest, 'ab.com');
  assert.equal(completeLink(INDEX, 'github.com/j').rest, 'akubdidkovsky/pulse-browser');
  assert.equal(completeLink(INDEX, 'alza.cz/').url, 'https://www.alza.cz/notebooky');
  assert.equal(completeLink(INDEX, 'loc').rest, 'alhost:5173');
  assert.equal(completeLink(INDEX, 'GI').rest, 'thub.com', 'case does not matter');
});

test('searches are left alone', () => {
  assert.equal(completeLink(INDEX, 'g'), null, 'one letter');
  assert.equal(completeLink(INDEX, 'git hub'), null, 'spaces');
  assert.equal(completeLink(INDEX, 'github.com'), null, 'nothing left to add');
  assert.equal(completeLink(INDEX, 'pocasi'), null);
  assert.equal(completeLink(INDEX, ''), null);
  assert.equal(completeLink(linkIndex(), 'gi'), null);
});

test('a pinned page also matches its name, without filling the field', () => {
  const link = completeLink(INDEX, 'gma');
  assert.equal(link.rest, '');
  assert.equal(link.id, 'p1');
  assert.equal(completeLink(INDEX, 'gm'), null, 'names need three letters');
  assert.equal(completeLink(INDEX, 'gma.'), null, 'an address is never matched by name');
});

test('a pinned page goes back home only when its tab left the site or is the tab being typed in', () => {
  const pinnedUrl = 'https://github.com/orgs/REVEL-Robotics/repositories';
  const drive = 'https://drive.google.com/drive/folders/abc';
  assert.equal(leftPinnedSite(pinnedUrl, drive), true);
  assert.equal(leftPinnedSite(pinnedUrl, 'https://www.github.com/orgs/REVEL-Robotics/x'), false);
  assert.equal(leftPinnedSite(null, drive), false, 'not a pin');
  assert.equal(returnsToPin({ pinnedUrl, tabUrl: drive, active: false }), true, 'wandered off: bring it back');
  assert.equal(returnsToPin({ pinnedUrl, tabUrl: drive, active: true }), true);
  assert.equal(returnsToPin({ pinnedUrl, tabUrl: 'https://github.com/REVEL-Robotics/x', active: false }), false, 'same site: just switch');
  assert.equal(returnsToPin({ pinnedUrl, tabUrl: 'https://github.com/REVEL-Robotics/x', active: true }), true, 'typed in its own tab');
  assert.equal(returnsToPin({ pinnedUrl, tabUrl: pinnedUrl, active: true }), false, 'already there');
});
