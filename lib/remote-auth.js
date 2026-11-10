'use strict';
// Who may use the phone remote: the network a request came in on, one-time pairing codes and paired devices.
// Pure Node (no Electron) so it can be unit tested.
const crypto = require('node:crypto');

const PAIR_CODE_TTL = 15 * 60 * 1000; // a pairing link works for 15 minutes, and only once
const MAX_FAILED_PAIRS = 20; // wrong codes allowed per window before pairing is refused
const FAILED_PAIR_WINDOW = 10 * 60 * 1000;
const LAST_SEEN_SAVE_MS = 5 * 60 * 1000; // how often "last used" is written to disk
const SESSION_IDLE_MAX = 90 * 24 * 3600 * 1000; // a phone unused this long has to pair again
const MAX_DEVICES = 20;
const MAX_TRACKED_ADDRESSES = 1000;
const COOKIE = 'pulse_remote';

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

function ipv4(addr) {
  const a = String(addr || '').replace(/^::ffff:/i, '');
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(a) ? a.split('.').map(Number) : null;
}

// Tailscale gives devices addresses in 100.64.0.0/10 and fd7a:115c:a1e0::/48.
function isTailscale(addr) {
  const v4 = ipv4(addr);
  if (v4) return v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127;
  return /^fd7a:115c:a1e0:/i.test(String(addr || ''));
}

function isPrivateLan(addr) {
  const v4 = ipv4(addr);
  if (v4) return v4[0] === 10 || (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) || (v4[0] === 192 && v4[1] === 168);
  const a = String(addr || '').toLowerCase();
  return a.startsWith('fe80:') || (/^f[cd]/.test(a) && !isTailscale(a));
}

function isLoopback(addr) {
  const v4 = ipv4(addr);
  return v4 ? v4[0] === 127 : addr === '::1';
}

const plainAddress = (addr) => String(addr || '').replace(/^::ffff:/i, '').toLowerCase();

// Both ends must be on the same allowed network. The local end alone isn't enough: Linux accepts packets for
// any of its addresses on any interface, so a LAN device could aim at the Tailscale address directly.
// `tailnet` holds this computer's real Tailscale addresses once known, which rules out carrier NAT (also 100.64/10).
function allowedAddress(localAddress, remoteAddress, { lan = false, loopback = false, tailnet = null } = {}) {
  const local = plainAddress(localAddress);
  const ownTailscale = tailnet?.size ? tailnet.has(local) : isTailscale(local);
  if (ownTailscale && isTailscale(remoteAddress)) return true;
  if (lan && isPrivateLan(local) && isPrivateLan(remoteAddress)) return true;
  return loopback && isLoopback(local) && isLoopback(remoteAddress);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {}
  }
  return out;
}

function deviceName(ua = '') {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  const model = (ua.match(/Android [\d.]+; ([^;)]+)\)/) || [])[1]?.trim();
  if (model && model.length > 1) return model;
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux computer';
  return 'Browser';
}

// Hashing first makes both sides the same length, which timingSafeEqual needs.
const sameSecret = (a, b) => crypto.timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const publicDevice = ({ id, name, created, lastSeen }) => ({ id, name, created, lastSeen });

class RemoteAuth {
  // load() returns the saved { devices: [{ id, key, name, created, lastSeen }] }; save(data) persists it.
  constructor({ load, save, now = Date.now }) {
    this.load = load;
    this.save = save;
    this.now = now;
    this.code = null; // { code, expires }
    this.failures = new Map(); // address -> when it tried wrong codes; per address so nobody can lock others out
  }

  #recentFailures(from, now) {
    const list = (this.failures.get(from) || []).filter((t) => now - t < FAILED_PAIR_WINDOW);
    if (this.failures.size > MAX_TRACKED_ADDRESSES) this.failures.clear();
    this.failures.set(from, list);
    return list;
  }

  #stored() {
    const data = this.load() || {};
    return Array.isArray(data.devices) ? data.devices : [];
  }

  #write(devices) {
    this.save({ devices });
  }

  pairCode() {
    if (!this.code || this.code.expires <= this.now()) this.code = { code: randomToken(), expires: this.now() + PAIR_CODE_TTL };
    return { ...this.code };
  }

  newCode() {
    this.code = null;
    return this.pairCode();
  }

  pair(code, userAgent, from = '') {
    const now = this.now();
    const failures = this.#recentFailures(plainAddress(from), now);
    if (failures.length >= MAX_FAILED_PAIRS) return { error: 'Too many wrong pairing attempts. Try again in a few minutes.' };
    const valid = this.code && this.code.expires > now && typeof code === 'string' && sameSecret(code, this.code.code);
    if (!valid) {
      failures.push(now);
      return { error: 'This pairing link was already used or has expired. Show a new one in Pulse.' };
    }
    this.code = null; // single use: the next phone gets a new link
    const sid = randomToken();
    const key = hash(sid);
    const device = { id: key.slice(0, 12), key, name: deviceName(userAgent), created: now, lastSeen: now };
    this.#write([device, ...this.#stored()].slice(0, MAX_DEVICES));
    return { sid, device: publicDevice(device) };
  }

  device(sid) {
    if (!sid || typeof sid !== 'string') return null;
    const key = hash(sid);
    const devices = this.#stored();
    const found = devices.find((d) => d.key === key);
    if (!found) return null;
    const now = this.now();
    if (now - found.lastSeen > SESSION_IDLE_MAX) {
      this.#write(devices.filter((d) => d !== found));
      return null;
    }
    if (now - found.lastSeen > LAST_SEEN_SAVE_MS) this.#write(devices.map((d) => (d === found ? { ...d, lastSeen: now } : d)));
    return publicDevice(found);
  }

  devices() {
    return this.#stored().map(publicDevice);
  }

  forget(id) {
    this.#write(this.#stored().filter((d) => d.id !== id));
  }

  forgetAll() {
    this.code = null;
    this.#write([]);
  }
}

module.exports = { RemoteAuth, allowedAddress, isTailscale, isPrivateLan, plainAddress, parseCookies, deviceName, COOKIE, PAIR_CODE_TTL, SESSION_IDLE_MAX };
