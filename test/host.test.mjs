import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import pty from "@lydell/node-pty";
import xterm from "@xterm/headless";
import { startHost } from "../host/host.mjs";
import { HostClient, KEYS, attach, consoleKnowsIndex, lineFeedsAsIndex, resolveClaude, styledScreen } from "../host/client.mjs";

const { Terminal } = xterm;

const WIN = process.platform === "win32";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pipe = `\\\\.\\pipe\\codeaside-test-${process.pid}-${Date.now()}`;

/** Poll until the screen contains `text` or time runs out. */
async function screenHas(c, session, text, ms = 5000) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    last = (await c.request("screen", { session, lines: 50 })).text;
    if (last.includes(text)) return last;
    await sleep(100);
  }
  throw new Error(`screen never showed ${JSON.stringify(text)}; last:\n${last}`);
}

test("host runs a console program, types into it, reads the screen and sees it end", { skip: !WIN && "Windows only" }, async () => {
  const host = startHost({ pipe, exitWhenIdle: false });
  await new Promise((r) => host.server.on("listening", r));
  const c = new HostClient(pipe);
  try {
    assert.equal((await c.request("ping")).sessions, 0);
    const s = await c.request("new", { name: "my project!", cwd: process.cwd(), cmd: process.env.ComSpec, args: ["/d", "/q", "/k"], cols: 80, rows: 24 });
    assert.equal(s.name, "my-project-");
    await screenHas(c, s.id, ">"); // the prompt
    await c.request("write", { session: s.id, data: "echo typed by the host" });
    await c.request("key", { session: s.id, key: "Enter" });
    const screen = await screenHas(c, s.id, "\ntyped by the host");
    assert.match(screen, /echo typed by the host/);
    const list = (await c.request("list")).sessions;
    assert.equal(list.length, 1);
    assert.ok(list[0].pid > 0, "the host knows the process id");
    assert.equal((await c.request("alive", { session: s.id })).alive, true);
    // Names are unique per host.
    const s2 = await c.request("new", { name: "my project!", cwd: process.cwd(), cmd: process.env.ComSpec, args: ["/d", "/q", "/k"] });
    assert.equal(s2.name, "my-project--2");
    await c.request("kill", { session: s2.id });
    await c.request("write", { session: s.id, data: "exit\r" });
    const until = Date.now() + 8000;
    while (Date.now() < until && (await c.request("alive", { session: s.id })).alive) await sleep(200);
    assert.equal((await c.request("alive", { session: s.id })).alive, false);
    await assert.rejects(c.request("screen", { session: s.id }), /no session/);
    await assert.rejects(c.request("key", { session: s2.id, key: "F1" }), /no session|not allowed/);
  } finally {
    c.close();
    for (const s of host.sessions.values()) s.kill();
    host.close();
  }
});

test("attach paints the current screen and relays input", { skip: !WIN && "Windows only" }, async () => {
  const p = `${pipe}-attach`;
  const host = startHost({ pipe: p, exitWhenIdle: false });
  await new Promise((r) => host.server.on("listening", r));
  const c = new HostClient(p);
  try {
    const s = await c.request("new", { name: "a", cwd: process.cwd(), cmd: process.env.ComSpec, args: ["/d", "/q", "/k"], cols: 80, rows: 24 });
    await screenHas(c, s.id, ">");
    const { PassThrough } = await import("node:stream");
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.columns = 100;
    stdout.rows = 30;
    let out = "";
    stdout.on("data", (d) => (out += d.toString("utf8")));
    const done = attach({ pipe: p, id: s.id, stdin, stdout });
    await sleep(500);
    assert.match(out, />/, "the existing prompt is painted on attach");
    assert.equal(host.sessions.get(s.id).cols, 100, "the pane takes the client's size");
    stdin.write("echo via attach\r");
    await screenHas(c, s.id, "\nvia attach");
    stdin.write(Buffer.from([0x1d])); // Ctrl+]
    const result = await done;
    assert.equal(result.reason, "detached");
    assert.equal((await c.request("alive", { session: s.id })).alive, true, "detaching leaves the session running");
  } finally {
    c.close();
    for (const s of host.sessions.values()) s.kill();
    host.close();
  }
});

