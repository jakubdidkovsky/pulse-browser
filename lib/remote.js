'use strict';
// Phone remote: a small web app (remote/) served over Tailscale, or the local network when allowed in Settings.
// It shows Pulse's tabs, the AI chat and a live picture of the page, and sends taps, typing and tasks back.
// Tabs and chat live in the main window's renderer: it pushes their state here and runs the phone's commands.
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { ipcMain, powerSaveBlocker } = require('electron');
const qrcode = require('qrcode-generator');
const store = require('./store');
const screen = require('./remote-screen');
const { RemoteAuth, allowedAddress, isTailscale, isPrivateLan, plainAddress, parseCookies, COOKIE } = require('./remote-auth');

const PORT = Number(process.env.LUMEN_REMOTE_PORT) || 7311; // override lets a test instance run next to Pulse
const ROOT = path.join(__dirname, '..');
const COMMAND_TIMEOUT = 15000;
const HEARTBEAT_MS = 25000;
const MAX_BODY = 64 * 1024;
const TAILSCALE_CACHE_MS = 30000;
const TAILSCALE_TIMEOUT = 3000;
const COOKIE_MAX_AGE = 90 * 24 * 3600; // seconds, same as the server-side idle limit
const TAILNET_REFRESH_MS = 5 * 60 * 1000;
const MAX_CLIENT_BUFFER = 4 * 1024 * 1024; // bytes queued for a stalled phone before it's dropped
const PARTS = ['tabs', 'chat'];

const VENDOR = {
  'marked.js': 'node_modules/marked/lib/marked.esm.js',
  'purify.js': 'node_modules/dompurify/dist/purify.es.mjs',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/manifest+json', '.png': 'image/png' };
const PAGE_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// Commands the phone may send to the renderer, with the fields each one takes.
const COMMANDS = {
  'tab.activate': ['id'], 'tab.close': ['id'], 'tab.open': ['text'], 'tab.navigate': ['text'],
  'tab.back': [], 'tab.forward': [], 'tab.reload': [],
  'chat.send': ['text', 'mode'], 'chat.answer': ['id', 'text'], 'chat.settle': ['id', 'value'], 'chat.stop': [], 'chat.new': [],
};
const FIELDS = {
  id: (v) => typeof v === 'string' && v.length > 0 && v.length <= 64,
  text: (v) => typeof v === 'string' && v.length <= 8000,
  mode: (v) => v === undefined || v === 'agent' || v === 'chat',
  value: (v) => [true, false, 'all', 'allow', 'task', 'always'].includes(v),
};

let deps = null; // { mainWindow: () => BrowserWindow | null, notify: (channel, ...args) => void }
let auth = null;
let server = null;
let listenError = '';
let cfg = { enabled: false, lan: false, awake: false };
let awakeId = null;
let heartbeat = null;
let seq = 0;
const clients = new Set(); // { res, device }
const state = { tabs: null, chat: null }; // JSON strings from the renderer
const waiting = new Map(); // command id -> { resolve, timer }
let tailscale = { at: 0, info: null };
let tailnet = new Set(); // this computer's own Tailscale addresses, once known
let tailnetTimer = null;

const policy = () => ({ lan: cfg.lan, loopback: !!process.env.LUMEN_REMOTE_LOOPBACK, tailnet });
const allowedSocket = (socket) => !!socket && allowedAddress(socket.localAddress, socket.remoteAddress, policy());

// What reached the server last, so Settings can tell "the phone can't reach this computer" from "it was refused".
const CONTACT_QUIET_MS = 60 * 1000; // a contact after this long of silence is news worth refreshing Settings for
let lastContact = null; // { at, address }
let lastRefused = null; // { at, address }

function noteContact(socket, refused) {
  const entry = { at: Date.now(), address: plainAddress(socket?.remoteAddress) };
  const prev = refused ? lastRefused : lastContact;
  if (refused) lastRefused = entry;
  else lastContact = entry;
  if (!prev || prev.address !== entry.address || entry.at - prev.at > CONTACT_QUIET_MS) deps.notify('remote:changed');
}

// Only IP addresses: a page whose domain is re-pointed at this computer (DNS rebinding) never matches,
// and the session cookie stays tied to the IP instead of a name that other apps on this machine also serve.
function allowedHost(header) {
  const host = String(header || '').replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1');
  return net.isIP(host) !== 0;
}

// ---------------------------------------------------------------- responses

function json(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data), ...headers });
  res.end(data);
}

