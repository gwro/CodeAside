import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryMeta, entryToItems, toolLabel, TranscriptTail } from "../hub/transcript.mjs";
import { readDialog, suggestionIn } from "../hub/pane.mjs";

test("user prompt becomes a user item; injected context is dropped", () => {
  assert.deepEqual(entryToItems({ type: "user", uuid: "u1", message: { content: "fix the build" } }).map((i) => i.kind), ["user"]);
  assert.equal(entryToItems({ type: "user", uuid: "u2", message: { content: "<system-reminder>x</system-reminder>" } }).length, 0);
  assert.equal(entryToItems({ type: "user", uuid: "u3", isMeta: true, message: { content: "hello" } }).length, 0);
  assert.equal(entryToItems({ type: "user", uuid: "u4", isSidechain: true, message: { content: "sub" } }).length, 0);
});

test("task notification becomes a notice with its summary", () => {
  const [item] = entryToItems({
    type: "user",
    uuid: "u5",
    message: { content: "<task-notification><status>completed</status><summary>Background command \"deploy\" completed</summary></task-notification>" },
  });
  assert.equal(item.kind, "notice");
  assert.match(item.text, /deploy/);
});

test("slash commands and their output become notices", () => {
  const [cmd] = entryToItems({ type: "user", uuid: "c1", message: { content: "<command-name>/model</command-name><command-args>opus</command-args>" } });
  assert.deepEqual([cmd.kind, cmd.text], ["notice", "/model opus"]);
  const [out] = entryToItems({ type: "user", uuid: "c2", message: { content: "<local-command-stdout>Set model to Opus</local-command-stdout>" } });
  assert.equal(out.text, "Set model to Opus");
});

test("assistant text, tool calls, and failed tool results", () => {
  const items = entryToItems({
    type: "assistant",
    uuid: "a1",
    message: {
      model: "claude-opus-5",
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: "Looking now." },
        { type: "tool_use", name: "Edit", input: { file_path: "/x/y/grocery_screen.dart" } },
      ],
    },
  });
  assert.deepEqual(items.map((i) => [i.kind, i.text]), [["assistant", "Looking now."], ["tool", "grocery_screen.dart"]]);
  const [err] = entryToItems({ type: "user", uuid: "r1", message: { content: [{ type: "tool_result", is_error: true, content: "\nExit code 1\nmore" }] } });
  assert.deepEqual([err.kind, err.text], ["error", "Exit code 1"]);
});

test("synthetic assistant messages: limits surface as errors, filler is skipped", () => {
  const limit = entryToItems({ type: "assistant", uuid: "s1", message: { model: "<synthetic>", content: [{ type: "text", text: "You've reached your Fable limit." }] } });
  assert.equal(limit[0].kind, "error");
  const filler = entryToItems({ type: "assistant", uuid: "s2", message: { model: "<synthetic>", content: [{ type: "text", text: "No response requested." }] } });
  assert.equal(filler.length, 0);
});

test("queued prompts typed while busy show as user items", () => {
  const [q] = entryToItems({ type: "attachment", uuid: "q1", attachment: { type: "queued_command", prompt: "also run lint" } });
  assert.deepEqual([q.kind, q.text], ["user", "also run lint"]);
});

test("a queued prompt with a pasted image is a list of blocks, and shows its text", () => {
  // As Claude Code writes it: the text names the image and the image follows as its own block.
  const withText = { type: "attachment", uuid: "q2", attachment: { type: "queued_command", prompt: [{ type: "text", text: "[Image #1] is this cut off?" }, { type: "image", source: { type: "base64", data: "…" } }] } };
  assert.deepEqual(entryToItems(withText).map((i) => [i.kind, i.text]), [["user", "[image] is this cut off?"]]);
  const imageOnly = { type: "attachment", uuid: "q3", attachment: { type: "queued_command", prompt: [{ type: "text", text: "[Image #1]" }, { type: "image", source: {} }] } };
  assert.deepEqual(entryToItems(imageOnly).map((i) => i.text), ["[image]"]);
  // Nothing readable in it: no item, and never the blocks printed as objects.
  assert.deepEqual(entryToItems({ type: "attachment", uuid: "q4", attachment: { type: "queued_command", prompt: [{ type: "image", source: {} }] } }), []);
});

test("meta: title, model and context size", () => {
  assert.deepEqual(entryMeta({ type: "ai-title", aiTitle: "Grocery fixes" }), { title: "Grocery fixes" });
  const m = entryMeta({ type: "assistant", message: { model: "claude-opus-5", usage: { input_tokens: 2, cache_read_input_tokens: 1000 } } });
  assert.deepEqual(m, { model: "claude-opus-5", context: 1002 });
});

test("tool labels", () => {
  assert.equal(toolLabel("Bash", { command: "npm test", description: "Run the suite" }), "Run the suite");
  assert.equal(toolLabel("WebFetch", { url: "https://example.com/a" }), "example.com");
  assert.equal(toolLabel("mcp__github__create_issue", {}), "create_issue");
  // PowerShell is the shell on Windows: labelled as Bash is, command when there is no description.
  assert.equal(toolLabel("PowerShell", { command: "git status" }), "git status");
});

