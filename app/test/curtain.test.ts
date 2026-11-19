import { test } from "node:test";
import assert from "node:assert/strict";
import { CURTAIN_STEP_MS, curtainAfterSwipe, workingDots } from "../src/curtain.ts";
import { HEADER_INNER_W } from "../src/display.ts";
import { width } from "../src/text.ts";

test("the dots go one, two, three and round again, one step at a time", () => {
  const row = (now: number) => workingDots(now).trim();
  assert.deepEqual([0, 1, 2, 3, 4].map((step) => row(step * CURTAIN_STEP_MS)), [".", "..", "...", ".", ".."]);
  assert.equal(row(CURTAIN_STEP_MS - 1), ".", "nothing changes within a step, so nothing is written to the glasses");
});

test("the dots are one line, in the middle of the top line, and the first one stays put", () => {
  const lines = [0, 1, 2].map((step) => workingDots(step * CURTAIN_STEP_MS));
  for (const line of lines) assert.ok(!line.includes("\n") && width(line) <= HEADER_INNER_W);
  const indents = lines.map((line) => line.replace(/\.+$/, ""));
  assert.equal(new Set(indents).size, 1);
  const left = width(indents[0]);
  const right = HEADER_INNER_W - width(lines[2]);
  assert.ok(Math.abs(left - right) <= 8, `three dots sit in the middle: ${left}px to the left, ${right}px to the right`);
});

test("the curtain comes down on a swipe down past the latest lines of a working session", () => {
  assert.equal(curtainAfterSwipe(false, "down", { latest: true, working: true }), true);
  // Not while there is still something to scroll down to: that swipe scrolls.
  assert.equal(curtainAfterSwipe(false, "down", { latest: false, working: true }), null);
  // Not on a session that is idle or waiting for an answer.
  assert.equal(curtainAfterSwipe(false, "down", { latest: true, working: false }), null);
  assert.equal(curtainAfterSwipe(false, "up", { latest: true, working: true }), null, "a swipe up scrolls as ever");
});

test("a swipe up on the dots lifts the curtain, and another swipe down leaves it", () => {
  for (const latest of [true, false]) {
    assert.equal(curtainAfterSwipe(true, "down", { latest, working: true }), true);
    assert.equal(curtainAfterSwipe(true, "up", { latest, working: true }), false);
  }
});

test("while the session is not working the screen shows, and a swipe only scrolls it", () => {
  // The curtain is kept as it was, to cover the screen again with the next turn.
  for (const down of [true, false]) {
    for (const latest of [true, false]) {
      assert.equal(curtainAfterSwipe(down, "down", { latest, working: false }), null);
      assert.equal(curtainAfterSwipe(down, "up", { latest, working: false }), null);
    }
  }
});