test("styledScreen reads the screen without resizing the session or staying attached", { skip: !WIN && "Windows only" }, async () => {
  const p = `${pipe}-styled`;
  const host = startHost({ pipe: p, exitWhenIdle: false });
  await new Promise((r) => host.server.on("listening", r));
  const c = new HostClient(p);
  try {
    const s = await c.request("new", { name: "a", cwd: process.cwd(), cmd: process.env.ComSpec, args: ["/d", "/q", "/k"], cols: 80, rows: 24 });
    await c.request("write", { session: s.id, data: "echo read with styling\r" });
    await screenHas(c, s.id, "\nread with styling");
    const styled = await styledScreen(p, s.id);
    assert.match(styled, /read with styling/);
    assert.ok(styled.includes("\x1b["), "the screen comes with its terminal codes");
    assert.equal(host.sessions.get(s.id).cols, 80, "the session keeps its size");
    await sleep(100);
    assert.equal(host.sessions.get(s.id).attached.size, 0, "nothing stays attached");
    assert.equal(await styledScreen(p, "no-such-session"), "");
    assert.equal(await styledScreen(`${p}-nobody-home`, s.id), "");
  } finally {
    c.close();
    for (const s of host.sessions.values()) s.kill();
    host.close();
  }
});

test("screen joins a row to the one above only when that one really wrapped", { skip: !WIN && "Windows only" }, async () => {
  const p = `${pipe}-wrap`;
  const host = startHost({ pipe: p, exitWhenIdle: false });
  await new Promise((r) => host.server.on("listening", r));
  const c = new HostClient(p);
  try {
    // Claude Code's input box: a rule that fills the row, so the row under it is
    // marked as wrapped. Then a dialog drawn over both by moving the cursor, as
    // Claude Code redraws, which leaves the mark on what is now a row of its own.
    const program = `
      const w = (s) => process.stdout.write(s);
      w("${"long ".repeat(30)}end\\n");
      w("─".repeat(80) + "> box\\n" + "─".repeat(80) + "  status\\n");
      setTimeout(() => {
        w("\\x1b[4A\\r");
        for (const l of ["> 1. Yes", "  2. No", "", "Esc to cancel"]) w(l + "\\x1b[K\\x1b[1B\\r");
        w("drawn\\n");
      }, 400);
      setTimeout(() => {}, 20000);`;
    const s = await c.request("new", { name: "wrap", cwd: process.cwd(), cmd: process.execPath, args: ["-e", program], cols: 80, rows: 24 });
    const lines = (await screenHas(c, s.id, "drawn")).split("\n");
    assert.equal(lines[0], `${"long ".repeat(30)}end`, "a line that wrapped is still read as one");
    assert.deepEqual(lines.slice(1, 3), ["> 1. Yes", "  2. No"], "two rows of a redrawn dialog stay two lines");
    assert.ok(lines.includes("Esc to cancel"));
  } finally {
    c.close();
    for (const s of host.sessions.values()) s.kill();
    host.close();
  }
});

test("sendPrompt ends a prompt with Enter, or with Claude Code's send-now chord", { skip: !WIN && "Windows only" }, async () => {
  const { sendPrompt } = await import("../hub/pane.mjs");
  const p = `${pipe}-prompt`;
  const host = startHost({ pipe: p, exitWhenIdle: false });
  await new Promise((r) => host.server.on("listening", r));
  const c = new HostClient(p);
  try {
    // A console program that prints the bytes it is sent, as Claude Code would read them.
    const echo = 'process.stdin.setRawMode(true); console.log("ready"); process.stdin.on("data", (d) => console.log([...d].map((b) => b.toString(16).padStart(2, "0")).join(" ")));';
    const s = await c.request("new", { name: "keys", cwd: process.cwd(), cmd: process.execPath, args: ["-e", echo], cols: 80, rows: 24 });
    const target = { host: p, pane: s.id };
    const sent = async () => (await c.request("screen", { session: s.id, lines: 50 })).text.replace(/ready/, "").replace(/\s+/g, " ").trim();
    await screenHas(c, s.id, "ready");
    await sendPrompt(target, "hi\nthere");
    await screenHas(c, s.id, "0d");
    assert.equal(await sent(), "68 69 20 74 68 65 72 65 0d", "one line, then Enter");
    await sendPrompt(target, "now", { now: true });
    await screenHas(c, s.id, "13");
    assert.equal(await sent(), "68 69 20 74 68 65 72 65 0d 6e 6f 77 18 13", "Ctrl+X Ctrl+S in place of Enter");
  } finally {
    c.close();
    for (const s of host.sessions.values()) s.kill();
    host.close();
  }
});