test("a suggested prompt is dim text alone in the input box", () => {
  const rule = `\x1b[38;2;136;136;136m${"─".repeat(270)}\x1b[0m`;
  const status = `  \x1b[38;2;255;193;7m⏵⏵ auto mode on\x1b[38;2;153;153;153m (shift+tab to cycle)\x1b[2A\x1b[21D\x1b[0m\x1b[?2004h\x1b[?1004h`;
  const screen = (input) => `\x1b[0m● Done.\r\n\r\n✻ Baked for 15s\r\n\r\n${rule}❯${input}\r\n${rule}${status}`;

  // As captured from Claude Code: the suggestion in dim after the prompt mark.
  assert.equal(suggestionIn(screen(" \x1b[2mcommit the latestOnPrompt setting\x1b[0m")), "commit the latestOnPrompt setting");
  // Spaces can arrive as cursor moves, and a long one continues on the next row.
  assert.equal(suggestionIn(screen(" \x1b[2mrun\x1b[1Cthe tests\x1b[0m\r\n  \x1b[2mand push\x1b[0m")), "run the tests and push");
  // Nothing in the box, text the user typed, and a new session's example are not suggestions.
  assert.equal(suggestionIn(screen(" ")), null);
  assert.equal(suggestionIn(screen(" commit\x1b[1Cand\x1b[1Cpush")), null);
  assert.equal(suggestionIn(screen(" fix \x1b[2mthe build\x1b[0m")), null);
  assert.equal(suggestionIn(screen(' \x1b[2mTry "edit <filepath> to..."\x1b[0m')), null);
  // A grey colour is not dim: its "2" is part of the colour.
  assert.equal(suggestionIn(screen(" \x1b[38;2;153;153;153mnot dim\x1b[0m")), null);
  // Live output after the painted screen is not read.
  assert.equal(suggestionIn(`${screen(" ")}\x1b[?2026h${rule}❯ \x1b[2mstale\x1b[0m`), null);
  // No input box on screen, and no screen at all.
  assert.equal(suggestionIn("● Working…\r\n  ⎿ running"), null);
  assert.equal(suggestionIn(""), null);
});

test("a tool label is cut to about a line, and kept long for a reader that fits it itself", () => {
  const description = "Rebuild the glasses app, run the hub tests, and look at how a separate test hub can be started";
  const short = toolLabel("PowerShell", { description });
  assert.equal(short.length, 60);
  assert.ok(short.endsWith("…"));
  assert.equal(toolLabel("PowerShell", { description }, { full: true }), description);
  assert.equal(toolLabel("Grep", { pattern: "x".repeat(900) }, { full: true }).length, 600);

  const entry = { type: "assistant", uuid: "u1", timestamp: "2026-01-01T00:00:00Z", message: { content: [
    { type: "tool_use", name: "PowerShell", input: { description } },
    { type: "tool_use", name: "Read", input: { file_path: "C:/repo/app.ts" } },
  ] } };
  const [long, plain] = entryToItems(entry);
  assert.equal(long.text, short);
  assert.equal(long.full, description);
  assert.equal(plain.text, "app.ts");
  assert.equal("full" in plain, false); // nothing was cut, so nothing to add
});

test("TranscriptTail emits only complete new lines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cg-tail-"));
  const file = join(dir, "t.jsonl");
  writeFileSync(file, JSON.stringify({ type: "user", uuid: "old" }) + "\n");
  const tail = new TranscriptTail(file, { fromOffset: 0, pollMs: 50 });
  const seen = [];
  tail.on("entry", (e) => seen.push(e.uuid));
  tail.start();
  appendFileSync(file, JSON.stringify({ type: "user", uuid: "new" }) + "\n" + '{"type":"user","uu');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(seen, ["old", "new"]);
  appendFileSync(file, 'id":"split"}\n');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(seen, ["old", "new", "split"]);
  tail.close();
});

test("readDialog recognizes Claude Code's permission, question and trust screens", () => {
  const permission = ` Bash command
   touch made-by-test.txt
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to /tmp/proj from this project
   3. No
 Esc to cancel · Tab to amend`;
  assert.deepEqual(readDialog(permission), { kind: "permission", options: ["Yes", "Yes, and always allow access to /tmp/proj from this project", "No"], prompt: "Do you want to proceed?" });

  const question = ` ☐ Fruit choice
Which fruit do you prefer?
❯ 1. Apple
     A crisp, sweet red fruit
  2. Banana
  3. Cherry
  4. Type something.
  5. Chat about this
Enter to select · ↑/↓ to navigate · Esc to cancel`;
  const q = readDialog(question);
  assert.equal(q.kind, "question");
  assert.equal(q.options[3], "Type something.");

  const trust = ` Quick safety check: Is this a project you created or one you trust?
 ❯ No, exit
   Yes, I trust this folder
 Enter to confirm · Esc to cancel`;
  assert.equal(readDialog(trust).kind, "trust");
  // A read taken mid-redraw that misses option 1 must not shift the others down.
  const holed = permission.replace(/^.*1\. Yes\s*$/m, "");
  assert.equal(readDialog(holed).kind, "unknown");
  assert.deepEqual(readDialog(holed).options, []);

  const idle = `⏺ pong
────────────────
❯
────────────────
  ⏸ manual mode on · ? for shortcuts`;
  assert.equal(readDialog(idle).kind, "input");
});

