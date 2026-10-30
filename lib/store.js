'use strict';
// Tiny JSON-file persistence with debounced, atomic writes.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let dir = null;
const cache = new Map();
const pending = new Map();

function dataDir() {
  if (!dir) {
    dir = path.join(app.getPath('userData'), 'data');
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function file(name) {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`Invalid store name: ${name}`);
  return path.join(dataDir(), `${name}.json`);
}

function read(name, fallback = null) {
  if (cache.has(name)) return cache.get(name);
  let value = fallback;
  try {
    value = JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    // missing or corrupt file: start fresh
  }
  cache.set(name, value);
  return value;
}

function flushOne(name) {
  const timer = pending.get(name);
  if (timer) clearTimeout(timer);
  pending.delete(name);
  const target = file(name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache.get(name)));
  fs.renameSync(tmp, target);
}

function write(name, value, delay = 300) {
  cache.set(name, value);
  if (pending.has(name)) clearTimeout(pending.get(name));
  pending.set(name, setTimeout(() => {
    try { flushOne(name); } catch (err) { console.error('store write failed', name, err); }
  }, delay));
}

function flush() {
  for (const name of [...pending.keys()]) {
    try { flushOne(name); } catch (err) { console.error('store flush failed', name, err); }
  }
}

module.exports = { read, write, flush, dataDir };
