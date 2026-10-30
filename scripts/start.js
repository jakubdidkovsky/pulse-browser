#!/usr/bin/env node
// Launches Pulse. On Linux distros that restrict unprivileged user namespaces
// (Ubuntu 24.04+), Chromium's sandbox needs a setuid helper; if it isn't set up
// we fall back to --no-sandbox and tell the user how to fix it (`npm run fix-sandbox`).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
let electron;
try {
  electron = require('electron');
} catch {
  console.error('Electron is missing. Run: npm install');
  process.exit(1);
}
if (typeof electron !== 'string' || !fs.existsSync(electron)) {
  console.log('Downloading Electron…');
  require('node:child_process').execFileSync(process.execPath, [path.join(root, 'node_modules/electron/install.js')], { stdio: 'inherit' });
  delete require.cache[require.resolve('electron')];
  electron = require('electron');
}

const args = [root, ...process.argv.slice(2)];

if (process.platform === 'linux') {
  const helper = path.join(path.dirname(electron), 'chrome-sandbox');
  let restricted = false;
  try {
    restricted = fs.readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1';
  } catch {}
  let helperOk = false;
  try {
    const st = fs.statSync(helper);
    helperOk = st.uid === 0 && (st.mode & 0o4000) !== 0;
  } catch {}
  if (restricted && !helperOk) {
    console.log('ℹ︎  Chromium sandbox helper is not set up on this system; starting without it.');
    console.log('   For full sandboxing run once:  npm run fix-sandbox');
    args.push('--no-sandbox');
  }
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, args, { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 0));
