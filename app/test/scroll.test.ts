import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutItems } from "../src/format.ts";
import { TranscriptView, latestReply } from "../src/scroll.ts";
import type { Item } from "../src/types.ts";

const W = 568;
const PAGE = 9;

const user = (key: string, text = "do the thing"): Item => ({ key, kind: "user", text });
const tool = (key: string, name: string): Item => ({ key, kind: "tool", tool: name, text: `${name}-${key}` });
/** A reply that takes exactly `n` lines on screen. */
const reply = (key: string, n: number): Item => ({ key, kind: "assistant", text: Array.from({ length: n }, (_, i) => `${key} line ${i + 1}`).join("\n") });

const place = (view: TranscriptView, items: Item[], holdReplies = true) => view.place(items, layoutItems(items, W), PAGE, holdReplies);

test("latestReply is the newest reply since the last prompt", () => {
  assert.equal(latestReply([user("u1"), reply("a1", 2), tool("t1", "Read")]), 1);
  assert.equal(latestReply([user("u1"), reply("a1", 2), reply("a2", 2)]), 2);
  assert.equal(latestReply([user("u1"), reply("a1", 2), user("u2"), tool("t1", "Read")]), -1);
  assert.equal(latestReply([]), -1);
});

test("a reply that fits is shown with the latest lines", () => {
  const view = new TranscriptView();
  assert.equal(place(view, [user("u1"), reply("a1", 8)]), null);
});

test("a reply longer than the screen is held at its first line", () => {
  const view = new TranscriptView();
  const items = [user("u1"), reply("a1", 20)];
  assert.equal(place(view, items), 1);
  // It stays there while more arrives below it.
  items.push(tool("t1", "Read"), tool("t2", "Edit"));
  assert.equal(place(view, items), 1);
});

test("a reply that fits is held once later lines would push its start off", () => {
  const view = new TranscriptView();
  const items = [user("u1"), reply("a1", 7)];
  assert.equal(place(view, items), null);
  items.push(tool("t1", "Read"), tool("t2", "Edit"), tool("t3", "Bash"));
  assert.equal(place(view, items), 1);
});

test("a newer reply takes over, and a new prompt lets go", () => {
  const view = new TranscriptView();
  const items = [user("u1"), reply("a1", 20)];
  assert.equal(place(view, items), 1);
  items.push(reply("a2", 15));
  assert.equal(place(view, items), 21);
  items.push(user("u2"));
  assert.equal(place(view, items), null);
});

test("scrolling stays on the same line while the transcript changes around it", () => {
  const view = new TranscriptView();
  let items = [user("u0", "earlier"), reply("a0", 2), user("u1"), reply("a1", 20)];
  const start = layoutItems(items, W).starts[3];
  assert.equal(place(view, items), start);
  view.scroll(3);
  assert.equal(place(view, items), start + 3);
  // Lines added below don't move it.
  items.push(tool("t1", "Read"), reply("a2", 30));
  assert.equal(place(view, items), start + 3);
  // Items dropped from the front move it with its text.
  items = items.slice(2);
  assert.equal(place(view, items), layoutItems(items, W).starts[1] + 3);
});

test("scrolling down to the end returns to the latest, and that reply stops holding", () => {
  const view = new TranscriptView();
  const items = [user("u1"), reply("a1", 12)]; // 13 lines: tops 0 to 4
  assert.equal(place(view, items), 1);
  view.scroll(3);
  assert.equal(place(view, items), null);
  assert.equal(place(view, items), null);
  // The next long reply is held again.
  items.push(reply("a2", 12));
  assert.equal(place(view, items), 13);
});

test("asking for the latest lets go of the reply", () => {
  const view = new TranscriptView();
  const items = [user("u1"), reply("a1", 20)];
  assert.equal(place(view, items), 1);
  view.toLatest();
  assert.equal(place(view, items), null);
  items.push(tool("t1", "Read"));
  assert.equal(place(view, items), null);
});

test("scrolling up from the latest moves back by that many lines", () => {
  const view = new TranscriptView();
  const items = [user("u1"), reply("a1", 20)];
  place(view, items);
  view.toLatest();
  assert.equal(place(view, items), null);
  view.scroll(-3);
  assert.equal(place(view, items), 21 - PAGE - 3);
  view.scroll(-100);
  assert.equal(place(view, items), 0);
});

test("with holding off, a long reply shows its end, and scrolling still stays put", () => {
  const view = new TranscriptView();
  const items = [user("u1"), reply("a1", 20)];
  assert.equal(place(view, items, false), null);
  view.scroll(-3);
  assert.equal(place(view, items, false), 21 - PAGE - 3);
  items.push(reply("a2", 5));
  assert.equal(place(view, items, false), 21 - PAGE - 3);
  view.toLatest();
  assert.equal(place(view, items, false), null);
});

test("a dialog is not hidden behind a held reply, but a scrolled view stays", () => {
  const view = new TranscriptView();
  const items = [user("u1"), reply("a1", 20)];
  assert.equal(place(view, items, false), null);
  assert.equal(place(view, items), 1);
  view.scroll(3);
  assert.equal(place(view, items, false), 4);
});

test("a transcript shorter than the screen has nowhere to scroll", () => {
  const view = new TranscriptView();
  const items = [user("u1"), reply("a1", 3)];
  assert.equal(place(view, items), null);
  view.scroll(-3);
  assert.equal(place(view, items), null);
});
