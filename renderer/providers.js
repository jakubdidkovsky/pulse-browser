// AI provider catalogue (display metadata; the request logic lives in lib/ai.js).
import { S } from './state.js';

export const PROVIDERS = [
  // Uses an existing subscription through the vendor's own CLI.
  { id: 'claude-code', kind: 'cli', logo: 'claude', name: 'Claude', vendor: 'Anthropic', via: 'Claude Code', sub: 'Your Claude Pro/Max login via Claude Code', bin: 'claude', install: 'https://docs.claude.com/en/docs/claude-code/setup', installCmd: 'curl -fsSL https://claude.ai/install.sh | bash', installCmdWin: 'irm https://claude.ai/install.ps1 | iex', models: ['default', 'opus', 'sonnet', 'haiku'] },
  { id: 'codex', kind: 'cli', logo: 'openai', name: 'ChatGPT', vendor: 'OpenAI', via: 'Codex CLI', sub: 'Your ChatGPT Plus/Pro login via Codex', bin: 'codex', install: 'https://github.com/openai/codex', installCmd: 'npm i -g @openai/codex' },
  { id: 'cursor', kind: 'cli', logo: 'cursor', name: 'Cursor', vendor: 'Cursor', via: 'Cursor Agent', sub: 'Your Cursor login via cursor-agent', bin: 'cursor-agent', install: 'https://cursor.com/cli', installCmd: 'curl https://cursor.com/install -fsS | bash', installCmdWin: "irm 'https://cursor.com/install?win32=true' | iex" },
  { id: 'gemini-cli', kind: 'cli', logo: 'gemini', name: 'Gemini', vendor: 'Google', via: 'Gemini CLI', sub: 'Your Google account via Gemini CLI', bin: 'gemini', install: 'https://github.com/google-gemini/gemini-cli', installCmd: 'npm i -g @google/gemini-cli' },

  // API keys.
  { id: 'anthropic', kind: 'api', logo: 'claude', name: 'Claude API', vendor: 'Anthropic', sub: 'Anthropic API key', defaultModel: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'], keyUrl: 'https://console.anthropic.com/settings/keys', vision: true, effort: true },
  { id: 'openai', kind: 'api', logo: 'openai', name: 'OpenAI API', vendor: 'OpenAI', sub: 'OpenAI API key', defaultModel: 'gpt-5', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', vision: true },
  { id: 'gemini', kind: 'api', logo: 'gemini', name: 'Gemini API', vendor: 'Google', sub: 'Google AI Studio key', defaultModel: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey', vision: true },
  { id: 'openrouter', kind: 'api', logo: 'openrouter', name: 'OpenRouter', vendor: 'OpenRouter', sub: 'Hundreds of models, one key', defaultModel: 'openrouter/auto', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', vision: true },
  { id: 'ollama', kind: 'api', logo: 'ollama', name: 'Ollama', vendor: 'Local', sub: 'Private models on this computer', defaultModel: 'llama3.2', noKey: true, baseUrl: 'http://localhost:11434/v1', install: 'https://ollama.com/download' },

  // Official web apps, signed in with your normal account.
  { id: 'web-claude', kind: 'web', logo: 'claude', name: 'Claude.ai', vendor: 'Anthropic', sub: 'Sign in with your Claude account', url: 'https://claude.ai/new', input: 'div[contenteditable="true"]' },
  { id: 'web-chatgpt', kind: 'web', logo: 'openai', name: 'ChatGPT', vendor: 'OpenAI', sub: 'Sign in with your OpenAI account', url: 'https://chatgpt.com/', input: '#prompt-textarea, div[contenteditable="true"], textarea' },
  { id: 'web-gemini', kind: 'web', logo: 'gemini', name: 'Gemini', vendor: 'Google', sub: 'Sign in with your Google account', url: 'https://gemini.google.com/app', input: 'div[contenteditable="true"], textarea' },
  { id: 'web-perplexity', kind: 'web', logo: 'perplexity', name: 'Perplexity', vendor: 'Perplexity', sub: 'Sign in with your Perplexity account', url: 'https://www.perplexity.ai/', input: 'textarea, div[contenteditable="true"]' },
  { id: 'web-cursor', kind: 'web', logo: 'cursor', name: 'Cursor Web', vendor: 'Cursor', sub: 'Cursor agents in the browser', url: 'https://cursor.com/agents', input: 'textarea, div[contenteditable="true"]' },
];

// The command that installs a CLI provider in this system's own shell (PowerShell on Windows).
export const installCmdOf = (p) => (window.lumen.platform === 'win32' && p.installCmdWin) || p.installCmd;

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || null;

export function isReady(p) {
  if (!p) return false;
  if (p.kind === 'web') return true;
  if (p.kind === 'cli') return !!S.clis[p.id];
  return p.noKey || !!S.secrets[p.id];
}

export function statusOf(p) {
  if (p.kind === 'web') return { label: 'Web', cls: '' };
  if (p.kind === 'cli') return S.clis[p.id] ? { label: 'Installed', cls: 'ok' } : { label: 'Not installed', cls: '' };
  if (p.noKey) return { label: 'Local', cls: 'ok' };
  return S.secrets[p.id] ? { label: 'Connected', cls: 'ok' } : { label: 'Add key', cls: '' };
}

export function defaultProviderId() {
  if (S.clis['claude-code']) return 'claude-code';
  const api = PROVIDERS.find((p) => p.kind === 'api' && !p.noKey && S.secrets[p.id]);
  if (api) return api.id;
  const cli = PROVIDERS.find((p) => p.kind === 'cli' && S.clis[p.id]);
  return cli ? cli.id : 'web-claude';
}

export function currentProvider() {
  return providerById(S.settings.ai.provider) || providerById(defaultProviderId());
}

export function modelFor(p) {
  return S.settings.ai.models?.[p.id] || p.defaultModel || 'default';
}

const PRETTY = {
  'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5',
  'claude-fable-5-1': 'Fable 5.1', 'claude-opus-5': 'Opus 5', 'claude-sonnet-5': 'Sonnet 5',
  default: 'Default', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku',
};

export const prettyModel = (m) => PRETTY[m] || m;
