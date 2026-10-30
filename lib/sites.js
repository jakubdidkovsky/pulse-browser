'use strict';
// Per-website context files, like a CLAUDE.md for every site:
//   ~/Documents/Pulse/sites/<host>/CONTEXT.md        notes the agent (and you) keep about the site
//   ~/Documents/Pulse/sites/<host>/sessions/*.md      full transcripts of agent sessions on that site
const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');

function root() {
  let docs;
  try { docs = app.getPath('documents'); } catch { docs = app.getPath('home'); }
  const dir = path.join(docs, 'Pulse', 'sites');
  // Formerly "Lumen": move the site memory folder over once.
  const old = path.join(docs, 'Lumen', 'sites');
  if (!fs.existsSync(dir) && fs.existsSync(old)) {
    try { fs.mkdirSync(path.dirname(dir), { recursive: true }); fs.renameSync(old, dir); } catch {}
  }
  return dir;
}

function safeHost(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '_').slice(0, 120);
  return h || '_local';
}

function siteDir(host) {
  return path.join(root(), safeHost(host));
}

function contextFile(host) {
  return path.join(siteDir(host), 'CONTEXT.md');
}

function readContext(host) {
  try { return fs.readFileSync(contextFile(host), 'utf8'); } catch { return ''; }
}

function appendNote(host, note) {
  const file = contextFile(host);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `# ${safeHost(host)}\n\nNotes Pulse's agent keeps about this site. You can edit this file.\n\n## Notes\n`);
  }
  const line = `- ${new Date().toISOString().slice(0, 10)}: ${String(note).replace(/\s+/g, ' ').trim()}\n`;
  fs.appendFileSync(file, line);
  return line.trim();
}

// Notes about the user that apply everywhere (default apps, preferences…): ~/Documents/Pulse/MEMORY.md
function generalFile() {
  return path.join(path.dirname(root()), 'MEMORY.md');
}

function readGeneral() {
  try { return fs.readFileSync(generalFile(), 'utf8'); } catch { return ''; }
}

function appendGeneral(note) {
  const file = generalFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '# About me\n\nThings Pulse\'s agent remembers about you and your computer. You can edit this file.\n\n');
  const line = `- ${new Date().toISOString().slice(0, 10)}: ${String(note).replace(/\s+/g, ' ').trim()}\n`;
  fs.appendFileSync(file, line);
  return line.trim();
}

function saveSession(host, id, markdown) {
  const dir = path.join(siteDir(host), 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const safeId = String(id).replace(/[^a-z0-9_-]/gi, '').slice(0, 60);
  // Keep one file per session; prefix with its start date for easy browsing.
  const existing = fs.readdirSync(dir).find((f) => f.endsWith(`-${safeId}.md`));
  const name = existing || `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${safeId}.md`;
  fs.writeFileSync(path.join(dir, name), markdown);
  return path.join(dir, name);
}

function info(host) {
  const dir = siteDir(host);
  let sessions = 0;
  try { sessions = fs.readdirSync(path.join(dir, 'sessions')).length; } catch {}
  const ctx = readContext(host);
  return { dir, root: root(), notes: (ctx.match(/^- /gm) || []).length, sessions };
}

function open(host) {
  const dir = host ? siteDir(host) : path.dirname(root());
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
}

module.exports = { readContext, appendNote, readGeneral, appendGeneral, saveSession, info, open, root };
