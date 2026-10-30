// Google Lens: find things that look like an image on a page — visual matches, the same product
// in shops, what something is. Used by "Search Image with Google Lens" and the agent's image_search.
import * as Tabs from './tabs.js';
import { cropOf } from './pointer.js';

// The upload form is posted from a google.com page so the user's Google cookies (consent,
// sign-in) go along; posted from anywhere else Google answers with its consent page instead.
const LAUNCH_URL = 'https://www.google.com/robots.txt';
const UPLOAD_URL = 'https://lens.google.com/v3/upload?ep=ccm&s=&st=';
const READY_TIMEOUT = 10000; // ms
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the google.com page: posts the image to Lens like Chrome's "Search image with Google".
function submitUpload(data, mime, action) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], `image.${mime.split('/')[1] || 'jpg'}`, { type: mime }));
  const form = document.createElement('form');
  form.method = 'POST';
  form.enctype = 'multipart/form-data';
  form.action = action + Date.now();
  const input = document.createElement('input');
  input.type = 'file';
  input.name = 'encoded_image';
  input.files = transfer.files;
  form.appendChild(input);
  document.documentElement.appendChild(form);
  form.submit();
  return true;
}

// Viewport rect of the image (or element) under a point, for the screenshot fallback.
function rectAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const img = el && (el.closest('img,video,canvas,picture,svg') || el);
  if (!img) return null;
  const r = img.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

async function waitReady(tab, max = READY_TIMEOUT) {
  const t0 = Date.now();
  while (Date.now() - t0 < max && Tabs.getTab(tab.id) && (!tab.wv || !tab.ready || tab.loading)) await sleep(80);
}

// Full-size image bytes when the source is reachable, otherwise a crop of what is on screen.
async function imageData({ src, tab, rect }) {
  if (/^https?:/i.test(src || '')) {
    const got = await window.lumen.fetchImage(src).catch(() => null);
    if (got) return got;
  }
  const inline = /^data:(image\/(?:png|jpe?g|webp|gif|bmp));base64,(.+)$/i.exec(src || '');
  if (inline) return { mime: inline[1], data: inline[2] };
  const crop = tab && rect ? await cropOf(tab, rect, 0) : null;
  return crop ? { mime: 'image/jpeg', data: crop } : null;
}

export async function rectOfPoint(tab, x, y) {
  if (!tab?.wv || !tab.ready) return null;
  let z = 1;
  try { z = tab.wv.getZoomFactor() || 1; } catch {}
  return tab.wv.executeJavaScript(`(${rectAt.toString()})(${Number(x) / z}, ${Number(y) / z})`).catch(() => null);
}

// Opens Google Lens results for the image in a new tab and returns that tab.
export async function searchImage({ src, tab, rect, afterId, background = false }) {
  const img = await imageData({ src, tab, rect });
  if (!img) throw new Error('Couldn’t get that image. Scroll it into view and try again.');
  const lens = Tabs.open(LAUNCH_URL, { afterId, background });
  Tabs.ensureWebview(lens);
  await waitReady(lens);
  if (!Tabs.getTab(lens.id) || !lens.ready) throw new Error('Google didn’t load.');
  await lens.wv.executeJavaScript(`(${submitUpload.toString()})(${JSON.stringify(img.data)}, ${JSON.stringify(img.mime)}, ${JSON.stringify(UPLOAD_URL)})`);
  await sleep(400);
  await waitReady(lens, 15000);
  return lens;
}