test("line feeds go to a console as IND, and nothing else changes", () => {
  const out = (s) => lineFeedsAsIndex(Buffer.from(s)).toString();
  // As the pseudo-console paints a row under one it has just erased.
  assert.equal(out("\x1b[1;3H\x1b[K\nSection 40\x1b[K"), "\x1b[1;3H\x1b[K\x1bDSection 40\x1b[K");
  assert.equal(out("a\r\nb\n\nc\n"), "a\r\x1bDb\x1bD\x1bDc\x1bD");
  assert.equal(out("\n"), "\x1bD");
  // Text in more than one byte a character has no line feed in it.
  assert.equal(out("❯ ─ ⏵⏵ żółć\n●"), "❯ ─ ⏵⏵ żółć\x1bD●");
  const plain = Buffer.from("no line feed \x1b[5;10H here");
  assert.equal(lineFeedsAsIndex(plain), plain, "a chunk without one is passed on as it is");
});

test("attach keeps the column over a bare line feed in a real console", { skip: (!WIN && "Windows only") || (!consoleKnowsIndex() && "this console host has no IND") }, async () => {
  // A stand-in for the host that sends what the pseudo-console sends: go to a
  // column, then step down a row with a bare line feed and write on.
  const p = `${pipe}-linefeed`;
  const server = createServer((sock) => {
    sock.on("error", () => {});
    sock.once("data", (d) => {
      const { id } = JSON.parse(d.toString().split("\n")[0]);
      sock.write(JSON.stringify({ id, ok: true, name: "x" }) + "\n");
      sock.write("\x1b[2J\x1b[5;10HA\nB\x1b[8;10HC\x1b[K\nD");
    });
  });
  await new Promise((r) => server.listen(p, r));
  // The attach client in a console of its own, read by a terminal as Windows Terminal reads it.
  const term = new Terminal({ cols: 60, rows: 14, allowProposedApi: true });
  const client = new URL("../host/client.mjs", import.meta.url).href;
  const program = `import { attach } from ${JSON.stringify(client)}; await attach({ pipe: ${JSON.stringify(p)}, id: "x" }).catch(() => {});`;
  const console_ = pty.spawn(process.execPath, ["--input-type=module", "-e", program], { name: "xterm-256color", cols: 60, rows: 14, cwd: process.cwd(), env: process.env, useConpty: true });
  console_.onData((d) => term.write(d));
  term.onData((d) => console_.write(d)); // the console host asks the terminal about itself as it starts
  try {
    const columns = () => {
      const at = {};
      for (let y = 0; y < term.rows; y++) {
        const line = term.buffer.active.getLine(y)?.translateToString(true) ?? "";
        for (const ch of "ABCD") if (line.trim() === ch) at[ch] = [y + 1, line.indexOf(ch) + 1];
      }
      return at;
    };
    const until = Date.now() + 10000;
    while (Date.now() < until && Object.keys(columns()).length < 4) await sleep(100);
    // Each letter after a line feed stands one row down and one column on from the letter before it.
    assert.deepEqual(columns(), { A: [5, 10], B: [6, 11], C: [8, 10], D: [9, 11] });
  } finally {
    console_.kill();
    server.close();
  }
});

test("the detach chord is recognised in every encoding a Windows terminal uses", async () => {
  const { isDetachChord } = await import("../host/client.mjs");
  assert.equal(isDetachChord(Buffer.from([0x1d])), true, "plain byte");
  // Windows Terminal in win32-input-mode: Ctrl down, Ctrl+] down and up, Ctrl up.
  assert.equal(isDetachChord(Buffer.from("\x1b[17;29;0;1;8;1_\x1b[221;27;29;1;8;1_\x1b[221;27;29;0;8;1_\x1b[17;29;0;0;0;1_", "latin1")), true);
  assert.equal(isDetachChord(Buffer.from("\x1b[221;27;29;0;8;1_", "latin1")), false, "key up alone");
  assert.equal(isDetachChord(Buffer.from("\x1b[93;5u", "latin1")), true, "kitty protocol");
  assert.equal(isDetachChord(Buffer.from("\x1b[72;35;104;1;0;1_", "latin1")), false, "a plain h");
  assert.equal(isDetachChord(Buffer.from("hello")), false);
});

test("key table covers what the hub may press", () => {
  for (const k of ["Enter", "Escape", "Up", "Down", "Tab", "BTab", "1", "9"]) assert.ok(KEYS[k], k);
  assert.equal(KEYS.Enter, "\r");
});

test("resolveClaude prefers an executable and unwraps the npm shim", { skip: !WIN && "Windows only" }, () => {
  const r = resolveClaude("claude");
  if (!r) return; // Claude Code not installed on this machine
  assert.ok(/\.exe$/i.test(r.cmd) || /cmd\.exe$/i.test(r.cmd), r.cmd);
});
