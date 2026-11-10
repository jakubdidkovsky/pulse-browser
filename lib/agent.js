'use strict';
// Browser agent runtime (main process).
// - Claude Code: Pulse serves its browser tools over a local MCP endpoint and runs `claude -p`
//   with --resume, so every agent conversation is a persistent Claude Code session.
// - Claude API: a tool-use loop with the official SDK; the transcript is persisted per session.
// Tool calls are executed by the renderer, which owns the webviews and the virtual cursor.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const Anthropic = require('@anthropic-ai/sdk').default;
const { TOOLS, validate, toolNames } = require('./agent-tools');
const ai = require('./ai');

const runs = new Map();
const memorySessions = new Map(); // private windows: API transcripts live only in memory
let server = null;
let serverPort = 0;

const MCP_KEEP_ALIVE = 10 * 60 * 1000; // ms
const STOPPED = { content: [{ type: 'text', text: 'The user stopped the task.' }], isError: true };

// ---------------------------------------------------------------- MCP endpoint (streamable HTTP, JSON responses)

function ensureServer() {
  if (server) return Promise.resolve(serverPort);
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      handleHttp(req, res).catch((err) => {
        console.error('mcp error', err);
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    // Tool calls can wait minutes (approvals, whiteboard_wait), and Claude Code reuses idle connections:
    // Node's defaults (5 s keep-alive, 5 min per request) cut those off mid-task.
    server.keepAliveTimeout = MCP_KEEP_ALIVE;
    server.headersTimeout = MCP_KEEP_ALIVE + 1000;
    server.requestTimeout = 0;
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve(serverPort);
    });
  });
}

async function handleHttp(req, res) {
  const m = /^\/mcp\/([a-f0-9]{32})$/.exec(req.url || '');
  const run = m && [...runs.values()].find((r) => r.token === m[1]);
  if (!run) return void res.writeHead(404).end();
  if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end();
  let body = '';
  for await (const chunk of req) body += chunk;
  let msg;
  try { msg = JSON.parse(body); } catch { return void res.writeHead(400).end(); }
  const batch = Array.isArray(msg) ? msg : [msg];
  const out = (await Promise.all(batch.map((x) => rpc(run, x)))).filter(Boolean);
  if (!out.length) return void res.writeHead(202).end();
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(Array.isArray(msg) ? out : out[0]));
}

async function rpc(run, m) {
  if (m.id === undefined || m.id === null) return null; // notification
  const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize':
      return ok({
        protocolVersion: m.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'lumen', version: app.getVersion() },
        instructions: 'Tools for controlling the Pulse browser tab the user is watching.',
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
    case 'tools/call':
      return ok(await callTool(run, m.params?.name, m.params?.arguments || {}));
    default:
      return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } };
  }
}

// ---------------------------------------------------------------- tool bridge to the renderer

function callTool(run, name, args) {
  const problem = validate(name, args);
  if (problem) return Promise.resolve({ content: [{ type: 'text', text: problem }], isError: true });
  if (run.stopped || run.sender.isDestroyed()) return Promise.resolve(STOPPED);
  return new Promise((resolve) => {
    const callId = crypto.randomUUID();
    run.pending.set(callId, resolve);
    run.sender.send('agent:tool', run.id, callId, name, args);
  });
}

function toolResult(callId, result) {
  for (const run of runs.values()) {
    const resolve = run.pending.get(callId);
    if (!resolve) continue;
    run.pending.delete(callId);
    const content = Array.isArray(result?.content) && result.content.length ? result.content : [{ type: 'text', text: 'Done.' }];
    resolve({ content, isError: !!result?.isError });
    return;
  }
}

// ---------------------------------------------------------------- Claude Code runner

const MAX_RESULT_SCAN = 200000; // chars of a tool result searched for names
const UUID_RE = '[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}';
const normId = (id) => String(id).toLowerCase().replace(/-/g, '');

