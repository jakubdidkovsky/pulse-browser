'use strict';
// The phone's live view of a tab: JPEG frames of the page, and taps, scrolling and typing sent into it.
// Only tabs of the main window qualify (the renderer reports them), never Pulse's own UI or private windows.
const crypto = require('node:crypto');
const { webContents } = require('electron');

const FRAME_QUALITY = 62;
const MIN_WIDTH = 320;
const MAX_WIDTH = 1600;
const DEFAULT_WIDTH = 900;
const MAX_TEXT = 2000;
const MAX_SCROLL = 4; // screens per scroll event
const KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Up', 'Down', 'Left', 'Right', 'PageUp', 'PageDown']);

let allowed = new Set();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

function setTabs(ids) {
  allowed = new Set(ids.filter(Number.isInteger));
}

function contentsOf(id) {
  if (!allowed.has(id)) return null;
  const wc = webContents.fromId(id);
  return wc && !wc.isDestroyed() ? wc : null;
}

// Same picture as last time (same ETag): 304, so an idle page costs almost nothing to watch.
async function frame(id, width, etag) {
  const wc = contentsOf(id);
  if (!wc) return { status: 404 };
  const img = await wc.capturePage();
  if (img.isEmpty()) return { status: 204 };
  const w = Math.round(clamp(width || DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH));
  const jpeg = (img.getSize().width > w ? img.resize({ width: w, quality: 'good' }) : img).toJPEG(FRAME_QUALITY);
  const tag = `"${crypto.createHash('sha1').update(jpeg).digest('base64url').slice(0, 20)}"`;
  return tag === etag ? { status: 304, etag: tag } : { status: 200, etag: tag, jpeg };
}

// The phone sends fractions of the picture (0..1); input events take CSS pixels times the page zoom.
// No user gesture: reading the size must not grant the page user activation.
async function viewport(wc) {
  const [w, h] = await wc.executeJavaScript('[innerWidth, innerHeight]', false);
  const z = wc.getZoomFactor();
  return { w: w * z, h: h * z };
}

function press(wc, keyCode) {
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
}

// Returns an error message for the phone, or null when the input was delivered.
async function input(id, ev) {
  const wc = contentsOf(id);
  if (!wc) return 'This tab isn’t open any more.';
  if (ev.type === 'tap') {
    const v = await viewport(wc);
    const at = { x: Math.round(clamp(ev.fx, 0, 1) * v.w), y: Math.round(clamp(ev.fy, 0, 1) * v.h) };
    wc.sendInputEvent({ type: 'mouseMove', ...at });
    wc.sendInputEvent({ type: 'mouseDown', ...at, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', ...at, button: 'left', clickCount: 1 });
    return null;
  }
  if (ev.type === 'scroll') {
    // dx/dy follow DOM wheel events (positive = scroll down/right); Chromium's input events use the opposite sign.
    const v = await viewport(wc);
    wc.sendInputEvent({
      type: 'mouseWheel',
      x: Math.round(clamp(ev.fx, 0, 1) * v.w),
      y: Math.round(clamp(ev.fy, 0, 1) * v.h),
      deltaX: -Math.round(clamp(ev.dx, -MAX_SCROLL, MAX_SCROLL) * v.w),
      deltaY: -Math.round(clamp(ev.dy, -MAX_SCROLL, MAX_SCROLL) * v.h),
      canScroll: true,
    });
    return null;
  }
  if (ev.type === 'text') {
    if (typeof ev.text !== 'string' || !ev.text) return 'Nothing to type.';
    wc.insertText(ev.text.slice(0, MAX_TEXT));
    return null;
  }
  if (ev.type === 'key') {
    if (!KEYS.has(ev.key)) return 'That key isn’t supported.';
    press(wc, ev.key);
    return null;
  }
  return 'Unknown input.';
}

module.exports = { setTabs, frame, input };
