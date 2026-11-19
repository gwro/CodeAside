// Curtain mode: a session's screen with everything hidden, for when the text is in
// the way. All that shows is a row of dots while the session works.
import { HEADER_INNER_W } from "./display.ts";
import { padTo, width } from "./text.ts";

/** How long each step of the dots stays up. Each step is one write to the glasses. */
export const CURTAIN_STEP_MS = 1000;
const DOTS = 3;
// The first dot keeps its place, so the row grows to the right instead of shifting.
const INDENT = padTo("", Math.floor((HEADER_INNER_W - width(".".repeat(DOTS))) / 2));

/**
 * The top line under the curtain while the session works: one dot, two, three, and
 * round again, in the middle of the line. It goes where the header was.
 */
export function workingDots(now: number): string {
  const dots = 1 + (Math.floor(now / CURTAIN_STEP_MS) % DOTS);
  return INDENT + ".".repeat(dots);
}

/**
 * What a swipe does to the curtain, or null when it is an ordinary swipe.
 * It comes down on a swipe down when there is nothing further down to scroll to,
 * and only while the session works: that is when there is something to wait for.
 * A swipe up on the dots lifts it. In between, when the session has finished or
 * asks something, the screen is showing and a swipe scrolls it as ever: the
 * curtain stays as it was, and covers the screen again with the next turn.
 */
export function curtainAfterSwipe(down: boolean, dir: "up" | "down", at: { latest: boolean; working: boolean }): boolean | null {
  if (!at.working) return null;
  if (down) return dir === "down";
  return dir === "down" && at.latest ? true : null;
}
