import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The registry saves its sessions to the config folder: keep that away from a real hub's.
const dir = mkdtempSync(join(tmpdir(), "codeaside-sessions-"));
process.env.CODEASIDE_CONFIG_DIR = dir;
const { Registry } = await import("../hub/sessions.mjs");

const registry = new Registry();
after(() => {
  clearTimeout(registry.saveTimer);
  for (const s of registry.sessions.values()) s.tail?.close();
});

let n = 0;
/** A session the hub has heard one hook from, and a way to send it more. */
function open() {
  const id = `session-${++n}`;
  const hook = (event, more = {}) => registry.handleHook({ session_id: id, hook_event_name: event, cwd: dir, transcript_path: join(dir, `${id}.jsonl`), ...more });
  return { hook, session: hook("SessionStart", { source: "startup" }) };
}

test("a session that starts, resumes or is cleared is idle", () => {
  for (const source of ["startup", "resume", "clear"]) {
    const { hook, session } = open();
    hook("UserPromptSubmit");
    assert.equal(session.state, "working");
    hook("SessionStart", { source });
    assert.equal(session.state, "idle", source);
  }
});

test("a session compacted in the middle of a turn is still working", () => {
  const { hook, session } = open();
  hook("UserPromptSubmit");
  hook("PreToolUse", { tool_name: "Read", tool_input: { file_path: "a.ts" } });
  hook("PostToolUse", { tool_name: "Read" });
  const states = [];
  registry.on("session", (s) => s === session && states.push(s.state));
  hook("SessionStart", { source: "compact" });
  assert.equal(session.state, "working");
  assert.deepEqual(states, ["working"], "the glasses are never told it went idle");
  hook("Stop");
  assert.equal(session.state, "idle");
});

test("a session compacted while idle stays idle", () => {
  const { hook, session } = open();
  hook("SessionStart", { source: "compact" });
  assert.equal(session.state, "idle");
  // The hub can first hear of a session from this hook, when it started mid-compaction.
  const late = registry.handleHook({ session_id: "late", hook_event_name: "SessionStart", source: "compact", cwd: dir, transcript_path: join(dir, "late.jsonl") });
  assert.equal(late.state, "idle");
});
