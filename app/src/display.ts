// Owns the glasses page: a one-line header and a body that captures input.
// Content never overflows a container, so the firmware never scrolls it and every
// swipe reaches us as an event.
import {
  CreateStartUpPageContainer,
  MenuContainerProperty,
  MenuItemProperty,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import { LINE_H, SCREEN_W } from "./text.ts";

export const HEADER = { id: 1, name: "header", x: 0, y: 0, w: SCREEN_W, h: 32, pad: 2 };
export const BODY = { id: 2, name: "body", x: 0, y: 34, w: SCREEN_W, h: 254, pad: 4 };
export const HEADER_INNER_W = HEADER.w - 2 * HEADER.pad;
export const BODY_INNER_W = BODY.w - 2 * BODY.pad - 4; // small safety margin against rounding
export const BODY_LINES = Math.floor((BODY.h - 2 * BODY.pad) / LINE_H);

export interface MenuItem {
  id: number;
  name: string;
}

/** The firmware's text brightness runs from 0, the dimmest, to this. */
export const FULL_BRIGHTNESS = 4;

export interface Frame {
  header: string;
  body: string[];
  menu?: MenuItem[];
  /** Text brightness, 0 to FULL_BRIGHTNESS. Left out, the text is at full brightness. */
  brightness?: number;
}

export class Display {
  private created = false;
  private shown = { header: "", body: "", menuKey: "" };
  // The brightness last sent. Until a frame asks for one, none is sent at all and
  // the glasses stay on their default, which is full.
  private level: number | undefined;
  private relight = false;
  private pending: Frame | null = null;
  private busy = false;
  lastWriteAt = 0;
  onFrame: (f: Frame) => void = () => {};
  private bridge: EvenAppBridge;

  // Written out, not as a parameter property, so the tests can load this file as it is.
  constructor(bridge: EvenAppBridge) {
    this.bridge = bridge;
  }

  /** Forget what we think is on the glasses, so the next frame is sent in full. */
  invalidate() {
    this.shown = { header: "", body: "", menuKey: this.shown.menuKey };
    this.relight = this.level !== undefined;
  }

  show(frame: Frame) {
    const body = frame.body.slice(0, BODY_LINES);
    this.pending = { ...frame, body };
    this.onFrame(this.pending);
    void this.flush();
  }

  private containers(header: string, body: string, level: number | undefined) {
    // A page built without a brightness gets the default, so a rebuild has to repeat it.
    const lit = level === undefined ? {} : { textColor: level };
    return [
      new TextContainerProperty({
        containerID: HEADER.id, containerName: HEADER.name,
        xPosition: HEADER.x, yPosition: HEADER.y, width: HEADER.w, height: HEADER.h,
        paddingLength: HEADER.pad, borderWidth: 0, isEventCapture: 0, content: header, ...lit,
      }),
      new TextContainerProperty({
        containerID: BODY.id, containerName: BODY.name,
        xPosition: BODY.x, yPosition: BODY.y, width: BODY.w, height: BODY.h,
        paddingLength: BODY.pad, borderWidth: 0, isEventCapture: 1, content: body, ...lit,
      }),
    ];
  }

  private menuObject(menu?: MenuItem[]) {
    if (!menu?.length) return undefined;
    return new MenuContainerProperty({ menuItems: menu.slice(0, 10).map((m) => new MenuItemProperty({ itemID: m.id, itemName: m.name })) });
  }

  private async flush() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending) {
        const frame = this.pending;
        this.pending = null;
        const header = frame.header || " ";
        const body = frame.body.join("\n") || " ";
        const menuKey = JSON.stringify(frame.menu || []);
        // Once a brightness has been sent, a frame without one means full again.
        const level = frame.brightness ?? (this.level === undefined ? undefined : FULL_BRIGHTNESS);
        if (!this.created) {
          const result = await this.bridge.createStartUpPageContainer(
            new CreateStartUpPageContainer({ containerTotalNum: 2, textObject: this.containers(header, body, level), menuObject: this.menuObject(frame.menu) }),
          );
          // Treat startup as spent even when it fails; later frames rebuild instead.
          this.created = true;
          if (String(result) !== "0" && String(result) !== "success") {
            await this.bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum: 2, textObject: this.containers(header, body, level), menuObject: this.menuObject(frame.menu) }));
          }
          this.shown = { header, body, menuKey };
        } else if (menuKey !== this.shown.menuKey) {
          await this.bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum: 2, textObject: this.containers(header, body, level), menuObject: this.menuObject(frame.menu) }));
          this.shown = { header, body, menuKey };
        } else {
          // An update without a brightness keeps the one the container has.
          const relight = this.relight || level !== this.level;
          const lit = relight && level !== undefined ? { textColor: level } : {};
          if (header !== this.shown.header || relight) {
            await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: HEADER.id, containerName: HEADER.name, content: header, ...lit }));
            this.shown.header = header;
          }
          if (body !== this.shown.body || relight) {
            await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: BODY.id, containerName: BODY.name, content: body, ...lit }));
            this.shown.body = body;
          }
        }
        this.level = level;
        this.relight = false;
        this.lastWriteAt = Date.now();
      }
    } catch (err) {
      console.error("display write failed", err);
    } finally {
      this.busy = false;
    }
  }
}
