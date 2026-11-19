// Session control through the host: find panes, type into Claude Code, read the
// screen, launch sessions. The host replaces tmux on Windows; see host/host.mjs.
import { basename } from "node:path";
import { join } from "node:path";
import { DATA_DIR, HOST_PIPE } from "./config.mjs";
import { HostClient, defaultPipe, ensureHost, resolveClaude, styledScreen } from "../host/client.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOST_LOG = join(DATA_DIR, "logs", "host.log");

/** One control connection per host pipe, reused across calls. */
const clients = new Map();
function clientFor(pipe = HOST_PIPE) {
  let c = clients.get(pipe);
  if (!c) {
    c = new HostClient(pipe);
    clients.set(pipe, c);
  }
  return c;
}

/**
 * A pane is identified by its host's pipe plus the host's session id, the way a
 * tmux pane is identified by socket path plus pane id.
 * @typedef {{host: string, pane: string}} Target
 */
export function paneKey(target) {
  if (!target?.pane || !target?.host) return null;
  return `${target.host.toLowerCase()}|${target.pane}`;
}

/** Target for the pane a hook reported, or null when it didn't run in a host. */
export function targetFromHook({ host, pane }) {
  if (!host || !pane) return null;
  return { host, pane };
}

async function host(target, op, params = {}, opts) {
  return clientFor(target.host).request(op, { session: target.pane, ...params }, opts);
}

/** True when the session still exists in its host. A host that's gone means no. */
export async function paneAlive(target) {
  try {
    return (await host(target, "alive")).alive === true;
  } catch {
    return false;
  }
}

/** Name and process id the host has for a pane, if it still has it. */
export async function paneInfo(target) {
  try {
    const r = await host(target, "alive");
    return r.alive ? { name: r.name, pid: r.pid } : null;
  } catch {
    return null;
  }
}

export async function capture(target, lines = 60) {
  const { text } = await host(target, "screen", { lines });
  return text.replace(/\s+$/gm, "");
}

/**
 * Numbered options that came back as one line, each on a line of its own. A host
 * started before it learned better joins a redrawn row to the one above (see
 * screen() in host/host.mjs), and it keeps running while it has sessions:
 * "❯ 1. Yes  2. No" would be read as a single option called "Yes  2. No".
 */
function splitOptions(line) {
  const out = [];
  let rest = line;
  for (;;) {
    const n = /^\s*(?:❯\s*)?(\d+)\.\s/.exec(rest)?.[1];
    // Only the next number, after the indent of an option's row or the cursor, so
    // a number inside a label stays there.
    const next = n && `${Number(n) + 1}\\.\\s`;
    const gap = n && new RegExp(`\\s{2,}(?=${next})|\\s+(?=❯\\s*${next})`).exec(rest);
    if (!gap) break;
    out.push(rest.slice(0, gap.index));
    rest = rest.slice(gap.index);
  }
  out.push(rest);
  return out;
}

/**
 * What is Claude Code showing at the bottom of the pane?
 * @returns {{kind: "permission"|"question"|"trust"|"input"|"unknown", options: string[]}}
 */
export function readDialog(screen) {
  // A rule that fills the row comes back joined to the row under it, as one wrapped
  // row, so the input box reads "────…────❯ text". Put the line break back.
  const rows = String(screen).replace(/^(─{20,})(?!─)(?=.*\S)/gm, "$1\n");
  const tail = rows.split("\n").flatMap(splitOptions).filter((l) => l.trim()).slice(-30);
  const joined = tail.join("\n");
  const options = [];
  for (const l of tail) {
    const m = /^\s*(?:❯\s*)?(\d+)\.\s+(.+?)\s*$/.exec(l);
    if (m) options[Number(m[1]) - 1] = m[2];
  }
  // The UI redraws constantly, and a read taken mid-redraw can miss a line. A
  // numbered list with a hole is such a read: compacting it would shift every
  // index after the hole, so the dialog isn't ready rather than wrong.
  const complete = options.length > 0 && Array.from(options).every(Boolean); // from(): holes become undefined, every() alone skips them
  const clean = complete ? options : [];
  if (/Yes, I trust this folder/.test(joined)) return { kind: "trust", options: clean };
  const asked = /^\s*(Do you want to [^?]*\?)/im.exec(joined)?.[1];
  if (asked && /Do you want to (proceed|make this edit|create|allow)/i.test(asked) && clean.length) return { kind: "permission", options: clean, prompt: asked };
  if (/Enter to select/.test(joined) && clean.length) return { kind: "question", options: clean };
  if (!complete && options.length) return { kind: "unknown", options: [] };
  if (/^\s*❯\s*/m.test(tail.slice(-4).join("\n"))) return { kind: "input", options: [] };
  return { kind: "unknown", options: clean };
}

/**
 * Whether the screen says a turn is running. The input box is on screen during a
 * turn as well, and only the footer under it tells the two apart.
 */
