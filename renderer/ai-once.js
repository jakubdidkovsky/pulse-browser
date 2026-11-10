// One request to the chat AI outside the AI panel, e.g. Settings → Commands → "Write with AI".
// No page, no tools, no history. The answer streams through onText and the promise resolves with the full text.
// renderer/ai.js still sees these events, so the usage stats count them like any chat request.
import { PROVIDERS, providerById, currentProvider, isReady, modelFor, AUTO_MODELS } from './providers.js';
import { S } from './state.js';
import { uid } from './util.js';
import * as Usage from './usage.js';

export const NO_PROVIDER = 'Writing with AI needs Claude Code or an API key. Set one up in Settings → AI.';

// The AI picked in the panel when it can answer here (web apps can't), otherwise Claude, otherwise any other ready one.
export function onceProvider() {
  return [currentProvider(), providerById('claude-code'), providerById('anthropic'), ...PROVIDERS]
    .find((p) => p && p.kind !== 'web' && isReady(p)) || null;
}

// "Auto" means the tier asked for (see AUTO_MODELS); a model the user picked stays.
function onceModel(p, tier) {
  const chosen = modelFor(p);
  if (chosen !== 'auto') return chosen;
  return AUTO_MODELS[p.id]?.[tier] || p.models?.find((m) => m !== 'auto') || 'default';
}

export function askOnce({ system, prompt, tier = 'balanced', signal, onText }) {
  const p = onceProvider();
  if (!p) return Promise.reject(new Error(NO_PROVIDER));
  const id = uid();
  const model = onceModel(p, tier);
  let text = '';
  return new Promise((resolve, reject) => {
    const off = window.lumen.ai.onEvent((evId, ev) => {
      if (evId !== id) return;
      if (ev.type === 'text' || ev.type === 'replace') {
        text = ev.type === 'text' ? text + ev.text : ev.text;
        onText?.(text);
      } else if (ev.type === 'error') {
        off();
        reject(new Error(ev.message || 'The AI didn’t answer. Try again.'));
      } else if (ev.type === 'done') {
        off();
        resolve(text);
      }
    });
    // Settles right away: a stopped CLI can still report a normal "done" with the text it had so far.
    signal?.addEventListener('abort', () => {
      off();
      window.lumen.ai.abort(id);
      reject(new DOMException('Stopped', 'AbortError'));
    }, { once: true });
    Usage.begin(id, { mode: 'chat', provider: p.id, model });
    window.lumen.ai.send(id, {
      provider: p.id,
      model,
      effort: 'low',
      baseUrl: S.settings.ai.baseUrls?.[p.id] || p.baseUrl,
      system,
      history: [],
      prompt,
      context: '',
      images: [],
    });
  });
}