function resultText(content) {
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (c && c.type === 'text' ? c.text : '')).join('\n') : '';
  return text.slice(0, MAX_RESULT_SCAN);
}

// An "id" (or url) followed — before the next id — by a name/title and/or email maps that ID to a
// readable label. Works for JSON (also with nested {"person":{"email":…}}) and tag attributes.
const ID_FIELD = new RegExp(`"?(?:id|url)"?\\s*[:=]\\s*"(?:[a-z]+://)?(${UUID_RE})"`, 'gi');
const SCOPE_BEFORE = 300;
const SCOPE_AFTER = 600;

function namesIn(text) {
  const out = {};
  const field = (s, keys) => new RegExp(`"?(?:${keys})"?\\s*[:=]\\s*"([^"]{1,120})"`, 'i').exec(s)?.[1];
  for (const m of text.matchAll(ID_FIELD)) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + SCOPE_AFTER);
    const next = after.search(/"?(?:id|url)"?\s*[:=]\s*"/i);
    const before = text.slice(Math.max(0, m.index - SCOPE_BEFORE), m.index);
    const open = Math.max(before.lastIndexOf('{'), before.lastIndexOf('<'));
    const scope = (open >= 0 ? before.slice(open) : '') + (next >= 0 ? after.slice(0, next) : after);
    const name = field(scope, 'name|title|display_name');
    const email = field(scope, 'email|person_email');
    const mail = email && /@/.test(email) ? email : '';
    if (name || mail) out[normId(m[1])] = name && mail ? `${name} (${mail})` : name || mail;
  }
  return out;
}

// Claude Code exposes Pulse's tools as mcp__lumen__<name>; the prompt names them the same way,
// otherwise the model sometimes calls the bare name and gets "No such tool".
function claudeCodePrompt(system) {
  const names = toolNames().filter((n) => n !== 'approve_tool');
  return String(system).replace(new RegExp(`(?<![\\w-])(${names.join('|')})(?![\\w-])`, 'g'), 'mcp__lumen__$1');
}

// Claude Code waits for every connector to connect before the task starts. Connected ones answer in under a second;
// one slower than this sits the task out instead of holding it up (the agent then uses the browser).
const MCP_CONNECT_MS = 3000;

