'use strict';
// Browser tools the agent can call. Shared by the MCP server (Claude Code) and the Claude API loop.

const ACTION_TYPES = ['click', 'type', 'press', 'select', 'scroll', 'hover', 'wait'];

const TOOLS = [
  {
    name: 'browser_snapshot',
    description: 'Read the controlled tab: URL, title, visible text, and a numbered list of interactive elements like `[12] button "Sign in"`. Use the numbers as `ref` in browser_act. Refs are only valid for the latest snapshot. By default only elements in or near the viewport are listed; pass full=true for the whole page.',
    input_schema: {
      type: 'object',
      properties: { full: { type: 'boolean', description: 'List interactive elements of the entire page.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_act',
    description: [
      'Perform one or more actions in the controlled tab, in order, with a visible cursor. Returns a fresh snapshot afterwards, so you do not need to call browser_snapshot after acting.',
      'Batch steps that do not depend on each other (e.g. fill every field of a form, then click submit) to save time.',
      'Action shapes:',
      '- {"type":"click","ref":12} (add "double":true for a double click)',
      '- {"type":"type","ref":13,"text":"hello","clear":true,"submit":false}: clicks the field, replaces its content (clear defaults to true) and types; submit=true presses Enter afterwards. Omit ref to type into the focused element.',
      '- {"type":"press","key":"Enter"}: keys: Enter, Escape, Tab, Backspace, Delete, ArrowUp/Down/Left/Right, PageUp, PageDown, Home, End, Space, or combos like "Control+A".',
      '- {"type":"select","ref":14,"value":"Option text or value"}: for <select> elements.',
      '- {"type":"scroll","direction":"down","amount":0.8} (amount in screens) or {"type":"scroll","ref":20} to bring an element into view.',
      '- {"type":"hover","ref":15}',
      '- {"type":"wait","ms":800}',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ACTION_TYPES },
              ref: { type: 'integer' },
              text: { type: 'string' },
              clear: { type: 'boolean' },
              submit: { type: 'boolean' },
              key: { type: 'string' },
              value: { type: 'string' },
              direction: { type: 'string', enum: ['up', 'down'] },
              amount: { type: 'number' },
              ms: { type: 'integer' },
              double: { type: 'boolean' },
            },
            required: ['type'],
          },
        },
      },
      required: ['actions'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_navigate',
    description: 'Load a URL in the controlled tab, or go "back" / "forward" / "reload". Returns a snapshot of the loaded page.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'A full URL, or "back", "forward", "reload".' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_tabs',
    description: 'Work with tabs. action="list" lists every open tab with its id, group, when the user last looked at it, whether it is pinned/sleeping/a duplicate, plus the existing groups. "open" opens url in a new tab and makes it the controlled tab; "switch" makes tab_id the controlled (and visible) tab; "close" closes tab_ids (or tab_id). Pop-up windows (e.g. "Sign in with Google") are listed separately with ids like "popup-12"; switch/close work on them too. Closed tabs go to the archive and the user gets an Undo button, so closing is safe. "split" shows 2 to 4 tab_ids side by side in split view (layout "cols" = side by side, "rows" = stacked; 3 or 4 tabs always use a 2×2 grid); "unsplit" goes back to a single page.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'open', 'switch', 'close', 'split', 'unsplit'] },
        url: { type: 'string' },
        tab_id: { type: 'string' },
        tab_ids: { type: 'array', items: { type: 'string' } },
        layout: { type: 'string', enum: ['cols', 'rows'] },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'tabs_organize',
    description: 'Reorganize many tabs in one call (get ids from browser_tabs list first). groups: put tabs into named groups; an existing group with the same name is reused, otherwise it is created; color is one of blue, purple, pink, red, orange, yellow, green, teal, indigo, gray; rules are domains that should always open in that group (e.g. "notion.so"). ungroup/pin/unpin/sleep/close take tab ids (sleep unloads a tab to save memory but keeps it in the sidebar; close archives it with Undo). sort reorders tabs within their sections. Returns the updated tab list.',
    input_schema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              color: { type: 'string' },
              rules: { type: 'array', items: { type: 'string' } },
              tab_ids: { type: 'array', items: { type: 'string' } },
            },
            required: ['name'],
          },
        },
        ungroup: { type: 'array', items: { type: 'string' } },
        pin: { type: 'array', items: { type: 'string' } },
        unpin: { type: 'array', items: { type: 'string' } },
        sleep: { type: 'array', items: { type: 'string' } },
        close: { type: 'array', items: { type: 'string' } },
        sort: { type: 'string', enum: ['last_used', 'site', 'title'] },
        delete_empty_groups: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tabs_settings',
    description: 'Read or change Pulse\'s automatic tab housekeeping. Call with no fields to read the current settings. A rule {site, max, idle, enabled} means: when more than `max` tabs are open from `site` (empty site = any site, counted per domain), close the least recently used extras once they have been unused for `idle` minutes. `rules` replaces all rules, `add_rules` appends, `remove_rule_ids` deletes by id. sleep_after_minutes unloads idle tabs to save memory (0 = never); archive_after_hours archives tabs not opened for that long (0 = never). Pinned and active tabs are never affected.',
    input_schema: {
      type: 'object',
      properties: {
        rules: { type: 'array', items: { type: 'object', properties: { site: { type: 'string' }, max: { type: 'integer' }, idle: { type: 'integer' }, enabled: { type: 'boolean' } } } },
        add_rules: { type: 'array', items: { type: 'object', properties: { site: { type: 'string' }, max: { type: 'integer' }, idle: { type: 'integer' }, enabled: { type: 'boolean' } } } },
        remove_rule_ids: { type: 'array', items: { type: 'string' } },
        sleep_after_minutes: { type: 'integer' },
        archive_after_hours: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'whiteboard_draw',
    description: 'Draw on Pulse\'s whiteboard. It appears over the page so the user watches it. Use it for diagrams, plans, flows, mind maps, comparisons or quick sketches, and whenever the user asks to show/draw/sketch something ("nakresli", "na tabuli"). Opens a board if none is open (temporary unless save is true). elements are added, or replace an existing element with the same id. Types: rect / ellipse {x, y, w, h, text?, color?, fill?}; sticky {x, y, text, w?, h?, color?} (a sticky note); text {x, y, text, w?, fontSize?, color?}; line / arrow {x, y, x2, y2} or {from: id, to: id} to connect two shapes (text = label on the line); path {points: [[x, y], …]}; image {src, x, y, w?, h?, alt?} where src is an image URL, "screenshot" (the page you control) or "attached:1" (an image the user pasted). Give shapes short ids ("step1", "db") so arrows can connect them. Colors: ink, gray, blue, red, green, orange, purple, yellow. About 1200×700 is visible at first; lay things out left→right / top→bottom with ~40 px gaps and keep text short. remove: ids to delete. clear: start from an empty board.',
    input_schema: {
      type: 'object',
      properties: {
        elements: { type: 'array', items: { type: 'object' } },
        remove: { type: 'array', items: { type: 'string' } },
        clear: { type: 'boolean' },
        title: { type: 'string' },
        save: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'whiteboard_wait',
    description: 'Work on the whiteboard together with the user: waits until the user draws, moves, writes or deletes something (or timeout_seconds pass, default 60), then returns exactly what they changed plus a picture of the board. Use it in a loop when the user wants to draw/plan/brainstorm together or asks you to react to their sketch: whiteboard_wait → decide what helps (label, connect, organize, add the next idea, correct) → whiteboard_draw → whiteboard_wait again, until the user says they are done. Returns early if the user writes in the chat.',
    input_schema: { type: 'object', properties: { timeout_seconds: { type: 'number' } }, additionalProperties: false },
  },
  {
    name: 'whiteboard_read',
    description: 'See what is on the whiteboard right now: every element with its id, type, text and position, plus a picture of the board (it includes what the user drew by hand). Use it before changing a board the user worked on, or when they ask about their sketch.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'browser_history',
    description: 'Search the user\'s browsing history in Pulse (every page they visited, plus closed and archived tabs). Use it FIRST whenever the user refers to something they used or saw before ("that form", "the order form", "the page from yesterday", "jak minule", "ten formulář"), before searching the web, connectors or files on the computer. query: words matched in the title or URL (case and diacritics ignored; try a few variants, e.g. "objednavka", "order", "forms.gle docs.google.com/forms"); empty query = most recent pages. days: only the last N days. Returns title, URL, when last visited and visit count; open one with browser_navigate or browser_tabs open.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'image_search',
    description: 'Search Google Lens with an image from the page: finds visually similar items, the same product in shops (with prices), or what something is. Pass ref of the image or of the card/link containing it (from the latest snapshot); without ref it uses the image the user pointed at, else the largest image in view. Or pass image_url (a web address, or "attached:1" for the first image the user pasted into their message). Opens the Lens results in a new tab, makes it the controlled tab and returns its snapshot. Use this whenever what matters is how something looks; never guess text queries for that.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'integer' },
        image_url: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_read',
    description: 'Return the full text content of the page (or of one element by ref). Use for reading long articles, tables or results that the snapshot cuts off.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'integer' }, max_chars: { type: 'integer' } },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the controlled tab. Use only when visual layout matters (images, charts, canvas apps); the snapshot is faster for everything else.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ask_user',
    description: 'Ask the user a question and wait for the answer. Use it to confirm irreversible or sensitive actions (payments, purchases, sending messages, deleting data, account changes) and when information is missing.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, description: 'Optional quick answers, e.g. ["Yes, do it", "No"].' },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'name_ids',
    description: 'Tell Pulse what the IDs in your next connector action are, so the user\'s approval card shows names instead of codes: the database or page it goes into, people, channels, calendars. Keys are the IDs as you will use them (with or without "user://", "collection://"), values short names like "Tasks" or "Jakub Didkovský (you)". Call it in its own step right before the action, only with names you actually know.',
    input_schema: {
      type: 'object',
      properties: { names: { type: 'object', additionalProperties: { type: 'string' } } },
      required: ['names'],
      additionalProperties: false,
    },
  },
  {
    name: 'site_memory_save',
    description: 'Remember a short, factual note for future tasks. scope "site" (default): about the current website (where things are, workflows that worked). scope "general": about the user or their computer, not tied to one site (default apps like their terminal, preferences, names, how they like things done). Notes are shown to you in later sessions.',
    input_schema: {
      type: 'object',
      properties: { note: { type: 'string' }, scope: { type: 'string', enum: ['site', 'general'] } },
      required: ['note'],
      additionalProperties: false,
    },
  },
];

// Claude Code routes permission prompts for connector tools (Gmail, Slack…) here; Pulse asks the user.
const APPROVE_TOOL = {
  name: 'approve_tool',
  internal: true,
  description: 'Internal to Pulse: used automatically to ask the user for permission. Never call this yourself.',
  input_schema: {
    type: 'object',
    properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
    required: ['tool_name'],
  },
};
TOOLS.push(APPROVE_TOOL);

// Minimal argument validation (the API's eager streaming can deliver truncated inputs).
function validate(name, input) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return `Unknown tool: ${name}`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Tool input must be a JSON object.';
  for (const req of tool.input_schema.required || []) {
    if (!(req in input)) return `Missing required field "${req}".`;
  }
  if (name === 'browser_act') {
    if (!Array.isArray(input.actions) || !input.actions.length) return '"actions" must be a non-empty array.';
    for (const a of input.actions) {
      if (!a || !ACTION_TYPES.includes(a.type)) return `Invalid action type: ${JSON.stringify(a?.type)}.`;
    }
  }
  return null;
}

const toolNames = () => TOOLS.filter((t) => !t.internal).map((t) => t.name);

module.exports = { TOOLS, validate, toolNames };