export function showsWorking(screen) {
  const tail = String(screen).split("\n").filter((l) => l.trim()).slice(-4);
  return /esc to interrupt/.test(tail.join("\n"));
}

/** Whether text is dim after an SGR sequence with these parameters. */
function dimAfter(params, dim) {
  const p = params.split(";");
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "" || p[i] === "0" || p[i] === "22") dim = false;
    else if (p[i] === "2") dim = true;
    else if (p[i] === "38" || p[i] === "48") i += p[i + 1] === "2" ? 4 : p[i + 1] === "5" ? 2 : 0; // a colour's own numbers
  }
  return dim;
}

/**
 * The prompt Claude Code suggests, read from a styled screen (see styledScreen):
 * dim text alone in the input box. Text the user typed isn't dim, so a box with
 * any of it holds no suggestion.
 */
export function suggestionIn(styled) {
  // What an attaching client is sent ends with terminal modes and then live output.
  const cells = String(styled || "").split("\x1b[?")[0];
  // The box sits under a full-width rule, and the two arrive as one wrapped row.
  const boxes = [...cells.matchAll(/─{20,}(?:\x1b\[[0-9;]*m)*❯([\s\S]*?)(?=(?:\x1b\[[0-9;]*m)*─{20,}|$)/g)];
  const input = boxes.at(-1)?.[1];
  if (!input) return null;
  let dim = false;
  let text = "";
  for (const m of input.matchAll(/\x1b\[([0-9;]*)([A-Za-z])|([^\x1b])/g)) {
    if (m[3] !== undefined) {
      if (/\s/.test(m[3])) text += " ";
      else if (dim) text += m[3];
      else return null; // typed text
    } else if (m[2] === "m") dim = dimAfter(m[1], dim);
    else if (m[2] === "C") text += " ".repeat(Number(m[1]) || 1); // cursor forward stands in for spaces
  }
  text = text.replace(/\s+/g, " ").trim();
  // A new session's box holds an example prompt in the same style.
  if (!text || /^Try "/.test(text)) return null;
  return text;
}

/** The prompt Claude Code is suggesting in this pane right now, or null. */
export async function readSuggestion(target) {
  return suggestionIn(await styledScreen(target.host, target.pane));
}

/**
 * Read the dialog until two consecutive reads agree and neither is a mid-redraw
 * miss, so a glasses tap lands on the option the glasses showed.
 */
export async function readDialogStable(target, { lines = 40, attempts = 6, gapMs = 70 } = {}) {
  let previous = null;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = readDialog(await capture(target, lines));
    const key = JSON.stringify(last);
    if (last.kind !== "unknown" && key === previous) return last;
    previous = key;
    await sleep(gapMs);
  }
  return last;
}

// Ctrl+X Ctrl+S, Claude Code's default chord for "send now" (chat:sendNow in its
// keybindings). Written as bytes rather than added to the host's key table: a host
// that is already running holds live sessions and keeps the table it started with.
const SEND_NOW = "\x18\x13";

/**
 * Type a prompt into Claude Code's input box and submit it. Enter queues a prompt
 * behind a turn in progress; with `now`, the send-now chord submits it instead,
 * which cuts that turn short and sends the prompt at once. On an idle session the
 * chord submits as Enter does.
 */
export async function sendPrompt(target, text, { now = false } = {}) {
  const flat = String(text).replace(/\r?\n+/g, " ").trim();
  if (!flat) return;
  await host(target, "write", { data: flat });
  await sleep(120); // let the TUI absorb a paste-sized burst before submitting
  if (now) await host(target, "write", { data: SEND_NOW });
  else await host(target, "key", { key: "Enter" });
}

const KEY_WHITELIST = new Set(["Escape", "Enter", "Up", "Down", "MenuUp", "MenuDown", "Tab", "BTab", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

export async function sendKey(target, key) {
  if (!KEY_WHITELIST.has(key)) throw new Error(`key not allowed: ${key}`);
  await host(target, "key", { key });
}

/**
 * Press an option number only if the expected dialog is on screen, so a digit
 * never lands in the prompt box by accident.
 */
export async function chooseOption(target, expectedKind, index) {
  const dialog = await readDialogStable(target);
  if (dialog.kind !== expectedKind) {
    throw Object.assign(new Error(`no ${expectedKind} dialog on screen (saw ${dialog.kind})`), { status: 409 });
  }
  if (index < 0 || index >= dialog.options.length || index > 8) {
    throw Object.assign(new Error(`option ${index + 1} not available`), { status: 400 });
  }
  await sendKey(target, String(index + 1));
  return dialog.options[index];
}

/**
 * Switch the session's model with /model, confirm the cache-reset dialog if it
 * appears, and put the user's saved default back: /model also rewrites the
 * default in settings.json, and a glasses switch should only change this session.
 */
export async function switchModel(target, model, settingsPath) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const readModel = () => {
    try {
      return JSON.parse(readFileSync(settingsPath, "utf8")).model;
    } catch {
      return undefined;
    }
  };
  const before = readModel();
  await sendPrompt(target, `/model ${model}`);
  const until = Date.now() + 4000;
  let confirmed = false;
  while (Date.now() < until) {
    await sleep(300);
    const screen = await capture(target, 30);
    const m = /(\d+)\.\s+Yes, switch to/.exec(screen);
    if (m && !confirmed) {
      await sendKey(target, m[1]);
      confirmed = true;
      continue;
    }
    if (/Set model to/.test(screen.split("\n").slice(-12).join("\n"))) break;
  }
  await sleep(300);
  const after = readModel();
  if (after !== before) {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (before === undefined) delete settings.model;
    else settings.model = before;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
  return { restoredDefault: after !== before ? before ?? null : null };
}

/** Answer a question with free text via its "Type something" option. */
export async function answerWithText(target, text) {
  const dialog = await readDialogStable(target);
  if (dialog.kind !== "question") throw Object.assign(new Error("no question on screen"), { status: 409 });
  const idx = dialog.options.findIndex((o) => /^Type something/i.test(o));
  if (idx < 0) throw Object.assign(new Error("question has no free-text option"), { status: 400 });
  await sendKey(target, String(idx + 1));
  await sleep(250);
  await sendPrompt(target, text);
}

export function sessionNameFor(cwd, taken) {
  const base = (basename(cwd || "") || "claude").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 24) || "claude";
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

/** Sessions in our host, by name. */
export async function listOurSessions(pipe = HOST_PIPE) {
  try {
    const { sessions } = await clientFor(pipe).request("list");
    return sessions;
  } catch {
    return []; // no host running
  }
}

/**
 * Start Claude Code in a detached session on our host, starting the host if needed.
 * @returns {Promise<{name: string, target: Target}>}
 */
export async function launchClaude({ cwd, args = [], claudeBin = "claude", env = {}, pipe = HOST_PIPE }) {
  const claude = resolveClaude(claudeBin);
  if (!claude) throw Object.assign(new Error("Claude Code not found on PATH"), { status: 503 });
  await ensureHost(pipe, { logFile: HOST_LOG, launcherDir: DATA_DIR });
  const taken = new Set((await listOurSessions(pipe)).map((s) => s.name));
  const name = sessionNameFor(cwd, taken);
  const r = await clientFor(pipe).request("new", { name, cwd, cmd: claude.cmd, args: [...claude.args, ...args], env, cols: 200, rows: 50 });
  return { name: r.name, target: { host: pipe, pane: r.id } };
}

/** Accept the folder-trust dialog if it appears within `waitMs`. */
export async function acceptTrustIfShown(target, waitMs = 8000) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    let dialog;
    try {
      dialog = readDialog(await capture(target));
    } catch {
      return false;
    }
    if (dialog.kind === "trust") {
      // The trust dialog is an unnumbered two-item menu with "No, exit" focused.
      // Which key moves it depends on the Claude Code version: the arrow key in
      // 2.1.328, the vi key and not the arrow before (see KEYS). So try them in
      // turn. The menu wraps, and a key sent while the dialog is still mounting is
      // dropped, so press only while "Yes" lacks the focus, and confirm only once
      // it has it.
      const yesFocused = async () => /Yes, I trust/.test((await capture(target, 20)).split("\n").find((l) => /❯/.test(l)) || "");
      const moves = ["Down", "MenuDown"];
      for (let attempt = 0; attempt < 6; attempt++) {
        await sleep(attempt ? 400 : 600);
        if (!(await yesFocused())) {
          await sendKey(target, moves[attempt % moves.length]);
          await sleep(400);
        }
        if (await yesFocused()) {
          await sendKey(target, "Enter");
          return true;
        }
      }
      return false; // leave it for the user rather than guess
    }
    if (dialog.kind === "input") return false;
    await sleep(400);
  }
  return false;
}

/** Wait until Claude Code shows its input prompt. */
export async function waitForInput(target, waitMs = 20000) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    try {
      if (readDialog(await capture(target)).kind === "input") return true;
    } catch {
      /* pane not ready */
    }
    await sleep(400);
  }
  return false;
}

/** Whitespace-insensitive snippet used to confirm a prompt reached Claude Code. */
export function promptSnippet(text) {
  return String(text).replace(/\s+/g, " ").trim().slice(0, 40);
}

export function screenHasSnippet(screen, snippet) {
  if (!snippet) return true;
  const flat = screen.replace(/\s+/g, " ");
  // Wrapped lines add spaces at arbitrary points, so also compare with spaces removed.
  return flat.includes(snippet) || flat.replace(/ /g, "").includes(snippet.replace(/ /g, ""));
}

export { defaultPipe };
