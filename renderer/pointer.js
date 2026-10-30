// "Ask AI About This": what the user right-clicked on a page — the element, where it sits and
// what surrounds it — packaged as context for the AI chat and the agent.

const MAX_TEXT = 500;
const CROP_PADDING = 12; // px around the element in the screenshot crop

// Runs inside the page. Finds the element under (x, y) — through open shadow roots and
// same-origin frames — marks it for the agent's snapshot and flashes a highlight.
function inspectAt(x, y) {
  const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  let el = document.elementFromPoint(x, y);
  let ox = 0;
  let oy = 0;
  let frame = '';
  for (let i = 0; i < 6 && el; i++) {
    if (el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x - ox, y - oy);
      if (inner && inner !== el) { el = inner; continue; }
    }
    if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
      frame = el.src || frame;
      let doc = null;
      try { doc = el.contentDocument; } catch {}
      const fr = el.getBoundingClientRect();
      const inner = doc && doc.elementFromPoint(x - ox - fr.left, y - oy - fr.top);
      if (inner) { ox += fr.left; oy += fr.top; el = inner; continue; }
    }
    break;
  }
  if (!el) return null;
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();
  const attr = (n) => el.getAttribute(n);
  const nameOf = (e) => clean(e.getAttribute('aria-label') || e.innerText || e.value || e.getAttribute('alt') || e.getAttribute('title') || e.getAttribute('placeholder'), 120);
  const control = el.closest('a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[contenteditable="true"]');
  const cssPath = (e) => {
    const parts = [];
    for (let n = e; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      let part = n.tagName.toLowerCase();
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { parts.unshift(`${part}#${n.id}`); break; }
      const cls = [...n.classList].filter((c) => /^[A-Za-z][\w-]{1,30}$/.test(c)).slice(0, 2);
      if (cls.length) part += `.${cls.join('.')}`;
      const same = n.parentElement ? [...n.parentElement.children].filter((s) => s.tagName === n.tagName) : [];
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const heading = (() => {
    let best = null;
    for (const hd of [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].slice(0, 400)) {
      if (hd === el || hd.contains(el)) { best = hd; break; }
      if (hd.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = hd;
      else break;
    }
    return best ? clean(best.innerText, 120) : '';
  })();
  const block = el.closest('p,li,td,th,dd,dt,blockquote,pre,figure,article,[role=row],[role=cell],[role=listitem]') || el.parentElement;
  const cell = el.closest('td,th,[role=cell],[role=gridcell]');
  let table = null;
  if (cell) {
    const row = cell.closest('tr,[role=row]');
    const grid = cell.closest('table,[role=table],[role=grid]');
    const idx = row ? [...row.children].indexOf(cell) : -1;
    const head = grid?.querySelector('thead tr') || grid?.querySelector('tr');
    table = { column: idx >= 0 && head && head !== row ? clean(head.children[idx]?.innerText, 80) : '', row: clean(row?.innerText, 300) };
  }
  const media = el.closest('img,video,picture,canvas,svg') || (el.querySelectorAll && el.querySelectorAll('img').length === 1 ? el.querySelector('img') : null);
  const bg = !media && getComputedStyle(el).backgroundImage.match(/url\("?(.*?)"?\)/)?.[1];
  const r = el.getBoundingClientRect();
  const mr = (media || el).getBoundingClientRect();
  doc.querySelectorAll('[data-pulse-pointed]').forEach((n) => n.removeAttribute('data-pulse-pointed'));
  el.setAttribute('data-pulse-pointed', '');
  window.__pulsePointed = el;
  const hl = doc.createElement('div');
  Object.assign(hl.style, {
    position: 'fixed', left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px`,
    border: '2px solid #af52de', borderRadius: '6px', boxShadow: '0 0 0 4px rgba(175,82,222,.25)',
    zIndex: '2147483647', pointerEvents: 'none', transition: 'opacity .6s', opacity: '1',
  });
  (doc.body || doc.documentElement).appendChild(hl);
  setTimeout(() => { hl.style.opacity = '0'; setTimeout(() => hl.remove(), 700); }, 900);
  const box = (b) => ({ x: Math.round(b.left + ox), y: Math.round(b.top + oy), w: Math.round(b.width), h: Math.round(b.height) });
  return {
    tag,
    role: attr('role') || '',
    name: nameOf(control || el),
    text: clean(el.innerText || el.textContent, 500),
    selector: cssPath(el),
    control: control && control !== el ? `${control.tagName.toLowerCase()} "${nameOf(control)}"` : '',
    rect: box(r),
    mediaRect: media || bg ? box(mr) : null,
    scrollY: Math.round(scrollY),
    pageY: Math.round(r.top + oy + scrollY),
    viewport: { w: innerWidth, h: innerHeight },
    pageHeight: document.documentElement.scrollHeight,
    href: el.closest('a[href]')?.href || '',
    src: media?.currentSrc || media?.src || bg || '',
    alt: clean(media?.getAttribute?.('alt'), 200),
    value: (tag === 'input' || tag === 'textarea') && el.type !== 'password' ? clean(el.value, 200) : '',
    attrs: Object.fromEntries(['id', 'class', 'name', 'type', 'placeholder', 'title', 'aria-label', 'data-testid']
      .map((n) => [n, clean(attr(n), 120)]).filter(([, v]) => v)),
    heading,
    context: block && block !== el ? clean(block.innerText, 400) : '',
    table,
    frame,
    url: location.href,
    title: document.title,
  };
}

const zoomOf = (tab) => { try { return tab.wv.getZoomFactor() || 1; } catch { return 1; } };

// Screenshot crop around a viewport rect (CSS px) of the tab, as base64 JPEG.
export async function cropOf(tab, rect, padding = CROP_PADDING) {
  if (!tab?.wcId || !rect) return null;
  const z = zoomOf(tab);
  const x = Math.max(0, (rect.x - padding) * z);
  const y = Math.max(0, (rect.y - padding) * z);
  const crop = { x: Math.round(x), y: Math.round(y), width: Math.round((rect.w + padding * 2) * z), height: Math.round((rect.h + padding * 2) * z) };
  if (crop.width < 4 || crop.height < 4) return null;
  return window.lumen.capture(tab.wcId, crop).catch(() => null);
}

// Inspects what the user right-clicked; `point` comes from the page context menu.
export async function inspect(tab, point) {
  if (!tab?.wv || !tab.ready) return null;
  const z = zoomOf(tab);
  const res = await Promise.race([
    tab.wv.executeJavaScript(`(${inspectAt.toString()})(${Number(point.x) / z}, ${Number(point.y) / z})`).catch(() => null),
    new Promise((r) => setTimeout(() => r(null), 3000)),
  ]);
  if (!res) return null;
  return {
    ...res,
    tabId: tab.id,
    selection: point.selectionText || '',
    image: await cropOf(tab, res.rect),
  };
}

export function label(p) {
  if (p.table?.column && p.name) return `“${p.name.slice(0, 30)}” · ${p.table.column}`;
  const what = p.src && !p.name ? 'image' : p.tag;
  return `${what}${p.name ? ` “${p.name.slice(0, 40)}”` : ''}`;
}

export function describe(p) {
  const lines = [
    '<pointed_element>',
    'The user right-clicked this spot on the page and is asking about it (or wants you to act on it). In browser_snapshot it is marked "← the user pointed at this" when it is interactive.',
    `Page: ${p.title} — ${p.url}`,
    `Element: <${p.tag}>${p.role ? ` role=${p.role}` : ''}${p.name ? ` "${p.name}"` : ''}${p.control ? ` (inside ${p.control})` : ''}`,
    p.text && p.text !== p.name ? `Text: "${p.text.slice(0, MAX_TEXT)}"` : '',
    p.selection ? `Selected text: "${p.selection.slice(0, MAX_TEXT)}"` : '',
    `CSS selector: ${p.selector}`,
    `Position: ${p.rect.x},${p.rect.y} in the visible viewport (${p.viewport.w}×${p.viewport.h}), size ${p.rect.w}×${p.rect.h}; ${p.pageY}px from the top of a ${p.pageHeight}px page (scrolled to ${p.scrollY}px)`,
    p.href ? `Link: ${p.href}` : '',
    p.src ? `Image: ${p.src.startsWith('data:') ? '(embedded image data)' : p.src}${p.alt ? ` — alt "${p.alt}"` : ''}` : '',
    p.value ? `Field value: "${p.value}"` : '',
    Object.keys(p.attrs).length ? `Attributes: ${Object.entries(p.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}` : '',
    p.table ? `Table cell: column "${p.table.column || '?'}"; row: "${p.table.row}"` : '',
    p.heading ? `Section heading: "${p.heading}"` : '',
    p.context ? `Surrounding text: "${p.context}"` : '',
    p.frame ? `Inside an embedded frame: ${p.frame}` : '',
    '</pointed_element>',
  ];
  return lines.filter(Boolean).join('\n');
}

export function clearMark(tab) {
  if (!tab?.wv || !tab.ready) return;
  tab.wv.executeJavaScript('delete window.__pulsePointed; document.querySelectorAll("[data-pulse-pointed]").forEach((n) => n.removeAttribute("data-pulse-pointed"));').catch(() => {});
}