async function runClaudeCode(run, p, emit) {
  const bin = await ai.which(['claude']);
  if (!bin) throw new Error('Claude Code is not installed. See Settings → AI.');
  const port = await ensureServer();
  const ws = ai.workspaceDir();
  const cfgFile = path.join(ws, `mcp-${run.token.slice(0, 12)}.json`);
  // Pulse's own tools always load; the user's connectors stay behind tool search until a task needs them.
  fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: { lumen: { type: 'http', url: `http://127.0.0.1:${port}/mcp/${run.token}`, alwaysLoad: true } } }));

  // Computer access: Claude Code's own file and shell tools, run in the chosen folder like `claude` there.
  let cwd = ws;
  if (p.computer && p.cwd) {
    try { if (fs.statSync(p.cwd).isDirectory()) cwd = p.cwd; } catch {}
  }
  // ToolSearch lets Claude Code load connector tools on demand instead of sending all of them every turn.
  const tools = [...(p.computer ? ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'] : []), ...(p.connectors ? ['ToolSearch'] : [])].join(',');
  // Claude Code connects every connector before the first request, so each one the user switched off in Pulse
  // is kept from connecting at all (Netlify alone held up every task by 4 to 20 s). Only claude.ai connectors
  // can be denied this way: denying a plugin's server makes Claude Code drop the claude.ai connectors too,
  // so other servers are only hidden from the model.
  const blocked = p.connectors ? (p.blockedServers || []) : [];
  const denied = blocked.filter((n) => n.startsWith('claude.ai '));
  const hidden = blocked.filter((n) => !n.startsWith('claude.ai '));
  const settings = {
    disableAllHooks: true, // the user's own Claude Code hooks are for their terminal sessions; Pulse asks for approvals itself
    ...(denied.length ? { deniedMcpServers: denied.map((serverName) => ({ serverName })) } : {}),
  };
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', tools, '--mcp-config', cfgFile, '--system-prompt', claudeCodePrompt(p.system),
    '--settings', JSON.stringify(settings),
  ];
  if (p.connectors || p.computer) {
    // Load the user's Claude connectors and MCP servers; anything that needs permission asks via Pulse.
    args.push('--permission-prompt-tool', 'mcp__lumen__approve_tool');
    if (!p.connectors) args.push('--strict-mcp-config');
    if (hidden.length) args.push('--disallowedTools', ...hidden.map((n) => `mcp__${mcpPrefix(n)}`));
  } else {
    args.push('--strict-mcp-config', '--setting-sources', '');
  }
  if (p.model && p.model !== 'default') args.push('--model', p.model);
  if (p.effort) args.push('--effort', p.effort);
  // With images the prompt goes in as a stream-json user message (text alone can't carry them).
  const images = ai.imagesOf(p);
  if (images.length) args.push('--input-format', 'stream-json');
  if (p.ephemeral) args.push('--no-session-persistence');
  else if (p.resumeId) args.push('--resume', p.resumeId);
  args.push('--allowedTools', ...toolNames().map((n) => `mcp__lumen__${n}`));

  const env = ai.cliEnv(await ai.envPath());
  env.MCP_TOOL_TIMEOUT = '900000';
  env.MCP_TIMEOUT = String(MCP_CONNECT_MS);
  if (!p.computer) {
    // Browser tasks don't need the user's coding instructions (CLAUDE.md) or Claude Code's own memory:
    // Pulse sends its notes about the user itself, and these would ride along in every request.
    env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1';
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  }
  const child = await ai.spawnCli(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  run.kill = () => child.kill('SIGTERM');
  child.stdin.on('error', () => {});
  child.stdin.end(images.length
    ? `${JSON.stringify({ type: 'user', message: { role: 'user', content: [...images.map(ai.anthropicImage), { type: 'text', text: p.prompt }] } })}\n`
    : p.prompt);

  let buf = '';
  let stderr = '';
  let errorMsg = null;
  let gotResult = false;
  let wroteText = false;
  const onLine = (line) => {
    let j;
    try { j = JSON.parse(line); } catch { return; }
    if (j.type === 'system' && j.subtype === 'init') {
      if (j.session_id) emit({ type: 'session', id: j.session_id });
      if (Array.isArray(j.mcp_servers)) emit({ type: 'connectors', servers: j.mcp_servers.filter((s) => s.name !== 'lumen') });
    } else if (j.type === 'stream_event') {
      const ev = j.event || {};
      if (ev.type === 'message_start' && ev.message?.usage) emit({ type: 'context', tokens: contextTokens(ev.message.usage) });
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
        if (wroteText) emit({ type: 'text', text: '\n\n' });
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta?.type === 'text_delta') { wroteText = true; emit({ type: 'text', text: ev.delta.text }); }
        else if (ev.delta?.type === 'thinking_delta') emit({ type: 'thinking', text: ev.delta.thinking });
      }
    } else if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
      for (const b of j.message.content) {
        if (b.type === 'tool_use' && !String(b.name).startsWith('mcp__lumen__')) emit({ type: 'external-tool', id: b.id, name: b.name, input: b.input || {} });
      }
    } else if (j.type === 'user' && Array.isArray(j.message?.content)) {
      // Connector results name people and pages; approvals can then show "Jakub (jakub@…)" instead of IDs.
      const map = {};
      for (const b of j.message.content) if (b.type === 'tool_result') Object.assign(map, namesIn(resultText(b.content)));
      if (Object.keys(map).length) emit({ type: 'names', map });
    } else if (j.type === 'rate_limit_event' && j.rate_limit_info) {
      emit({ type: 'plan', info: j.rate_limit_info });
    } else if (j.type === 'result') {
      gotResult = true;
      emit({ type: 'usage', costUsd: j.total_cost_usd, usage: j.usage || {}, turns: j.num_turns, ms: j.duration_ms, models: Object.keys(j.modelUsage || {}) });
      if (j.is_error) errorMsg = (typeof j.result === 'string' && j.result) || (j.errors || []).join('\n') || 'Claude Code returned an error.';
      if (j.session_id) emit({ type: 'session', id: j.session_id });
    }
  };
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, i).trim());
      buf = buf.slice(i + 1);
    }
  });
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (buf.trim()) onLine(buf.trim());
  fs.rm(cfgFile, { force: true }, () => {});
  if (run.stopped) return;
  if (errorMsg) throw new Error(errorMsg);
  if (code !== 0 && !gotResult) throw new Error(stderr.trim() || `Claude Code exited with code ${code}.`);
}

