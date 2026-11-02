'use strict';
// AI providers: official Anthropic SDK, OpenAI-compatible APIs, Gemini API,
// and local CLIs that reuse the user's existing subscriptions
// (Claude Code, Codex, Cursor Agent, Gemini CLI).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const Anthropic = require('@anthropic-ai/sdk').default;

const running = new Map();

// Models that accept server-side refusal fallbacks ("default" routing).
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const ADAPTIVE_RE = /^claude-(fable|mythos|opus-5|sonnet-5|haiku-5|opus-4-[678]|sonnet-4-6)/;

const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/;
const MAX_IMAGES = 6;
const MAX_IMAGE_CHARS = 7 * 1024 * 1024; // base64 of a ~5 MB image, the API's per-image limit

// Images from the renderer, checked: [{ mime, data(base64) }].
function imagesOf(p) {
  const list = Array.isArray(p.images) ? p.images : p.image ? [{ mime: 'image/jpeg', data: p.image }] : [];
  return list.filter((im) => im && IMAGE_MIME.test(im.mime) && typeof im.data === 'string' && im.data.length <= MAX_IMAGE_CHARS && /^[A-Za-z0-9+/=]+$/.test(im.data.slice(0, 64)))
    .slice(0, MAX_IMAGES);
}

const anthropicImage = (im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } });

const OPENAI_BASES = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
};

const DEFAULT_MODELS = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5',
  openrouter: 'openrouter/auto',
  ollama: 'llama3.2',
  gemini: 'gemini-2.5-flash',
};

// ---------------------------------------------------------------- helpers

function withContext(p) {
  return p.context ? `${p.context}\n\n${p.prompt}` : p.prompt;
}

