# Pulse

Jakub's Chromium (Electron) browser with a built-in AI side panel and a browser agent that drives tabs with its own cursor. Personal project, active, and his daily browser. Private repo `jakubdidkovsky/pulse-browser`, branch `main`.

## Stack & layout
- Electron 45, plain JavaScript: no bundler, no TypeScript. The renderer is ES modules served from the custom `lumen://app/` protocol; `preload.js` exposes `window.lumen`.
- `main.js`: windows, IPC, protocol, shortcuts, single-instance lock, secrets via `safeStorage`.
- `lib/` (main process): `ai.js` chat providers and CLI spawning, `agent.js` agent runs plus the local MCP server, `agent-tools.js` tool schemas, `adblock.js`, `cookies.js`, `extensions.js`, `sites.js`.
- `renderer/ai.js`: chat and agent system prompts (`SYSTEM`, `AGENT_SYSTEM`), chat/agent routing, cost-saving logic. `renderer/agent.js`: runs tools in pages, `approve_tool` decisions.
- Agent backends: Claude Code CLI (`claude -p --output-format stream-json`, Pulse tools as `mcp__lumen__*`, `--permission-prompt-tool mcp__lumen__approve_tool`) or the Anthropic API (`@anthropic-ai/sdk`).
- User data: `~/.config/Pulse/` (settings in `data/`, `agent-workspace/`). Agent memory: `~/Documents/Pulse/MEMORY.md` and `~/Documents/Pulse/sites/<host>/CONTEXT.md` plus `sessions/`.

## Commands
- Setup: `npm install`
- Run: `npm start` (falls back to `--no-sandbox` on Ubuntu 24.04 until `npm run fix-sandbox`, which needs sudo)
- Local packages into `dist/`: `npm run dist` (this OS), `npm run dist:linux`, `npm run dist:win` (needs wine)
- Release, only when Jakub asks: `npm version patch && git push --follow-tags`. A `v*` tag runs `.github/workflows/release.yml`, which builds every installer (Linux AppImage/.deb/.rpm, Windows NSIS, x64 + arm64) and publishes a GitHub release with `SHA256SUMS.txt`.
- No test suite. Check syntax with `node --check <file>` and verify behaviour in a hidden test instance (below).

## Testing without touching Jakub's browser
- His own Pulse is usually running on his profile. Never test with it: the single-instance lock hands a second launch to his window.
- Hidden instance on a scratch profile: `LUMEN_HIDDEN=1 LUMEN_USER_DATA=<scratchpad>/profile node scripts/start.js --remote-debugging-port=9333` (add `--inspect=9339` for the main process), then drive it over CDP.
- Hidden-window quirks: the UI updates on rAF, so wait ~2 s before asserting. CDP screenshots hang; use `window.lumen.capture(1)`. Restart instead of reloading (lumen:// modules are cached). Set `onboarded` in the test profile's settings or the setup modal blocks clicks.
- Kill it with `pkill -f "remote-debugging-port=933[3]"` as its own Bash call, never in the same command as the relaunch (it kills the shell).
- Code changes reach Jakub only after he restarts Pulse: tell him.
- Never send real emails or messages from tests; deny the approval or use example.com addresses.

## Product rules (Jakub's explicit wishes)
- UI strings are English, clean, Apple-like.
- No em-dashes or en-dashes anywhere in the UI, prompts or agent output. `plainDashes()` and `STYLE_RULE` in `renderer/ai.js` clean model text; keep them. (Dashes in code comments are fine.)
- Agent design is token- and usage-frugal: every agent step re-reads the system prompt, tools and history. Existing savers: snapshots strip tracking params (`TRACKING_PARAM` in `renderer/agent.js`), long or cold chats restart from a recap (`CARRY_MAX_TOKENS`, `PROMPT_CACHE_TTL` in `renderer/ai.js`), thinking effort "Auto". Don't grow prompts or tool lists without a reason, and say what a change costs in tokens.
- The agent always asks before paying; sending, deleting, shell commands and edits follow the Normal/Full permission mode. Don't weaken these defaults.
- `README.md` is the end-user guide in English, like the UI (install steps plus a feature table; switched from Czech on 2026-11-06 at Jakub's request). Add new features to it, quoting UI labels exactly as the app shows them.

## Gotchas
- Internal names still say `lumen` (`window.lumen`, `lumen://`, `persist:lumen`, `LUMEN_*` env vars). Keep them: the `persist:lumen` partition holds his site logins. `main.js` also migrates old `~/.config/Lumen` data.
- The repo is private by decision (2026-11-02), so README download links and the one-line installers work only for Jakub. That is not a bug. Don't make the repo or releases public without asking.
- Windows: CLIs are spawned without a shell and npm `.cmd` shims are parsed in `lib/ai.js`. Keep that path working when touching CLI spawning.
- MV3 extension popups need the real Chromium sandbox (`npm run fix-sandbox` when running from source).
- `@ghostery/adblocker*` packages are pinned to 2.20.1 through `overrides`; bump them together.
- Other Claude sessions often work in this repo at the same time: check `git status` first and never commit files you didn't change.

## Don't
- Don't rename `build.appId` (`cz.didkovsky.pulse`) or the `persist:lumen` partition.
- Don't commit `dist/` or `node_modules/` (both gitignored).
