// SF-Symbols-like line icons (24×24, stroke = currentColor).
const P = {
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUpDown: '<path d="m8 9.5 4-4 4 4"/><path d="m8 14.5 4 4 4-4"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  reload: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9.5 4v16"/>',
  board: '<rect x="3.5" y="4" width="17" height="12.5" rx="2"/><path d="m8.5 20.5 3.5-4 3.5 4"/><path d="m7.5 12.5 3-3 2.2 2.2 3.8-3.8"/>',
  minus: '<path d="M5.5 18.5 18.5 5.5"/>',
  arrowRight: '<path d="M5.5 18.5 18.5 5.5"/><path d="M10 5.5h8.5V14"/>',
  circle: '<ellipse cx="12" cy="12" rx="8.5" ry="7"/>',
  textT: '<path d="M5.5 7V5h13v2"/><path d="M12 5v14"/><path d="M9.5 19h5"/>',
  sticky: '<path d="M4.5 4.5h15v9.5l-5.5 5.5H4.5z"/><path d="M14 19.5V14h5.5"/>',
  eraser: '<path d="m7.5 19.5-3.6-3.6a1.6 1.6 0 0 1 0-2.2l9.6-9.6a1.6 1.6 0 0 1 2.2 0l4.1 4.1a1.6 1.6 0 0 1 0 2.2l-9.1 9.1"/><path d="M7.5 19.5h12"/><path d="m8.8 8.6 6.6 6.6"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  fit: '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
  chart: '<path d="M4 20h16"/><path d="M7 16v-5"/><path d="M12 16V7"/><path d="M17 16v-8"/>',
  square: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>',
  splitCols: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M12 4.5v15"/>',
  splitRows: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 12h17"/>',
  splitGrid: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M12 4.5v15"/><path d="M3.5 12h17"/>',
  puzzle: '<path d="M10 5.5a2 2 0 1 1 4 0V7h3.5a1 1 0 0 1 1 1v3.5H17a2 2 0 1 0 0 4h1.5V19a1 1 0 0 1-1 1H14v-1.5a2 2 0 1 0-4 0V20H6.5a1 1 0 0 1-1-1v-3.5H7a2 2 0 1 0 0-4H5.5V8a1 1 0 0 1 1-1H10Z"/>',
  sparkles: '<path d="M10 3.5c.5 3.6 2.4 5.5 6 6-3.6.5-5.5 2.4-6 6-.5-3.6-2.4-5.5-6-6 3.6-.5 5.5-2.4 6-6Z"/><path d="M18 14.5c.25 1.8 1.2 2.75 3 3-1.8.25-2.75 1.2-3 3-.25-1.8-1.2-2.75-3-3 1.8-.25 2.75-1.2 3-3Z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folderPlus: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="M9 13h6"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  globe: '<circle cx="12" cy="12" r="9.5"/><path d="M12 2.5a14.5 14.5 0 0 0 0 19 14.5 14.5 0 0 0 0-19"/><path d="M2.5 12h19"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  more: '<circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/>',
  compose: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  page: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/>',
  volume: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 18.4a9 9 0 0 0 0-12.8"/>',
  mute: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  float: '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor" stroke="none"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  key: '<circle cx="7.5" cy="15.5" r="5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  layers: '<path d="m12 2 9.5 5L12 12 2.5 7Z"/><path d="m2.5 12 9.5 5 9.5-5"/><path d="m2.5 17 9.5 5 9.5-5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  zoom: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/><path d="M8 11h6"/><path d="M11 8v6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M6 9h.01"/><path d="M10 9h.01"/><path d="M14 9h.01"/><path d="M18 9h.01"/><path d="M7 15h10"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2z"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  cursor: '<path d="M4.5 3.5 19 10.2l-6.3 2-2.1 6.3Z"/><path d="m13 13 5.5 5.5"/>',
  scroll: '<path d="m8 6 4-4 4 4"/><path d="M12 2v20"/><path d="m8 18 4 4 4-4"/>',
  warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  agent: '<path d="M4.5 3.5 19 10.2l-6.3 2-2.1 6.3Z"/><path d="M19 15.5c.25 1.8 1.2 2.75 3 3-1.8.25-2.75 1.2-3 3-.25-1.8-1.2-2.75-3-3 1.8-.25 2.75-1.2 3-3Z"/>',
  mask: '<path d="M2 9.5C2 7 3.5 6 6 6c2 0 3.5 1 6 1s4-1 6-1c2.5 0 4 1 4 3.5 0 3.5-2 7.5-5.5 7.5-2.2 0-3-2-4.5-2s-2.3 2-4.5 2C4 17 2 13 2 9.5Z"/><circle cx="7.5" cy="11" r="1.6" fill="currentColor"/><circle cx="16.5" cy="11" r="1.6" fill="currentColor"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  quote:'<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2H4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .01-1 1.03V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2h-4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
};

export function icon(name, size = 16, cls = '') {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function iconEl(name, size = 16, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = icon(name, size, cls);
  return t.content.firstChild;
}

// Provider brand marks (simplified, not official logos).
const LOGOS = {
  claude: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#D97757"/><g stroke="#fff" stroke-width="2.1" stroke-linecap="round"><path d="M12 5.2v13.6M5.2 12h13.6M7.2 7.2l9.6 9.6M16.8 7.2l-9.6 9.6"/></g></svg>`,
  openai: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#0f0f0f"/><g fill="none" stroke="#fff" stroke-width="1.7"><ellipse cx="12" cy="12" rx="6.2" ry="3.1"/><ellipse cx="12" cy="12" rx="6.2" ry="3.1" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="6.2" ry="3.1" transform="rotate(120 12 12)"/></g></svg>`,
  gemini: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8df8"/><stop offset="1" stop-color="#a66ef5"/></linearGradient></defs><rect width="24" height="24" rx="6" fill="#fff" stroke="rgba(0,0,0,.08)"/><path d="M12 4c.5 4.2 3.3 7 8 8-4.7 1-7.5 3.8-8 8-.5-4.2-3.3-7-8-8 4.7-1 7.5-3.8 8-8Z" fill="url(#gg)"/></svg>`,
  cursor: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#141414"/><path d="M12 4.5 18.5 8.25v7.5L12 19.5l-6.5-3.75v-7.5Z" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.5 8.25 12 12l6.5-3.75M12 12v7.5" stroke="#fff" stroke-width="1.5" fill="none"/></svg>`,
  perplexity: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#20808D"/><g stroke="#fff" stroke-width="1.7" fill="none" stroke-linejoin="round"><path d="M12 4v16M6 8l6 4 6-4M6 8v8l6-4 6 4V8"/></g></svg>`,
  openrouter: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#6467f2"/><g stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12h4c2 0 3-4.5 6-4.5h4"/><path d="M8.5 12c2 0 3 4.5 6 4.5h4"/><path d="m16.5 5.5 2 2-2 2M16.5 14.5l2 2-2 2"/></g></svg>`,
  ollama: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#fff" stroke="rgba(0,0,0,.12)"/><path d="M8 19v-6.5C8 9.5 9.5 7.5 12 7.5s4 2 4 5V19M9.5 7.8 9 4.5M14.5 7.8 15 4.5" fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round"/><circle cx="10.3" cy="12" r=".9" fill="#111"/><circle cx="13.7" cy="12" r=".9" fill="#111"/></svg>`,
};

export function logo(name, size = 18) {
  return (LOGOS[name] || LOGOS.claude)(size);
}
