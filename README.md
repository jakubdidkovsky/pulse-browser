# Pulse ✦

A Chromium (Electron) browser with AI built right in. The interface takes its cues from Apple.

## Install

### Windows 10 and 11

1. Download **[Pulse-Setup-x64.exe](https://github.com/jakubdidkovsky/pulse-browser/releases/latest/download/Pulse-Setup-x64.exe)**.
   On an ARM PC (Snapdragon, Surface Pro X): [Pulse-Setup-arm64.exe](https://github.com/jakubdidkovsky/pulse-browser/releases/latest/download/Pulse-Setup-arm64.exe).
2. Open the downloaded file. Pulse installs and starts on its own. It asks nothing and needs no admin rights.
3. You'll find Pulse on the desktop and in the Start menu.

If Windows shows the blue *“Windows protected your PC”* window, click **More info → Run anyway**. The installer isn't code-signed yet.

Or use one command in PowerShell (it picks the right version for your processor):

```powershell
irm https://raw.githubusercontent.com/jakubdidkovsky/pulse-browser/main/install.ps1 | iex
```

- **Default browser:** Settings → Apps → Default apps → Pulse → *Set default*.
- **Update:** download and run the installer again. Your tabs, logins and settings stay.
- **Uninstall:** Settings → Apps → Installed apps → Pulse → *Uninstall*.

### Linux

One command in the terminal. Works on Ubuntu, Debian, Mint, Pop!_OS, Fedora, openSUSE, Arch and others:

```bash
curl -fsSL https://raw.githubusercontent.com/jakubdidkovsky/pulse-browser/main/install.sh | bash
```

It detects your distribution and processor (Intel/AMD or ARM), downloads the right package, checks its checksum, installs it and opens Pulse. After that it's in your app menu. Run the same command to update.

- **Without an admin password** (just for you, into `~/.local`): `curl -fsSL …/install.sh | bash -s -- --appimage`
- **Uninstall:** `curl -fsSL …/install.sh | bash -s -- --uninstall`
- **Default browser:** Settings → Default Applications → Web → Pulse.

Or download a package yourself:

| System | Intel / AMD | ARM | Install |
|---|---|---|---|
| Ubuntu, Debian, Mint, Pop!_OS, Zorin | [Pulse-amd64.deb](https://github.com/jakubdidkovsky/pulse-browser/releases/latest/download/Pulse-amd64.deb) | [Pulse-arm64.deb](https://github.com/jakubdidkovsky/pulse-browser/releases/latest/download/Pulse-arm64.deb) | double-click, or `sudo apt install ./Pulse-amd64.deb` |
| Fedora, openSUSE, RHEL | [Pulse-x86_64.rpm](https://github.com/jakubdidkovsky/pulse-browser/releases/latest/download/Pulse-x86_64.rpm) | [Pulse-aarch64.rpm](https://github.com/jakubdidkovsky/pulse-browser/releases/latest/download/Pulse-aarch64.rpm) | `sudo dnf install ./Pulse-x86_64.rpm` |
| Anything else | [Pulse-x86_64.AppImage](https://github.com/jakubdidkovsky/pulse-browser/releases/latest/download/Pulse-x86_64.AppImage) | [Pulse-arm64.AppImage](https://github.com/jakubdidkovsky/pulse-browser/releases/latest/download/Pulse-arm64.AppImage) | `chmod +x Pulse-*.AppImage`, then double-click |

Your data (tabs, history, logins, settings) lives in `~/.config/Pulse/` (Linux) and `%APPDATA%\Pulse` (Windows). Uninstalling doesn't delete it.

### From source (development)

```bash
cd ~/aibrowser
npm install          # once
npm start
```

Optional:

```bash
npm run install-desktop   # adds the development build to the app menu (Linux)
npm run fix-sandbox       # turns on the full Chromium sandbox (Ubuntu 24.04+, needs sudo)
```

### Releasing a new version

```bash
npm version patch          # 1.0.0 → 1.0.1, creates a commit and the tag v1.0.1
git push --follow-tags     # GitHub Actions builds every installer and publishes a release
```

The download links above always point to the latest release. Local builds: `npm run dist` (packages for this system into `dist/`), `npm run dist:linux`, `npm run dist:win` (needs wine on Linux).

## Features

| | |
|---|---|
| **AI panel** (`Ctrl+E`) | A side panel you can hide. The AI sees the page text, your selection, open tabs and recent activity, and optionally a screenshot of the page. Add more tabs to the context with `+`. |
| **AI sign-in** | **Subscriptions:** Claude (via Claude Code), ChatGPT (Codex CLI), Cursor (cursor-agent), Gemini CLI. **API keys:** Anthropic, OpenAI, Gemini, OpenRouter, Ollama (local). **Web:** Claude.ai, ChatGPT, Gemini, Perplexity and Cursor right in the panel; the “Send page” button pastes the page into the chat. |
| **AI agent** (the *Agent* switch in the panel) | Drives the page with its own cursor: clicks, types, scrolls, opens pages and tabs. It asks before risky steps (paying, sending, deleting). Works through Claude Code (your subscription) or the Claude API (fastest). Conversations carry on (Claude Code `--resume`). |
| **Change the task while it runs** | While the agent works, keep typing. It gets your message at its next step and changes or extends the task. If it finishes first, it takes the message as the next task. In chat, messages sent during an answer wait in a queue. |
| **Custom commands** (Settings → Commands) | Saved tasks with your own rules that you run with a slash: for example `/order` = “find the order form, fill in my details, stop before sending and show me a summary”. Type `/` in the AI panel and pick a command (arrows and Enter or Tab, or click). Whatever you type after the name is added to the rules: `/order 2x margherita`. You don't have to write the rules yourself: **Write with AI** drafts them from the name and description, and if you already have a few notes (“go to the canteen site, order what I type”), **Improve with AI** turns them into clear steps. Missing details are left in [square brackets] for you to fill in, and Ctrl+Z brings back your earlier text. A command always runs as the agent, even in *Ask* mode, and works from your phone too. An empty agent chat offers your commands as buttons. The rules are sent to the model only when you use the command (and again when a long conversation starts fresh), so otherwise they cost nothing. The agent always asks before paying. Otherwise a command's rules count as your own instructions: if they say “send”, it sends without asking. |
| **Large message box** | The message box in the AI panel grows with your text up to 40% of the panel height. Drag its top edge to make it taller and Pulse remembers the size. Double-click the edge to go back to automatic sizing. |
| **Favorites bar** (`Ctrl+Shift+B`) | Pinned pages sit at the top under the address bar. Until you pin something, the bar stays hidden (it shows up while you drag a tab, so you can pin it). Ctrl/middle-click opens a fresh copy, right-click lets you rename or unpin. Drag to reorder. Whatever doesn't fit is under the arrow. Switch its place (top or sidebar) in Settings → General. |
| **Chat vs. agent** | *Agent* is the default: it answers questions straight from the page, and when something needs doing, it does it. In *Ask* mode, actions (find, open, order…) switch to the agent on their own. |
| **Automatic model choice** | For Claude (through Claude Code or an API key) the default model is *Auto*: simple one-step tasks (“open gmail”, “summarize this page”) go to Haiku, regular work to Sonnet, and research, decisions on the web or a retry after a failed attempt to Opus. The model is picked once per conversation (a prompt cache belongs to one model) and can only get stronger during it. You see which model answered under each reply. Pick a fixed model in Settings → AI. |
| **Agent permissions** | The pill in the panel or Settings → AI → *Agent asks before…*. **Normal**: asks before sending emails and messages, deleting, creating and editing in apps, commands on your computer, and paying. **Full**: does everything on its own and asks only before paying. Or set each one separately (e.g. sends messages on its own but asks before deleting). Paying and commands like `rm -rf`, `sudo` or `git push --force` always ask. |
| **Research and recommendations** | “Find me the best…”, “which … should I buy”, “compare”: the agent works like a person would. It works out what “best” means for you (requirements, use, where you live: in Czechia that means Czech shops and CZK), reads 2 to 4 sources (reviews, user experiences, the maker's page to check requirements such as Linux drivers), picks one option and at most two alternatives, and **opens them in tabs** (the winner in front, side by side when it's close). Then it explains why in the chat. Settings → AI → *Thinking*: *Auto* (the default) thinks hard only for research and decisions and does simple clicks quickly. |
| **Images in chat** | Ctrl+V or drag an image into the message box (up to 5). The agent sees it, and so does chat with models that handle images. The agent can search with it through Google Lens or put it on a board. |
| **Cheaper long conversations** | A long conversation, or one you come back to after an hour, isn't reloaded in full (with all the old page snapshots). The agent starts fresh with a short recap of what you worked on. The page snapshots the agent reads also drop tracking parameters from links (`utm_`, `sxsrf`, `ved`…): the same elements and text for 17% fewer tokens. After a click or typing, the agent gets only what's on screen (about a third of a normal page snapshot) and reads the whole page when it needs to. |
| **Pulse usage** (Settings → Usage, or click the % ring in the AI panel) | Only what Pulse uses, without Claude Code in the terminal or claude.ai: the number of tasks and chats, tokens, cost at API prices and time for today / 7 / 30 days, a chart by day and a breakdown by site and model. Your whole Claude account's limit is there for comparison. The data stays on your computer for 90 days. |
| **Share of your Claude limit** | Settings → Usage → *Share of your Claude plan*: roughly what % of the 5-hour and weekly limits Pulse takes and what % one task is. It's an estimate: Pulse compares its own usage with all of Claude Code on this computer (it reads the local transcripts in `~/.claude/projects` and sends nothing anywhere). |
| **Limit indicator** | The AI panel header has a ring showing how much of your Claude plan is left (the 5-hour and weekly limits, reset time in the tooltip). With an API key it shows the conversation's cost. |
| **Private window** (`Ctrl+Shift+N`) | A separate window with its own look: no history, sessions, cookies on disk, AI chats or files. Closing the window erases everything. |
| **Tab rules** | “At most N tabs from one site, close the extra ones after X minutes idle”, for all sites or specific ones (e.g. notion.com). Settings → General, or just tell the agent. |
| **Start page** | Most visited, your own shortcuts, or nothing (the *Customize* button at the bottom right, or Settings → General). |
| **Claude connectors** | The agent (through Claude Code) also uses what you've connected in Claude: Gmail, Google Calendar, Notion, Slack… The browser comes first, though: when you say “go to my mail” or “mark it in Notion”, it does it in a tab so you can watch. It uses a connector when you ask for it, or when no page fits the task. Connector tools load only when the agent needs them, so tasks don't cost more than they must. Reading happens right away; sending, creating, editing or deleting needs your approval (Allow / Always allow / Don’t allow). Turn single connectors on or off in Settings → AI → Connectors. A claude.ai connector that's off doesn't connect at all, so tasks start sooner (every connector that's on connects at the start of each task). A connector that hasn't connected within 3 s sits that task out, and the agent uses the browser. Claude Code plugins are off by default. |
| **Never close** | Right-click a tab → *Never Close Automatically* (lock icon). No rule, archiving, sleeping or AI tidy-up closes that tab. You can still close it yourself. |
| **Working on your computer** | The agent (through Claude Code) runs commands and reads and edits files in a folder you choose, like `claude` in the terminal. Pick the folder with the folder button under the chat. It shows commands and file changes in a preview (terminal, file diff) and waits for your *Run / Allow for this task / Don't allow*. Claude Code allows simple read-only commands (`ls`…) on its own. |
| **Phone remote** (Settings → Remote) | Turn on *Control Pulse from your phone* and scan the QR code with your phone. Your phone gets three screens: **Chat** (give the agent a task, follow its steps, answer its questions and approve what it asks, just like in the panel), **Screen** (a live view of the current tab: tap to click, drag to scroll, pinch to zoom, type into the page with the keyboard) and **Tabs** (switch, close, open a new one). The connection goes through [Tailscale](https://tailscale.com/download): install it on your computer and phone with the same account and it works from anywhere. Local Wi-Fi works only if you allow it (*Also allow on local Wi-Fi*, then choose *Tailscale* or *Same Wi-Fi* above the QR code). If the link just keeps loading on your phone, the phone isn't on your Tailscale network, and Settings → Remote tells you so. A code works once and for 15 minutes; see and remove paired phones in Settings → Remote. While a phone is connected, a phone icon shows in the toolbar. Pulse has to be running and the computer must not sleep (*Keep this computer awake*). |
| **Floating chat** | A button in the chat header pops it out into a floating window. Move it by the three dots at the top or by the header, resize it from the corner. The same button or a double-click on the header docks it back on the right. |
| **Split view** | **Drag a tab onto the page:** drop it on the left, right, top or bottom half (*Open on the Left*, *Open on the Right*, …) and the window splits with the tab on that side. In a split, drop a tab onto a part to put it there (*Replace Page*, or *Swap Pages* for a tab that's already in the split); drag a part's header to move that page. The frame button next to the address bar: 2 pages side by side, 2 stacked, or 4 in a grid. New parts start empty: pick a page there, type an address, or drag a tab in. The active page has a highlighted title in its header, and the address bar and AI follow it. The part the agent is working in has a purple frame. A tab opened from the sidebar fills an empty part first, otherwise the active part. Drag the gap between parts to resize them; double-click it to go back to half and half. Right-click a tab → *Open in Split View* / *Remove from Split View*. **Closing:** each part's header has ▢ (keep only this page) and × (remove from the split), or use the layout button → *Close Split View*. Closing one of two pages ends the split. The agent can do it too (“put X and Y side by side”). |
| **Chrome extensions** | On the [Chrome Web Store](https://chromewebstore.google.com) click *Add to Chrome*; it installs into Pulse. Before installing, you see what the extension will have access to. Extension icons sit next to the address bar (click opens the extension, right-click its menu). Manage them in `⋯` → *Extensions…* or Settings → Extensions. Menus of MV3 extensions (e.g. Dark Reader) need the Chromium sandbox. The `.deb`/`.rpm` packages and the Windows installer have it. When running from source, run `npm run fix-sandbox` once. Extensions don't run in a private window. |
| **Boards and diagrams** (the button next to the address bar) | Draw over the page and make diagrams like in draw.io. **Shapes:** rectangle, start/end, decision, input/output, database, document, hexagon, cloud, person, ellipse, triangle (R, O, D; more after a second click on the shape). **Connectors** (A) snap to shapes and move with them: straight, right-angled or curved, solid or dashed, with an arrow at one end, both or neither; double-click to add a label. Drag a connector's end onto another shape. **Quick connect:** hover a shape and click one of its four arrows: the same shape appears next to it, joined by an arrow, and you type its text right away. Drag an arrow to draw a connector wherever you want. **Frames** (F) group shapes under a title and move with their contents. Grid and snapping (Alt turns it off), a format bar above the selection (shape, fill, font size, connector style, alignment, bring forward/send back), Ctrl+D duplicates, Ctrl+C / Ctrl+V copies, the arrow keys nudge. *Tidy up the diagram* rearranges it top to bottom or left to right. **draw.io:** Board → *Open draw.io File…* opens a `.drawio` file, *Save as draw.io File…* saves the board so draw.io can open and edit it. You can also drag a `.drawio` file onto the board. Plus pen, text, sticky notes, eraser, images (Ctrl+V, drag and drop, the camera button), Undo/Redo, panning (scroll wheel, space + drag) and zoom (Ctrl + scroll wheel). A **temporary** board is deleted when you close it (×); a **saved** one stays in the board list. **Agent:** “draw me a diagram of…” and it builds one from the right shapes and connectors, lays it out itself, edits single steps and sees what you draw too. Together, live: “let's draw together” and it reacts to your strokes until you type stop. |
| **Ask AI About This** | Right-click anywhere on a page. The AI gets what you're pointing at: the text, link or image, its position on the page, a selector, the section heading, the surrounding text, and for tables the column and row. Models that see images also get a crop of the screen. Then type “what is this” or “click it”. The agent has the element marked in its view of the page. |
| **Google Lens** | Right-click an image → *Search Image with Google Lens*. The agent uses it on its own when the question is about how something looks (find similar, where to buy it, what it is). |
| **Cookie banners** | Settings → Privacy: *Smart* (rejects optional cookies and accepts only where there's no other choice), *Reject*, *Accept* or *Off*. Uses DuckDuckGo Autoconsent rules plus its own fallback for unknown banners. Works on the agent's pages too. |
| **Ad blocking** | Built in, Settings → Privacy → *Block ads*: **Light** (the default: only ad servers from EasyList, hides nothing on the page, doesn't block Analytics or Tag Manager), **Medium** (also trackers and the empty spaces ads leave behind), **High** (also pop-ups, newsletter prompts and social widgets), or **Off**. Ghostery's ad blocker; the lists update daily. |
| **Site permissions** | Settings → Privacy: set *Ask / Allow / Block* for location, camera and microphone, notifications, clipboard, screen sharing and devices. Decisions for single sites are listed and deleted there too. |
| **Sign-in windows** | Pop-ups like “Sign in with Google” open as separate windows so sign-in works. The agent switches to them on its own, finishes signing in and goes back to the page. |
| **Chats in Obsidian** (Settings → AI → *Save chats to Obsidian*) | Off by default. When it's on, every Ask and Agent chat becomes a Markdown note in the folder you choose (the default is `~/Documents/Obsidian Vault/Claude/Chaty` when it exists), and the note keeps up as the chat goes on. Notes use the same properties as your Claude Code chat notes (`title`, `date`, `zdroj: Pulse (Agent)`, `tema`, the site in `web`) and the same topics, from the rules in `~/.claude/obsidian-sync/temata.json`, so they show up in your topic notes. Agent steps are in a folded *Kroky agenta* box. It costs no tokens: topics come from keyword rules, not from the AI. Deleting a chat in Pulse keeps its note; private windows are never saved. |
| **Site memory** | `~/Documents/Pulse/sites/<site>/CONTEXT.md` holds what the agent has learned about a site (and anything you add). `sessions/*.md` are full transcripts of every session, tool calls included. |
| **Tab tidy-up** (the *Tidy* button) | Group tabs with AI, close tabs you don't need with AI, sort by last used / site / title, close duplicates and tabs unused for 1 hour up to a week. Everything can be undone with Undo. |
| **Links in a new tab** | A link that a page opens in a new tab (in Slack, for example) opens in front and Pulse switches to it, even when the site or a Ctrl/middle-click asks for a background tab. Turn it off in Settings → General → *Switch to links opened in a new tab*. *Open Link in Background* from the right-click menu always stays in the background. |
| **Automatic cleanup** | Tabs unused for 45 minutes go to sleep (freeing memory), and tabs not opened for a day are archived. Only time while Pulse runs counts. Both are set in Settings → General. Archive: History → Archived Tabs. |
| **Groups** | Colored groups in the sidebar with rules, e.g. `notion.so` → always into the “Work” group. You can also drag tabs into groups. |
| **Tabs on top** (Settings → Appearance → *Tabs*) | *Sidebar* (the default) lists tabs and groups down the left side. *Top* puts them in a row above the address bar, like Chrome: groups are colored labels you click to fold, tabs shrink to their icon when there are many and the row scrolls, and pinned pages stay in the favorites bar. Drag, right-click and middle-click work the same as in the sidebar. Also in `⋯` → *Tabs on Top*. |
| **Pinning** (`Ctrl+D`) | Pinned sites sit at the top of the sidebar as tiles. Closing one only puts it to sleep. You can also pull a tab out into a **floating window** that stays above other windows. Keep the whole window on top with `⋯` → Keep Window on Top. |
| **History** (`Ctrl+Y`) | Search, grouped by day, delete single entries or ranges. |
| **Command bar** (`Ctrl+T` / `Ctrl+K`) | Opens a site, searches, switches tabs, searches history, runs an action, or asks the AI directly. |
| **Address autocomplete** (Settings → General → *Autocomplete addresses*) | Start typing an address in the command bar or on the start page and Pulse fills in the rest, like Chrome: your pinned pages first, then the sites you visit most. Type “gi” and you get “github.com”; Enter goes there, Backspace removes the suggestion. In the command bar a pinned page also comes up by its name (“gma” for Gmail) and Enter switches to its tab. On by default. |
| **More** | Session restore, find in page, zoom, downloads, site permissions, light/dark mode and accent color. |

## First launch

On first launch Pulse walks you through a short setup: which AI to use, what the agent may do (your computer, connectors, asking before sending), cookie banners and site permissions, tab cleanup and appearance. Run it again from Settings → About → *Run Setup Again* or from the command bar (“Welcome & Setup”).

## Keyboard shortcuts

`Ctrl+T` new tab · `Ctrl+L` address · `Ctrl+W` close · `Ctrl+Shift+T` reopen closed · `Ctrl+Tab` next tab · `Ctrl+1…9` tab N · `Ctrl+E` AI · `Ctrl+\` sidebar · `Ctrl+D` pin · `Ctrl+Shift+B` favorites bar · `Ctrl+Shift+N` private window · `Ctrl+F` find · `Ctrl+Y` history · `Ctrl+,` settings

## Notes

- API keys are encrypted with the system keychain (`safeStorage`) and the renderer never sees them.
- CLI providers run in an empty folder without tools (Claude Code with `--tools ""`, Codex in `read-only` mode).
- Data: `~/.config/Pulse/` (Linux), `%APPDATA%\Pulse` (Windows).