// ---------------------------------------------------------------- Claude API runner

function sessionFile(key) {
  const dir = path.join(app.getPath('userData'), 'agent-sessions');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${String(key).replace(/[^a-z0-9_-]/gi, '')}.json`);
}

// How much the model read for one call: the size of the conversation it carries.
const contextTokens = (u = {}) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);

function toApiContent(content) {
  return content.map((c) => (c.type === 'image'
    ? { type: 'image', source: { type: 'base64', media_type: c.mimeType || 'image/jpeg', data: c.data } }
    : { type: 'text', text: String(c.text ?? '') }));
}

async function runApi(run, p, key, emit) {
  if (!key) throw new Error('Add your Anthropic API key in Settings → AI.');
  const client = new Anthropic({ apiKey: key });
  const model = p.model || 'claude-opus-5-5';
  const file = p.ephemeral ? null : sessionFile(p.sessionKey);
  let messages = [];
  if (p.ephemeral) messages = memorySessions.get(p.sessionKey) || [];
  else try { messages = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (p.ephemeral) memorySessions.set(p.sessionKey, messages);

  // Keep the history append-only: a new prompt after an interrupted turn joins the last user message.
  const last = messages.at(-1);
  const prompt = [...ai.imagesOf(p).map(ai.anthropicImage), { type: 'text', text: p.prompt }];
  if (last?.role === 'user') {
    if (typeof last.content === 'string') last.content = [{ type: 'text', text: last.content }];
    last.content.push(...prompt);
  } else {
    messages.push({ role: 'user', content: prompt.length > 1 ? prompt : p.prompt });
  }
  const save = () => { if (file) fs.writeFile(file, JSON.stringify(messages), () => {}); };
  const tools = TOOLS.filter((t) => !t.internal).map(({ internal, ...t }) => ({ ...t, eager_input_streaming: true }));
  let wroteText = false;

  for (let turn = 0; turn < 100 && !run.stopped; turn++) {
    const params = { model, max_tokens: 32000, system: p.system, tools, messages, cache_control: { type: 'ephemeral' } };
    if (ai.ADAPTIVE_RE.test(model)) {
      params.thinking = { type: 'adaptive', display: 'summarized' };
      params.output_config = { effort: p.effort || 'low' };
    }
    if (ai.FALLBACK_MODELS.has(model)) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    const stream = client.beta.messages.stream(params, { signal: run.ctrl.signal });
    for await (const ev of stream) {
      if (ev.type === 'content_block_start' && ev.content_block.type === 'text') {
        if (wroteText) emit({ type: 'text', text: '\n\n' });
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') { wroteText = true; emit({ type: 'text', text: ev.delta.text }); }
        else if (ev.delta.type === 'thinking_delta') emit({ type: 'thinking', text: ev.delta.thinking });
      }
    }
    const msg = await stream.finalMessage();
    if (msg.usage) {
      emit({ type: 'tokens', model: msg.model || model, usage: msg.usage });
      emit({ type: 'context', tokens: contextTokens(msg.usage) });
    }
    messages.push({ role: 'assistant', content: msg.content });
    save();

    const uses = msg.content.filter((b) => b.type === 'tool_use');
    if (msg.stop_reason === 'refusal') {
      emit({ type: 'notice', text: 'Claude declined to continue this task.' });
      break;
    }
    if (msg.stop_reason === 'max_tokens' && uses.length) {
      // A truncated tool call can't run; answer it so the transcript stays valid, then let the model retry.
      messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: 'Your tool call was cut off by the output limit. Retry it with a shorter input.', is_error: true })) });
      save();
      continue;
    }
    if (msg.stop_reason !== 'tool_use' || !uses.length) break;

    const results = [];
    for (const u of uses) {
      const r = await callTool(run, u.name, u.input);
      results.push({ type: 'tool_result', tool_use_id: u.id, content: toApiContent(r.content), ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
    save();
  }
}

// ---------------------------------------------------------------- public API

async function start(sender, id, p, key) {
  const run = { id, sender, token: crypto.randomBytes(16).toString('hex'), pending: new Map(), ctrl: new AbortController(), stopped: false, kill: null };
  runs.set(id, run);
  const emit = (ev) => { if (!sender.isDestroyed()) sender.send('agent:event', id, ev); };
  try {
    if (p.provider === 'claude-code') await runClaudeCode(run, p, emit);
    else if (p.provider === 'anthropic') await runApi(run, p, key, emit);
    else throw new Error('Agent mode works with Claude Code or the Claude API. Switch the AI in the panel header.');
    emit({ type: 'done', aborted: run.stopped });
  } catch (err) {
    if (run.stopped || run.ctrl.signal.aborted) emit({ type: 'done', aborted: true });
    else emit({ type: 'error', message: ai.friendlyError(err) });
  } finally {
    run.stopped = true;
    for (const resolve of run.pending.values()) resolve(STOPPED);
    runs.delete(id);
  }
}

function stop(id) {
  const run = runs.get(id);
  if (!run) return;
  run.stopped = true;
  for (const resolve of run.pending.values()) resolve(STOPPED);
  run.pending.clear();
  run.ctrl.abort();
  run.kill?.();
}

// Tool-name prefix Claude Code derives from a server name ("claude.ai Gmail" → "claude_ai_Gmail").
function mcpPrefix(name) {
  return String(name).replace(/[^A-Za-z0-9_-]/g, '_');
}

// Lists the user's Claude Code MCP servers and claude.ai connectors (health check only, no model call).
async function listConnectors() {
  const bin = await ai.which(['claude']);
  if (!bin) return { ok: false, error: 'Claude Code is not installed.' };
  const env = ai.cliEnv(await ai.envPath());
  let child;
  try {
    child = await ai.spawnCli(bin, ['mcp', 'list'], { cwd: ai.workspaceDir(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return new Promise((resolve) => {
    let out = '';
    const timer = setTimeout(() => child.kill(), 45000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve({ ok: false, error: 'Could not run claude mcp list.' }));
    child.on('close', () => {
      clearTimeout(timer);
      const servers = [];
      for (const line of out.split('\n')) {
        const m = /^(.+?): .* - (.+)$/.exec(line.trim());
        if (!m || m[1] === 'lumen') continue;
        const st = m[2];
        servers.push({ name: m[1], status: /connected/i.test(st) ? 'connected' : /auth/i.test(st) ? 'needs-auth' : 'failed', source: m[1].startsWith('claude.ai ') ? 'claudeai' : m[1].startsWith('plugin:') ? 'plugin' : 'user' });
      }
      resolve({ ok: true, servers });
    });
  });
}

function forget(sessionKey) {
  fs.rm(sessionFile(sessionKey), { force: true }, () => {});
}

module.exports = { start, stop, toolResult, forget, listConnectors };