async function errorText(res) {
  let body = '';
  try { body = await res.text(); } catch {}
  try {
    const j = JSON.parse(body);
    const msg = j.error?.message || j.error || j.message;
    if (msg) return `${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
  } catch {}
  return `${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`;
}

// Yields the `data:` payloads of a server-sent-event stream.
async function* sse(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trimStart();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trimStart();
}

// ---------------------------------------------------------------- Anthropic (official SDK)

async function runAnthropic(p, key, signal, emit) {
  if (!key) throw new Error('Add your Anthropic API key in Settings → AI.');
  const client = new Anthropic({ apiKey: key });
  const model = p.model || DEFAULT_MODELS.anthropic;

  const messages = p.history.map((m) => ({ role: m.role, content: m.content }));
  const content = [];
  content.push(...imagesOf(p).map(anthropicImage));
  content.push({ type: 'text', text: withContext(p) });
  messages.push({ role: 'user', content });

  const params = { model, max_tokens: 64000, system: p.system, messages };
  if (ADAPTIVE_RE.test(model)) {
    params.thinking = { type: 'adaptive', display: 'summarized' };
    params.output_config = { effort: p.effort || 'medium' };
  }
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  const stream = client.beta.messages.stream(params, { signal });
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta') {
      if (ev.delta.type === 'text_delta') emit({ type: 'text', text: ev.delta.text });
      else if (ev.delta.type === 'thinking_delta') emit({ type: 'thinking', text: ev.delta.thinking });
    } else if (ev.type === 'content_block_start' && ev.content_block.type === 'fallback') {
      emit({ type: 'notice', text: `Continued on ${ev.content_block.to?.model || 'a fallback model'}.` });
    }
  }
  const final = await stream.finalMessage();
  if (final.usage) emit({ type: 'tokens', model: final.model || model, usage: final.usage });
  if (final.stop_reason === 'refusal') {
    emit({ type: 'notice', level: 'warn', text: 'Claude declined this request. Any partial answer above is incomplete.' });
  } else if (final.stop_reason === 'max_tokens') {
    emit({ type: 'notice', level: 'warn', text: 'The answer hit the length limit.' });
  }
}

// ---------------------------------------------------------------- OpenAI-compatible (OpenAI, OpenRouter, Ollama)

async function runOpenAICompat(p, key, signal, emit) {
  const base = (p.baseUrl || OPENAI_BASES[p.provider]).replace(/\/+$/, '');
  if (p.provider !== 'ollama' && !key) throw new Error('Add your API key in Settings → AI.');
  const text = withContext(p);
  const images = imagesOf(p);
  const user = images.length
    ? [{ type: 'text', text }, ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } }))]
    : text;
  const body = {
    model: p.model || DEFAULT_MODELS[p.provider],
    stream: true,
    messages: [{ role: 'system', content: p.system }, ...p.history, { role: 'user', content: user }],
  };
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  if (p.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/lumen-browser';
    headers['X-Title'] = 'Pulse Browser';
  }
  const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(await errorText(res));
  for await (const data of sse(res.body)) {
    if (data === '[DONE]') break;
    let j;
    try { j = JSON.parse(data); } catch { continue; }
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    const d = j.choices?.[0]?.delta;
    if (!d) continue;
    const reasoning = d.reasoning_content || d.reasoning;
    if (typeof reasoning === 'string' && reasoning) emit({ type: 'thinking', text: reasoning });
    if (d.content) emit({ type: 'text', text: d.content });
  }
}

// ---------------------------------------------------------------- Gemini API

async function runGemini(p, key, signal, emit) {
  if (!key) throw new Error('Add your Gemini API key in Settings → AI.');
  const model = p.model || DEFAULT_MODELS.gemini;
  const parts = [{ text: withContext(p) }];
  parts.unshift(...imagesOf(p).map((im) => ({ inline_data: { mime_type: im.mime, data: im.data } })));
  const body = {
    systemInstruction: { parts: [{ text: p.system }] },
    contents: [
      ...p.history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      { role: 'user', parts },
    ],
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(await errorText(res));
  for await (const data of sse(res.body)) {
    let j;
    try { j = JSON.parse(data); } catch { continue; }
    for (const part of j.candidates?.[0]?.content?.parts || []) {
      if (!part.text) continue;
      emit({ type: part.thought ? 'thinking' : 'text', text: part.text });
    }
  }
}

// ---------------------------------------------------------------- CLIs (use the user's own logins)

const HOME = os.homedir();
const EXTRA_PATHS = [
  path.join(HOME, '.local/bin'), path.join(HOME, '.claude/local'), path.join(HOME, '.npm-global/bin'),
  path.join(HOME, '.bun/bin'), path.join(HOME, '.cursor/bin'), path.join(HOME, '.volta/bin'),
  path.join(HOME, '.deno/bin'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/snap/bin',
  ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []), // npm's global bin on Windows
];
// Windows caps a whole command line at 32767 chars; prompts that go in as an argument must fit.
const MAX_ARG_PROMPT = process.platform === 'win32' ? 24000 : 120000;

let shellPath = null;
function resolveShellPath() {
  if (shellPath !== null || process.platform === 'win32') return Promise.resolve(shellPath || '');
  return new Promise((resolve) => {
    const sh = process.env.SHELL || '/bin/bash';
    let out = '';
    const child = spawn(sh, ['-ilc', 'printf "__LUMEN__%s__LUMEN__" "$PATH"'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => child.kill(), 4000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => {});
    child.on('close', () => {
      clearTimeout(timer);
      const m = out.match(/__LUMEN__(.*?)__LUMEN__/s);
      shellPath = m ? m[1] : '';
      resolve(shellPath);
    });
  });
}

async function envPath() {
  const sp = await resolveShellPath();
  const parts = [...(process.env.PATH || '').split(path.delimiter), ...sp.split(path.delimiter), ...EXTRA_PATHS];
  return [...new Set(parts.filter(Boolean))].join(path.delimiter);
}

async function which(bins) {
  const dirs = (await envPath()).split(path.delimiter);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const bin of bins) {
    for (const d of dirs) {
      for (const ext of exts) {
        const full = path.join(d, bin + ext);
        try {
          fs.accessSync(full, fs.constants.X_OK);
          if (fs.statSync(full).isFile()) return full;
        } catch {}
      }
    }
  }
  return null;
}

function cliTranscript(p) {
  // CLIs are stateless here, so the whole conversation goes into one prompt.
  const lines = [];
  if (p.history.length) {
    lines.push('<conversation_so_far>');
    for (const m of p.history) lines.push(`<${m.role}>\n${m.content}\n</${m.role}>`);
    lines.push('</conversation_so_far>', '');
  }
  if (p.context) lines.push(p.context, '');
  lines.push(p.prompt);
  return lines.join('\n');
}

const CLIS = {
  'claude-code': {
    bins: ['claude'],
    login: 'claude auth login',
    args: (p) => [
      '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
      '--system-prompt', p.system,
      ...(p.model && p.model !== 'default' ? ['--model', p.model] : []),
    ],
    stdin: true,
    parser: 'claude',
  },
  codex: {
    bins: ['codex'],
    login: 'codex login',
    args: (p) => [
      'exec', '--skip-git-repo-check', '--json', '-s', 'read-only',
      ...(p.model && p.model !== 'default' ? ['-m', p.model] : []), '-',
    ],
    stdin: true,
    parser: 'codex',
    systemInPrompt: true,
  },
  cursor: {
    bins: ['cursor-agent', 'agent'],
    login: 'cursor-agent login',
    args: (p, prompt) => [
      '-p', '--output-format', 'stream-json', '--stream-partial-output',
      ...(p.model && p.model !== 'default' ? ['--model', p.model] : []), prompt,
    ],
    parser: 'cursor',
    systemInPrompt: true,
  },
  'gemini-cli': {
    bins: ['gemini'],
    login: 'gemini',
    args: (p, prompt) => ['-p', prompt, ...(p.model && p.model !== 'default' ? ['-m', p.model] : [])],
    parser: 'text',
    systemInPrompt: true,
  },
};

function cliEnv(pathValue) {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  // Don't let a parent Claude Code session leak into the child CLI. Windows spells PATH "Path".
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k.toUpperCase() === 'PATH') delete env[k];
  return { ...env, PATH: pathValue };
}

// npm installs CLIs on Windows as .cmd shims, which only run through cmd.exe. That would re-parse every
// argument (text from a web page could run commands), cut it at the first newline and cap it at 8191 chars,
// so the program the shim points at is started directly instead.
function shimTarget(cmdFile) {
  let text;
  try { text = fs.readFileSync(cmdFile, 'utf8'); } catch { return null; }
  const targets = [...text.matchAll(/"%~?dp0%?\\?([^"%]+)"/g)]
    .map((m) => path.join(path.dirname(cmdFile), m[1]))
    .filter((t) => !/[\\/]node\.exe$/i.test(t) && fs.existsSync(t));
  return targets.at(-1) || null;
}

async function cliCommand(bin, args) {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(bin)) return { file: bin, args, env: {} };
  const target = shimTarget(bin);
  if (!target) throw new Error(`Can't start ${path.basename(bin)}. Reinstall it with its official installer (Settings → AI).`);
  if (/\.exe$/i.test(target)) return { file: target, args, env: {} };
  const node = await which(['node']);
  if (node) return { file: node, args: [target, ...args], env: {} };
  // No Node on the PATH: Pulse's own runtime runs the script.
  return { file: process.execPath, args: [target, ...args], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

// Starts a CLI found by which(), with no console window popping up on Windows.
async function spawnCli(bin, args, opts) {
  const cmd = await cliCommand(bin, args);
  return spawn(cmd.file, cmd.args, { ...opts, env: { ...opts.env, ...cmd.env }, windowsHide: true });
}

function workspaceDir() {
  const d = path.join(app.getPath('userData'), 'agent-workspace');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function runCli(p, signal, emit) {
  const def = CLIS[p.provider];
  const bin = await which(def.bins);
  if (!bin) throw new Error(`${def.bins[0]} is not installed (or not on your PATH). See Settings → AI.`);

  let prompt = cliTranscript(p);
  if (def.systemInPrompt) prompt = `<instructions>\n${p.system}\n</instructions>\n\n${prompt}`;
  if (!def.stdin && prompt.length > MAX_ARG_PROMPT) prompt = prompt.slice(0, MAX_ARG_PROMPT) + '\n[context truncated]';

  const child = await spawnCli(bin, def.args(p, prompt), {
    cwd: workspaceDir(),
    env: cliEnv(await envPath()),
    stdio: [def.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  const onAbort = () => child.kill('SIGTERM');
  signal.addEventListener('abort', onAbort, { once: true });
  if (def.stdin) {
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  }

  let streamed = '';
  let finalText = null;
  let errorMsg = null;
  let stderr = '';
  let buf = '';
  const text = (t) => { if (t) { streamed += t; emit({ type: 'text', text: t }); } };

  const handleLine = (line) => {
    if (def.parser === 'text') return;
    let j;
    try { j = JSON.parse(line); } catch { return; }
    if (def.parser === 'claude') {
      if (j.type === 'stream_event') {
        const d = j.event?.delta;
        if (j.event?.type === 'content_block_delta' && d) {
          if (d.type === 'text_delta') text(d.text);
          else if (d.type === 'thinking_delta') emit({ type: 'thinking', text: d.thinking });
        }
      } else if (j.type === 'rate_limit_event' && j.rate_limit_info) {
        emit({ type: 'plan', info: j.rate_limit_info });
      } else if (j.type === 'result') {
        emit({ type: 'usage', costUsd: j.total_cost_usd, usage: j.usage || {}, turns: j.num_turns, ms: j.duration_ms, models: Object.keys(j.modelUsage || {}) });
        if (j.is_error) errorMsg = j.result || j.error || 'Claude Code returned an error.';
        else finalText = typeof j.result === 'string' ? j.result : null;
      }
    } else if (def.parser === 'cursor') {
      if (j.type === 'assistant') {
        for (const c of j.message?.content || []) if (c.type === 'text') text(c.text);
      } else if (j.type === 'result') {
        if (j.is_error) errorMsg = j.result || 'Cursor Agent returned an error.';
        else finalText = typeof j.result === 'string' ? j.result : null;
      }
    } else if (def.parser === 'codex') {
      const item = j.item || {};
      if (j.type === 'item.completed' && /agent_message|assistant_message/.test(item.type || '')) {
        text((streamed ? '\n\n' : '') + (item.text || ''));
      } else if (j.msg?.type === 'agent_message_delta') {
        text(j.msg.delta);
      } else if (j.msg?.type === 'agent_message' && !streamed) {
        text(j.msg.message);
      } else if (j.type === 'error' || j.type === 'turn.failed' || j.msg?.type === 'error') {
        errorMsg = j.message || j.error?.message || j.msg?.message || 'Codex returned an error.';
      }
    }
  };

  child.stdout.on('data', (chunk) => {
    const s = chunk.toString();
    if (def.parser === 'text') { text(s); return; }
    buf += s;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      handleLine(buf.slice(0, idx).trim());
      buf = buf.slice(idx + 1);
    }
  });
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });

  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  signal.removeEventListener('abort', onAbort);
  if (buf.trim()) handleLine(buf.trim());
  if (signal.aborted) return;

  if (errorMsg) throw new Error(cleanCliError(errorMsg, def));
  // The authoritative final answer replaces the streamed text when they differ.
  if (finalText != null && finalText.trim() && finalText.trim() !== streamed.trim()) {
    emit({ type: 'replace', text: finalText });
    streamed = finalText;
  }
  if (code !== 0 && !streamed.trim()) {
    throw new Error(cleanCliError(stderr.trim() || `${path.basename(bin)} exited with code ${code}`, def));
  }
}

function cleanCliError(msg, def) {
  const s = String(msg).replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (/log ?in|auth|credential|api key|unauthori[sz]ed|401/i.test(s)) {
    return `${s}\n\nYou may need to sign in: Settings → AI → Sign in (runs \`${def.login}\`).`;
  }
  return s;
}

// ---------------------------------------------------------------- public API

async function run(id, p, key, emit) {
  const ctrl = new AbortController();
  running.set(id, ctrl);
  try {
    if (p.provider === 'anthropic') await runAnthropic(p, key, ctrl.signal, emit);
    else if (p.provider in OPENAI_BASES) await runOpenAICompat(p, key, ctrl.signal, emit);
    else if (p.provider === 'gemini') await runGemini(p, key, ctrl.signal, emit);
    else if (p.provider in CLIS) await runCli(p, ctrl.signal, emit);
    else throw new Error(`Unknown AI provider: ${p.provider}`);
    emit({ type: 'done' });
  } catch (err) {
    if (ctrl.signal.aborted) emit({ type: 'done', aborted: true });
    else emit({ type: 'error', message: friendlyError(err) });
  } finally {
    running.delete(id);
  }
}

function friendlyError(err) {
  const status = err?.status;
  if (status === 401) return 'The API key was rejected (401). Check it in Settings → AI.';
  if (status === 429) return 'Rate limited (429). Wait a moment and try again.';
  if (status === 529 || status === 503) return 'The service is overloaded right now. Try again in a moment.';
  const msg = err?.error?.error?.message || err?.message || String(err);
  if (/ECONNREFUSED/.test(msg)) return `Could not connect (${msg}). Is the local server running?`;
  return msg;
}

function abort(id) {
  running.get(id)?.abort();
}

async function listModels(provider, key, baseUrl) {
  if (provider === 'anthropic') {
    if (!key) return [];
    const client = new Anthropic({ apiKey: key });
    const ids = [];
    for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
    return ids;
  }
  if (provider in OPENAI_BASES) {
    const base = (baseUrl || OPENAI_BASES[provider]).replace(/\/+$/, '');
    const res = await fetch(`${base}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
    if (!res.ok) throw new Error(await errorText(res));
    const j = await res.json();
    let ids = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
    if (provider === 'openai') ids = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|search)/.test(id));
    return ids.sort();
  }
  if (provider === 'gemini') {
    if (!key) return [];
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw new Error(await errorText(res));
    const j = await res.json();
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((id) => /^gemini/.test(id));
  }
  if (provider === 'claude-code') return ['default', 'opus', 'sonnet', 'haiku'];
  return ['default'];
}

async function detect() {
  const out = {};
  for (const [id, def] of Object.entries(CLIS)) out[id] = await which(def.bins);
  return out;
}

// Opens the provider's login command in a terminal window.
async function openLogin(provider) {
  const def = CLIS[provider];
  if (!def) return { ok: false };
  const bin = await which(def.bins);
  const cmd = def.login;
  const env = cliEnv(await envPath());
  if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script ${JSON.stringify(cmd)}\ntell application "Terminal" to activate`;
    spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore', env }).unref();
    return { ok: true, cmd, installed: !!bin };
  }
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', cmd], { detached: true, stdio: 'ignore', env, shell: false }).unref();
    return { ok: true, cmd, installed: !!bin };
  }
  const inner = `${cmd}; echo; echo "Done. You can close this window."; exec "\${SHELL:-bash}"`;
  const terminals = [
    ['x-terminal-emulator', ['-e', 'bash', '-lc', inner]],
    ['gnome-terminal', ['--', 'bash', '-lc', inner]],
    ['ptyxis', ['--', 'bash', '-lc', inner]],
    ['konsole', ['-e', 'bash', '-lc', inner]],
    ['kitty', ['bash', '-lc', inner]],
    ['alacritty', ['-e', 'bash', '-lc', inner]],
    ['wezterm', ['start', '--', 'bash', '-lc', inner]],
    ['xfce4-terminal', ['-x', 'bash', '-lc', inner]],
    ['xterm', ['-e', 'bash', '-lc', inner]],
  ];
  for (const [term, args] of terminals) {
    const termBin = await which([term]);
    if (!termBin) continue;
    spawn(termBin, args, { detached: true, stdio: 'ignore', env, cwd: HOME }).unref();
    return { ok: true, cmd, installed: !!bin };
  }
  return { ok: false, cmd, installed: !!bin };
}

module.exports = { run, abort, listModels, detect, openLogin, which, envPath, cliEnv, spawnCli, workspaceDir, friendlyError, imagesOf, anthropicImage, ADAPTIVE_RE, FALLBACK_MODELS };
