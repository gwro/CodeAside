// Which part of a session's transcript is on screen.
import type { Layout } from "./format.ts";
import type { Item } from "./types.ts";

/**
 * A transcript line named by the item it belongs to, so the view stays where it
 * is while lines are added below it or dropped above it.
 */
interface Anchor {
  key: string;
  offset: number;
}

/** The newest reply since the last prompt, as an index into `items`, or -1. */
export function latestReply(items: Item[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "assistant") return i;
    if (items[i].kind === "user") break;
  }
  return -1;
}

/**
 * The view shows the latest lines, with two exceptions. Once the user scrolls,
 * the view stays on the line they scrolled to. And, when asked to hold replies,
 * a reply whose first line would be off the top is held at that line, so it can
 * be read from its start. Either way the view returns to the latest lines when
 * the user scrolls down to them or asks for them, and that reply no longer
 * holds it.
 */
export class TranscriptView {
  private scrolledTo: Anchor | null = null;
  /** The reply the user has moved on from. */
  private readKey = "";
  // As of the last place():
  private items: Item[] = [];
  private starts: number[] = [];
  private top = 0;
  private maxTop = 0;
  private replyKey = "";

  /**
   * The first line to show on a screen of `page` lines, or null for the latest
   * lines. `holdReplies` says whether a long reply may hold the view right now.
   */
  place(items: Item[], layout: Layout, page: number, holdReplies: boolean): number | null {
    const maxTop = Math.max(0, layout.lines.length - page);
    const reply = latestReply(items);
    const replyKey = reply >= 0 ? items[reply].key : "";
    const at = this.scrolledTo ? items.findIndex((it) => it.key === this.scrolledTo!.key) : -1;
    let top: number | null = null;
    if (this.scrolledTo && at >= 0) {
      top = Math.max(0, layout.starts[at] + this.scrolledTo.offset);
      if (top >= maxTop) {
        // Scrolled down to the latest lines.
        this.scrolledTo = null;
        this.readKey = replyKey;
        top = null;
      }
    } else {
      this.scrolledTo = null; // its item is no longer in the transcript
      if (holdReplies && replyKey && replyKey !== this.readKey && layout.starts[reply] < maxTop) top = layout.starts[reply];
    }
    this.items = items;
    this.starts = layout.starts;
    this.top = top ?? maxTop;
    this.maxTop = maxTop;
    this.replyKey = replyKey;
    return top;
  }

  /** Move by `delta` lines from where the last place() put the view. */
  scroll(delta: number) {
    const top = Math.max(0, this.top + delta);
    if (top >= this.maxTop || !this.items.length) return this.toLatest();
    let i = 0;
    while (i + 1 < this.starts.length && this.starts[i + 1] <= top) i++;
    this.scrolledTo = { key: this.items[i].key, offset: top - this.starts[i] };
  }

  toLatest() {
    this.scrolledTo = null;
    this.readKey = this.replyKey;
  }
}
