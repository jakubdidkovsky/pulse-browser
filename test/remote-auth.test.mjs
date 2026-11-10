// Unit tests for the phone remote's access rules: networks, pairing codes and paired devices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RemoteAuth, allowedAddress, parseCookies, deviceName, PAIR_CODE_TTL, SESSION_IDLE_MAX } = require('../lib/remote-auth.js');

function memoryAuth(start = 1_000_000) {
  let saved = {};
  let now = start;
  const auth = new RemoteAuth({ load: () => saved, save: (v) => { saved = v; }, now: () => now });
  return { auth, advance: (ms) => { now += ms; }, saved: () => saved };
}

// ---------------------------------------------------------------- networks

const PHONE = '100.101.5.7';
const tailnet = new Set(['100.95.147.111', 'fd7a:115c:a1e0::b401:93e0']);

test('accepts a Tailscale peer on this computer’s Tailscale address', () => {
  assert.equal(allowedAddress('100.95.147.111', PHONE), true);
  assert.equal(allowedAddress('::ffff:100.95.147.111', `::ffff:${PHONE}`), true);
  assert.equal(allowedAddress('fd7a:115c:a1e0::b401:93e0', 'fd7a:115c:a1e0::1'), true);
  assert.equal(allowedAddress('100.95.147.111', PHONE, { tailnet }), true);
});

test('rejects a LAN device that sends packets to the Tailscale address', () => {
  assert.equal(allowedAddress('100.95.147.111', '192.168.1.40'), false);
  assert.equal(allowedAddress('100.95.147.111', '192.168.1.40', { tailnet }), false);
});

test('rejects other 100.64/10 addresses (carrier NAT) once the real Tailscale address is known', () => {
  assert.equal(allowedAddress('100.70.1.2', '100.70.9.9', { tailnet }), false);
});

test('rejects the local network unless it is turned on', () => {
  assert.equal(allowedAddress('192.168.1.250', '192.168.1.40'), false);
  assert.equal(allowedAddress('192.168.1.250', '192.168.1.40', { lan: true }), true);
  assert.equal(allowedAddress('::ffff:10.10.20.195', '::ffff:10.10.20.7', { lan: true }), true);
  assert.equal(allowedAddress('172.20.0.1', '8.8.8.8', { lan: true }), false);
});

test('rejects public and loopback addresses by default', () => {
  assert.equal(allowedAddress('8.8.8.8', '8.8.4.4', { lan: true }), false);
  assert.equal(allowedAddress('100.128.0.1', PHONE), false); // just outside 100.64.0.0/10
  assert.equal(allowedAddress('127.0.0.1', '127.0.0.1', { lan: true }), false);
  assert.equal(allowedAddress('::1', '::1'), false);
  assert.equal(allowedAddress('127.0.0.1', '127.0.0.1', { loopback: true }), true);
  assert.equal(allowedAddress(undefined, undefined), false);
});

// ---------------------------------------------------------------- helpers

test('parses cookies and ignores malformed parts', () => {
  assert.deepEqual(parseCookies('a=1; pulse_remote=abc%3D; broken'), { a: '1', pulse_remote: 'abc=' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('names devices from their user agent', () => {
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'iPhone');
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36'), 'Pixel 9 Pro');
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36'), 'Android phone');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows PC');
  assert.equal(deviceName(''), 'Browser');
});

// ---------------------------------------------------------------- pairing

test('pairs a phone with the current code exactly once', () => {
  const { auth } = memoryAuth();
  const { code } = auth.pairCode();
  const first = auth.pair(code, 'Mozilla/5.0 (iPhone)');
  assert.ok(first.sid);
  assert.equal(first.device.name, 'iPhone');
  assert.equal(auth.pair(code, 'Mozilla/5.0 (iPhone)').error, 'This pairing link was already used or has expired. Show a new one in Pulse.');
  assert.notEqual(auth.pairCode().code, code);
});

test('rejects wrong and expired codes', () => {
  const { auth, advance } = memoryAuth();
  assert.ok(auth.pair('nope', '').error);
  const { code } = auth.pairCode();
  advance(PAIR_CODE_TTL + 1);
  assert.ok(auth.pair(code, '').error);
});

test('stops accepting codes from an address after too many failures, but not from others', () => {
  const { auth } = memoryAuth();
  for (let i = 0; i < 20; i++) auth.pair(`wrong-${i}`, '', '100.70.0.66');
  const { code } = auth.pairCode();
  assert.match(auth.pair(code, '', '100.70.0.66').error, /Too many/);
  assert.ok(auth.pair(code, 'Mozilla/5.0 (iPhone)', PHONE).sid);
});

test('ends sessions of devices unused for a long time', () => {
  const { auth, advance } = memoryAuth();
  const { sid } = auth.pair(auth.pairCode().code, 'Mozilla/5.0 (iPhone)');
  advance(SESSION_IDLE_MAX + 1);
  assert.equal(auth.device(sid), null);
  assert.deepEqual(auth.devices(), []);
});

test('recognises a paired device by its session and stores only a hash', () => {
  const { auth, saved } = memoryAuth();
  const { sid, device } = auth.pair(auth.pairCode().code, 'Mozilla/5.0 (iPad)');
  assert.equal(auth.device(sid).id, device.id);
  assert.equal(auth.device('someone-else'), null);
  assert.equal(auth.device(undefined), null);
  assert.ok(!JSON.stringify(saved()).includes(sid));
});

test('forgetting a device or all devices ends their sessions', () => {
  const { auth } = memoryAuth();
  const a = auth.pair(auth.pairCode().code, 'Mozilla/5.0 (iPhone)');
  const b = auth.pair(auth.pairCode().code, 'Mozilla/5.0 (iPad)');
  auth.forget(a.device.id);
  assert.equal(auth.device(a.sid), null);
  assert.ok(auth.device(b.sid));
  auth.forgetAll();
  assert.equal(auth.device(b.sid), null);
  assert.deepEqual(auth.devices(), []);
});

test('lists devices without their session hashes', () => {
  const { auth } = memoryAuth();
  auth.pair(auth.pairCode().code, 'Mozilla/5.0 (iPhone)');
  const [d] = auth.devices();
  assert.deepEqual(Object.keys(d).sort(), ['created', 'id', 'lastSeen', 'name']);
});
