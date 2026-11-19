import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import { Display, type Frame } from "../src/display.ts";

/** A bridge that records what the display sends: the kind of write and each container's brightness. */
function fakeBridge() {
  const writes: string[] = [];
  const page = (kind: string) => async (p: { textObject?: { textColor?: number }[] }) => {
    writes.push(`${kind} ${(p.textObject || []).map((t) => t.textColor ?? "-").join(",")}`);
    return "success";
  };
  const bridge = {
    createStartUpPageContainer: page("create"),
    rebuildPageContainer: page("rebuild"),
    textContainerUpgrade: async (u: { containerName?: string; textColor?: number }) => {
      writes.push(`${u.containerName} ${u.textColor ?? "-"}`);
      return true;
    },
  };
  return { bridge: bridge as unknown as EvenAppBridge, writes };
}

/** Show a frame and wait for the display to finish writing it. */
async function show(display: Display, frame: Frame) {
  display.show(frame);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const frame = (body: string, brightness?: number, menu?: Frame["menu"]): Frame => ({ header: "h", body: [body], brightness, menu });

test("no brightness is sent until a frame asks for one", async () => {
  const { bridge, writes } = fakeBridge();
  const display = new Display(bridge);
  await show(display, frame("one"));
  await show(display, frame("two"));
  await show(display, frame("two", undefined, [{ id: 1, name: "Interrupt" }]));
  assert.deepEqual(writes, ["create -,-", "body -", "rebuild -,-"]);
});

test("a change of brightness is sent to both containers, even when the text is the same", async () => {
  const { bridge, writes } = fakeBridge();
  const display = new Display(bridge);
  await show(display, frame("one"));
  await show(display, frame("one", 0));
  await show(display, frame("two", 0)); // same brightness: text only
  await show(display, frame("two", 4));
  assert.deepEqual(writes, ["create -,-", "header 0", "body 0", "body -", "header 4", "body 4"]);
});

test("after dimming, a frame without a brightness goes back to full", async () => {
  const { bridge, writes } = fakeBridge();
  const display = new Display(bridge);
  await show(display, frame("one", 1));
  await show(display, frame("one"));
  await show(display, frame("one"));
  assert.deepEqual(writes, ["create 1,1", "header 4", "body 4"]);
});

test("a rebuilt page repeats the brightness, and invalidate sends it again", async () => {
  const { bridge, writes } = fakeBridge();
  const display = new Display(bridge);
  await show(display, frame("one", 0));
  await show(display, frame("one", 0, [{ id: 1, name: "Interrupt" }]));
  display.invalidate();
  await show(display, frame("one", 0, [{ id: 1, name: "Interrupt" }]));
  assert.deepEqual(writes, ["create 0,0", "rebuild 0,0", "header 0", "body 0"]);
});