test("readDialog finds the input box when the rule above it runs into it", async () => {
  const { showsWorking } = await import("../hub/pane.mjs");
  // As the host reads Claude Code 2.1.328 at 200 columns: each full-width rule and
  // the row under it come back as one line.
  const rule = "─".repeat(200);
  const idle = `● done\n✻ Sautéed for 18s\n${rule}❯ Try "how does <filepath> work?"\n${rule}  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents`;
  assert.deepEqual(readDialog(idle), { kind: "input", options: [] });
  assert.equal(showsWorking(idle), false);
  const typed = `${" ".repeat(180)}◐ medium · /effort\n${rule}❯ some typed text\n${rule}  ⏵⏵ auto mode on (shift+tab to cycle)`;
  assert.equal(readDialog(typed).kind, "input");
  const working = `  ⎿  $ ping -n 16 127.0.0.1 (7s · 10 lines)\n✢ Forging… (10s · ↓ 96 tokens)\n${rule}❯\n${rule}  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt`;
  assert.equal(readDialog(working).kind, "input");
  assert.equal(showsWorking(working), true);
  // A dialog under a rule is still the dialog.
  const permission = `${rule} Bash command\n   touch made-by-test.txt\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel · Tab to amend`;
  assert.equal(readDialog(permission).kind, "permission");
  assert.equal(readDialog(`reply text\n${rule}`).kind, "unknown", "a rule with nothing under it is no input box");
});

test("readDialog separates options that an older host returns as one line", () => {
  // The dialog from a session where the glasses showed one option, "Yes  2. No".
  const glued = ` ⚠ Claude Code will automatically block this request in 0:29, to avoid holding up an unattended session
 Do you want to proceed?
 ❯ 1. Yes   2. No
 Esc to cancel · Tab to amend`;
  assert.deepEqual(readDialog(glued), { kind: "permission", options: ["Yes", "No"], prompt: "Do you want to proceed?" });
  const three = ` Do you want to make this edit to notes.md?\n   1. Yes   2. Yes, allow all edits during this session (shift+tab) ❯ 3. No\n Esc to cancel`;
  assert.deepEqual(readDialog(three).options, ["Yes", "Yes, allow all edits during this session (shift+tab)", "No"]);
  // A number inside a label is not the start of another option.
  const inside = ` Do you want to proceed?\n ❯ 1. Yes, run step  3. of the plan\n   2. No\n Esc to cancel`;
  assert.deepEqual(readDialog(inside).options, ["Yes, run step  3. of the plan", "No"]);
});

test("transcript cleanup drops sound-effect captions and silence hallucinations", async () => {
  const { cleanTranscript } = await import("../hub/stt.mjs");
  assert.equal(cleanTranscript("*phone rings*"), "");
  assert.equal(cleanTranscript("[music] Please run the tests (laughs)"), "Please run the tests");
  assert.equal(cleanTranscript(" Thank you. "), "");
  assert.equal(cleanTranscript("Commit it, then deploy."), "Commit it, then deploy.");
});

test("an interrupted request renders as a notice, not a user prompt", () => {
  const [item] = entryToItems({ type: "user", uuid: "i1", message: { content: "[Request interrupted by user for tool use]" } });
  assert.deepEqual([item.kind, item.text], ["notice", "Interrupted"]);
});

test("non-empty thinking blocks are the progress messages the terminal shows", () => {
  const items = entryToItems({
    type: "assistant",
    uuid: "t1",
    message: { model: "claude-opus-5", content: [{ type: "thinking", thinking: "The grocery API deployed successfully. Checking the live list next." }, { type: "thinking", thinking: "" }] },
  });
  assert.deepEqual(items.map((i) => [i.kind, i.text]), [["assistant", "The grocery API deployed successfully. Checking the live list next."]]);
});

test("delivery check matches a prompt across wrapped terminal lines", async () => {
  const { promptSnippet, screenHasSnippet } = await import("../hub/pane.mjs");
  const text = "I am not sure if it is worth mentioning, but if I have garlic added twice";
  const snip = promptSnippet(text);
  assert.ok(screenHasSnippet("❯ I am not sure if it is worth\n  mentioning, but if I have garlic", snip));
  assert.ok(screenHasSnippet("  ❯ I am not sure if it is worth mentio\n    ning, but if I", snip));
  assert.ok(!screenHasSnippet("⏺ something else entirely", snip));
});