const ok = (res, data = null, headers) => json(res, 200, { ok: true, data, error: null }, headers);
const fail = (res, status, error, headers) => json(res, status, { ok: false, data: null, error }, headers);

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function fileFor(route) {
  if (route === '/') return path.join(ROOT, 'remote', 'index.html');
  if (route === '/icon.png') return path.join(ROOT, 'assets', 'icon.png');
  if (route.startsWith('/vendor/')) return Object.hasOwn(VENDOR, route.slice(8)) ? path.join(ROOT, VENDOR[route.slice(8)]) : null;
  const name = route.slice(1);
  return /^[a-z][a-z0-9-]*\.(js|css|json)$/.test(name) ? path.join(ROOT, 'remote', name) : null;
}

function serveFile(route, res) {
  const file = fileFor(route);
  if (!file) return fail(res, 404, 'Not found');
  fs.readFile(file, (err, data) => {
    if (err) { fail(res, 404, 'Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...PAGE_HEADERS });
    res.end(data);
  });
}

// ---------------------------------------------------------------- live state (server-sent events)

function broadcast(event, data) {
  const stalled = [];
  for (const c of clients) {
    if (c.res.writableLength > MAX_CLIENT_BUFFER) stalled.push(c);
    else c.res.write(`event: ${event}\ndata: ${data}\n\n`);
  }
  if (stalled.length) drop((c) => stalled.includes(c)); // it reconnects and gets the current state
}

const clientInfo = () => [clients.size, [...new Set([...clients].map((c) => c.device.name))]];

function clientsChanged() {
  const w = deps.mainWindow();
  if (w && !w.isDestroyed()) w.webContents.send('remote:clients', ...clientInfo());
  deps.notify('remote:changed');
  if (clients.size && !heartbeat) heartbeat = setInterval(() => broadcast('ping', '{}'), HEARTBEAT_MS);
  if (!clients.size && heartbeat) { clearInterval(heartbeat); heartbeat = null; }
}

function events(req, res, device) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ device: device.name })}\n\n`);
  for (const part of PARTS) if (state[part]) res.write(`event: ${part}\ndata: ${state[part]}\n\n`);
  const client = { res, device };
  clients.add(client);
  clientsChanged();
  req.on('close', () => { clients.delete(client); clientsChanged(); });
}

function drop(match) {
  for (const c of [...clients]) {
    if (!match(c)) continue;
    clients.delete(c);
    c.res.end();
    c.res.socket?.destroy();
  }
  clientsChanged();
}

// ---------------------------------------------------------------- renderer commands

function toRenderer(cmd) {
  const w = deps.mainWindow();
  if (!w || w.isDestroyed()) return Promise.resolve({ ok: false, error: 'Pulse has no window open.' });
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { waiting.delete(id); resolve({ ok: false, error: 'Pulse didn’t answer in time.' }); }, COMMAND_TIMEOUT);
    waiting.set(id, { resolve, timer });
    w.webContents.send('remote:cmd', id, cmd);
  });
}

function validCommand(body) {
  if (typeof body?.type !== 'string' || !Object.hasOwn(COMMANDS, body.type)) return null;
  const fields = COMMANDS[body.type];
  const cmd = { type: body.type };
  for (const f of fields) {
    if (!FIELDS[f](body[f])) return null;
    if (body[f] !== undefined) cmd[f] = body[f];
  }
  return cmd;
}

async function command(req, res) {
  const cmd = validCommand(await readJson(req));
  if (!cmd) return fail(res, 400, 'Unknown or malformed command.');
  const result = await toRenderer(cmd);
  return result?.ok ? ok(res, result.data ?? null) : fail(res, 409, result?.error || 'That didn’t work.');
}

async function input(req, res) {
  const body = await readJson(req);
  const error = await screen.input(Number(body.wc), body);
  return error ? fail(res, 409, error) : ok(res);
}

async function frame(url, req, res) {
  const out = await screen.frame(Number(url.searchParams.get('wc')), Number(url.searchParams.get('w')), req.headers['if-none-match']);
  if (out.status !== 200) {
    res.writeHead(out.status, { 'Cache-Control': 'no-store', ...(out.etag ? { ETag: out.etag } : {}) });
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': out.jpeg.length, 'Cache-Control': 'no-store', ETag: out.etag });
  res.end(out.jpeg);
}

// ---------------------------------------------------------------- pairing

const sessionCookie = (sid, maxAge) => `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

async function pair(req, res) {
  const body = await readJson(req);
  const result = auth.pair(body.code, req.headers['user-agent'] || '', req.socket.remoteAddress);
  if (result.error) return fail(res, 403, result.error);
  deps.notify('remote:device', { name: result.device.name, event: 'paired' });
  deps.notify('remote:changed');
  return ok(res, { device: result.device.name }, { 'Set-Cookie': sessionCookie(result.sid, COOKIE_MAX_AGE) });
}

// ---------------------------------------------------------------- HTTP routing

