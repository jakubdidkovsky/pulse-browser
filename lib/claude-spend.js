// What every Claude Code session on this computer used, read from its own transcripts
// (~/.claude/projects/**/*.jsonl). The plan limit is only reported for the whole account, so Pulse
// compares its own share of this spend with the account's utilization. Nothing leaves the computer.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const MAX_FILES = 2000;
const files = new Map(); // path -> { offset, mtimeMs, seen: Set<message id>, rows: [ts, model, input, output, cacheRead, cacheWrite][] }

function listFiles(dir, since, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, since, out);
    else if (e.name.endsWith('.jsonl')) {
      try { if (fs.statSync(p).mtimeMs >= since) out.push(p); } catch { /* removed meanwhile */ }
    }
  }
  return out;
}

// Reads only what was appended since last time (transcripts only grow).
async function update(file) {
  const st = fs.statSync(file);
  let f = files.get(file);
  if (!f || st.size < f.offset) f = { offset: 0, mtimeMs: 0, seen: new Set(), rows: [] };
  if (st.mtimeMs === f.mtimeMs && st.size === f.offset) return f;
  const buf = await new Promise((resolve, reject) => {
    const chunks = [];
    fs.createReadStream(file, { start: f.offset, end: Math.max(f.offset, st.size - 1) })
      .on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
  });
  const end = buf.lastIndexOf(0x0a) + 1; // a half-written last line waits for the next read
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const m = j.message;
    const u = m?.usage;
    if (j.type !== 'assistant' || !u || !m.id || f.seen.has(m.id) || m.model === '<synthetic>') continue;
    f.seen.add(m.id);
    f.rows.push([Date.parse(j.timestamp) || st.mtimeMs, m.model || '', u.input_tokens || 0, u.output_tokens || 0, u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0]);
  }
  const next = { ...f, offset: f.offset + end, mtimeMs: st.mtimeMs };
  files.set(file, next);
  return next;
}

// Token totals per model between since and until (ms).
async function spend(since, until = Date.now()) {
  const models = {};
  for (const file of listFiles(ROOT, since)) {
    let f;
    try { f = await update(file); } catch { continue; }
    for (const [ts, model, input, output, cacheRead, cacheWrite] of f.rows) {
      if (ts < since || ts > until) continue;
      const t = models[model] || (models[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      t.input += input;
      t.output += output;
      t.cacheRead += cacheRead;
      t.cacheWrite += cacheWrite;
    }
  }
  return models;
}

module.exports = { spend };
