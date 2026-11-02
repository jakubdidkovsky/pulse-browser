// Turns a connector tool's raw input into rows a person can read for the approval card:
// JSON strings are unpacked, Notion properties become one row each, technical fields are dropped
// and IDs are replaced by the names seen earlier in the task ("Jakub (jakub@…)").

// Standalone IDs only — never the ones inside links like notion.so/Page-8db9…
const UUID = /(?<![\w/.-])(?:([a-z]+):\/\/)?([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})(?![\w-])/gi;
const KIND_OF = { user: 'person', collection: 'database', page: 'page' };
const TECHNICAL = /^(allow_async|async|request_id|format|timezone|time_zone|send_updates|is_datetime|id|_.*|.*_id)$/i;
const PARENT_KIND = { data_source_id: 'Database', database_id: 'Database', page_id: 'Page', workspace: 'Workspace' };
export const normId = (id) => String(id).toLowerCase().replace(/-/g, '');

// JSON hidden inside strings ("{\"properties\":…}") becomes real objects.
export function deepParse(v) {
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try { return deepParse(JSON.parse(v)); } catch { return v; }
  }
  if (Array.isArray(v)) return v.map(deepParse);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepParse(x)]));
  return v;
}

// Known IDs become names; unknown ones shrink to "person …6dfa54" instead of a 40-character code.
export function resolveIds(text, names = {}) {
  return String(text).replace(UUID, (all, scheme, id) => names[normId(id)] || `${KIND_OF[scheme] || 'ID'} …${id.slice(-6)}`);
}

export function fmtValue(v, names = {}) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map((x) => fmtValue(x, names)).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    if (v.email || v.name) return [v.name, v.email && `<${v.email}>`].filter(Boolean).join(' ');
    if (v.dateTime || v.date) return fmtValue(v.dateTime || v.date, names);
    return Object.entries(v).map(([k, x]) => `${humanize(k)}: ${fmtValue(x, names)}`).join(' · ');
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return s.length > 10 ? d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  return resolveIds(s, names);
}

// "date:Started on:start" → "Started on", "assigned_to" → "Assigned to"
export function humanize(key) {
  const k = String(key).replace(/^date:(.+?):(start|end)$/i, '$1').replace(/[_-]+/g, ' ').trim();
  return k.charAt(0).toUpperCase() + k.slice(1);
}

// Notion-style properties: one row each; a date's start/end become one range.
function propertyRows(props, names) {
  const rows = [];
  const dates = new Map();
  for (const [k, v] of Object.entries(props || {})) {
    const date = /^date:(.+?):(start|end|is_datetime)$/i.exec(k);
    if (date) {
      if (date[2] !== 'is_datetime' && v) dates.set(date[1], { ...dates.get(date[1]), [date[2]]: v });
      continue;
    }
    const value = fmtValue(v, names);
    if (value) rows.push([humanize(k), value]);
  }
  for (const [name, { start, end }] of dates) rows.push([name, [fmtValue(start), fmtValue(end)].filter(Boolean).join(' to ')]);
  return rows;
}

function parentRow(parent, names) {
  if (!parent || typeof parent !== 'object') return null;
  for (const [k, kind] of Object.entries(PARENT_KIND)) {
    if (parent[k]) return ['In', names[normId(parent[k])] || `a ${kind.toLowerCase()}`];
  }
  return null;
}

// Rows for the card plus an optional body text; everything else stays under "All details".
export function readableFields(input, names = {}, { labels = {}, bodyKeys = [] } = {}) {
  const data = deepParse(input || {});
  const rows = [];
  let body = null;
  const pages = Array.isArray(data.pages) ? data.pages : data.pages ? [data.pages] : null;
  const parent = parentRow(data.parent, names);
  if (parent) rows.push(parent);
  if (pages?.length === 1) {
    rows.push(...propertyRows(pages[0].properties, names));
    if (typeof pages[0].content === 'string' && pages[0].content.trim()) body = pages[0].content;
  } else if (pages?.length > 1) {
    rows.push(['Pages', pages.map((p) => fmtValue(p.properties?.Name || p.properties?.title || p.properties?.Title, names)).filter(Boolean).join(', ') || `${pages.length} pages`]);
  }
  if (data.properties && typeof data.properties === 'object') rows.push(...propertyRows(data.properties, names));
  for (const [k, v] of Object.entries(data)) {
    if (['pages', 'parent', 'properties'].includes(k) || v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (!body && bodyKeys.includes(k) && typeof v === 'string') { body = v; continue; }
    if (labels[k]) { rows.push([labels[k], fmtValue(v, names)]); continue; }
    if (TECHNICAL.test(k) || typeof v === 'boolean') continue;
    rows.push([humanize(k), fmtValue(v, names).slice(0, 300)]);
  }
  return { rows: rows.filter(([, v]) => v), body };
}