async function handle(req, res) {
  if (!allowedSocket(req.socket)) { noteContact(req.socket, true); req.socket.destroy(); return; }
  noteContact(req.socket, false);
  if (!allowedHost(req.headers.host)) return fail(res, 421, 'Open Pulse Remote by the address shown in Pulse Settings.');
  const url = new URL(req.url, 'http://pulse.invalid');
  const route = url.pathname;
  if (!route.startsWith('/api/')) return req.method === 'GET' ? serveFile(route, res) : fail(res, 405, 'Method not allowed');
  // A custom header can't be sent cross-site without a CORS preflight, which this server never allows.
  if (req.method === 'POST' && req.headers['x-pulse'] !== '1') return fail(res, 403, 'Forbidden');
  if (route === '/api/pair' && req.method === 'POST') return pair(req, res);

  const device = auth.device(parseCookies(req.headers.cookie)[COOKIE]);
  if (!device) return fail(res, 401, 'This phone isn’t paired with Pulse.');
  if (route === '/api/me' && req.method === 'GET') return ok(res, { device: device.name });
  if (route === '/api/events' && req.method === 'GET') return events(req, res, device);
  if (route === '/api/frame' && req.method === 'GET') return frame(url, req, res);
  if (route === '/api/command' && req.method === 'POST') return command(req, res);
  if (route === '/api/input' && req.method === 'POST') return input(req, res);
  if (route === '/api/unpair' && req.method === 'POST') {
    auth.forget(device.id);
    drop((c) => c.device.id === device.id);
    return ok(res, null, { 'Set-Cookie': sessionCookie('', 0) });
  }
  return fail(res, 404, 'Not found');
}

function onRequest(req, res) {
  handle(req, res).catch((err) => {
    console.error('remote request failed', req.url, err);
    if (!res.headersSent) fail(res, 400, err.message === 'Invalid JSON' || err.message === 'Request too large' ? err.message : 'Something went wrong in Pulse.');
    else res.end();
  });
}

// ---------------------------------------------------------------- server lifecycle

function start(host = '::') {
  const s = http.createServer(onRequest);
  // Refuse other networks before reading a single byte.
  s.on('connection', (socket) => {
    if (allowedSocket(socket)) return;
    noteContact(socket, true);
    socket.destroy();
  });
  s.on('error', (err) => {
    if (server !== s) return;
    server = null;
    if (host === '::' && (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')) { start('0.0.0.0'); return; }
    listenError = err.code === 'EADDRINUSE' ? `Port ${PORT} is already used by another app.` : err.message;
    deps.notify('remote:changed');
  });
  server = s;
  s.listen(PORT, host, () => { listenError = ''; deps.notify('remote:changed'); });
  refreshTailnet();
  if (!tailnetTimer) tailnetTimer = setInterval(refreshTailnet, TAILNET_REFRESH_MS);
}

function refreshTailnet() {
  tailscale.at = 0;
  tailscaleInfo().catch(() => {});
}

function stop() {
  clearInterval(tailnetTimer);
  tailnetTimer = null;
  drop(() => true);
  if (server) {
    server.close();
    server.closeAllConnections?.();
  }
  server = null;
  listenError = '';
}

function keepAwake(on) {
  if (on && awakeId === null) awakeId = powerSaveBlocker.start('prevent-app-suspension');
  if (!on && awakeId !== null) { powerSaveBlocker.stop(awakeId); awakeId = null; }
}

// Called with settings.remote at startup and whenever settings are saved.
function sync(remote = {}) {
  const next = { enabled: !!remote.enabled, lan: !!remote.lan, awake: !!remote.awake };
  const prev = cfg;
  cfg = next;
  if (next.enabled && !server) start();
  if (!next.enabled && server) stop();
  if (prev.lan && !next.lan) drop((c) => !allowedSocket(c.res.socket));
  keepAwake(next.enabled && next.awake);
  if (prev.enabled !== next.enabled || prev.lan !== next.lan || prev.awake !== next.awake) deps.notify('remote:changed');
}

// ---------------------------------------------------------------- status for Settings

function tailscaleCli() {
  if (process.platform === 'darwin') return ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
  return ['tailscale'];
}

function runJson(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: TAILSCALE_TIMEOUT, windowsHide: true }, (err, stdout) => {
      if (err) { resolve(null); return; }
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

// Containers, VMs and VPNs have private addresses a phone on the Wi-Fi can't reach.
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|lxc|lxd|podman|cni|flannel|zt|tun|tap|wg|utun|tailscale)/i;

function interfaceAddresses() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list || []).map((a) => ({ ...a, name })))
    .filter((a) => !a.internal && a.family === 'IPv4');
}

const wifiAddresses = () => interfaceAddresses().filter((a) => !VIRTUAL_INTERFACE.test(a.name) && isPrivateLan(a.address)).map((a) => a.address);

