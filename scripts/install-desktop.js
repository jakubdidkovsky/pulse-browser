#!/usr/bin/env node
// Adds Pulse to the Linux app launcher (~/.local/share/applications/pulse.desktop).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'linux') {
  console.log('This helper is for Linux desktops only.');
  process.exit(0);
}
const root = path.resolve(__dirname, '..');
const dir = path.join(os.homedir(), '.local/share/applications');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'pulse.desktop');
fs.writeFileSync(file, `[Desktop Entry]
Type=Application
Name=Pulse
GenericName=Web Browser
Comment=Browser with a built-in AI sidebar
Exec="${process.execPath}" "${path.join(root, 'scripts/start.js')}" %U
Icon=${path.join(root, 'assets/icon.png')}
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=Pulse
`);
console.log(`Installed ${file}`);
console.log('Remove it any time with:  rm ' + file);