const PHONE_OS = /^(ios|android)$/i;

// This computer in the tailnet, plus whether any phone is in it: without one, the pairing link can't open.
async function tailscaleInfo() {
  if (Date.now() - tailscale.at < TAILSCALE_CACHE_MS) return tailscale.info;
  const ip = interfaceAddresses().map((a) => a.address).find(isTailscale) || null;
  let info = ip ? { ip, name: null, login: null, phones: null, phonesOnline: null } : null;
  for (const bin of tailscaleCli()) {
    const st = await runJson(bin, ['status', '--json']);
    if (!st) continue;
    const self = st.Self || {};
    const ips = (self.TailscaleIPs || []).map((a) => String(a).toLowerCase());
    const v4 = ips.find((a) => a.includes('.'));
    if (st.BackendState === 'Running' && (v4 || ip)) {
      // Phones of another Tailscale account this computer is shared with count too (they appear as ShareeNode).
      const phones = Object.values(st.Peer || {}).filter((p) => PHONE_OS.test(p.OS || ''));
      info = {
        ip: v4 || ip,
        name: (self.DNSName || '').replace(/\.$/, '') || null,
        login: st.User?.[String(self.UserID)]?.LoginName || null,
        phones: phones.length,
        phonesOnline: phones.filter((p) => p.Online).length,
      };
      tailnet = new Set(ips);
    }
    break;
  }
  tailscale = { at: Date.now(), info };
  return info;
}

function qrImage(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return `data:image/svg+xml;base64,${Buffer.from(qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true })).toString('base64')}`;
}

async function status() {
  const ts = await tailscaleInfo();
  const wifi = cfg.lan ? wifiAddresses() : [];
  // IPs, not the MagicDNS name: Tailscale Serve/Funnel can publish other apps under that name, and
  // cookies aren't separated by port, so the session cookie would reach them too.
  const hosts = [...(ts?.ip ? [{ via: 'tailscale', host: ts.ip }] : []), ...(wifi.length ? [{ via: 'wifi', host: wifi[0] }] : [])];
  const running = !!server?.listening;
  const code = cfg.enabled && running && hosts.length ? auth.pairCode() : null;
  // One code for every way in: it still works only once.
  const links = code ? hosts.map(({ via, host }) => {
    const pairLink = `http://${host}:${PORT}/#pair=${code.code}`;
    return { via, url: `http://${host}:${PORT}/`, pairLink, qr: qrImage(pairLink) };
  }) : [];
  const online = new Set([...clients].map((c) => c.device.id));
  return {
    ...cfg,
    running,
    error: listenError,
    port: PORT,
    tailscale: ts,
    links,
    pairExpires: code?.expires || null,
    lastContact,
    lastRefused,
    devices: auth.devices().map((d) => ({ ...d, online: online.has(d.id) })),
  };
}

// ---------------------------------------------------------------- setup

function init({ mainWindow, notify }) {
  deps = { mainWindow, notify };
  auth = new RemoteAuth({ load: () => store.read('remote', null), save: (v) => store.write('remote', v) });
  const fromMain = (e) => { const w = mainWindow(); return !!w && !w.isDestroyed() && e.sender === w.webContents; };

  ipcMain.on('remote:state', (e, part, data) => {
    if (!fromMain(e) || !PARTS.includes(part) || typeof data !== 'string') return;
    state[part] = data;
    if (part === 'tabs') {
      try { screen.setTabs((JSON.parse(data).tabs || []).map((t) => t.wc)); } catch {}
    }
    broadcast(part, data);
  });
  ipcMain.on('remote:reply', (e, id, result) => {
    if (!fromMain(e)) return;
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    clearTimeout(w.timer);
    w.resolve(result);
  });
  // Settings and the bridge exist only in the main window; private windows get nothing (not even the pairing link).
  const mainOnly = (fn) => (e, ...args) => {
    if (!fromMain(e)) throw new Error('Not available in this window.');
    return fn(...args);
  };
  ipcMain.handle('remote:status', mainOnly(() => status()));
  // A phone can reconnect before the window has loaded; the window asks once it's ready.
  ipcMain.handle('remote:clients', mainOnly(() => clientInfo()));
  ipcMain.handle('remote:forget', mainOnly((id) => {
    auth.forget(String(id));
    drop((c) => c.device.id === String(id));
    return status();
  }));
  ipcMain.handle('remote:forget-all', mainOnly(() => {
    auth.forgetAll();
    drop(() => true);
    return status();
  }));
  ipcMain.handle('remote:new-code', mainOnly(() => {
    auth.newCode();
    return status();
  }));
}

function shutdown() {
  keepAwake(false);
  stop();
}

module.exports = { init, sync, shutdown, PORT };
