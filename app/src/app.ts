// Screens and controller for the glasses UI.
import { AudioInputSource, ImuReportPace, type EvenAppBridge } from "@evenrealities/even_hub_sdk";
import { every, later, type Cancel } from "./timers.ts";
import { BODY_INNER_W, BODY_LINES, FULL_BRIGHTNESS, HEADER_INNER_W, Display, type Frame, type MenuItem } from "./display.ts";
import { GLYPH, ago, layoutItems, shortModel, stateLabel } from "./format.ts";
import { TranscriptView } from "./scroll.ts";
import { curtainAfterSwipe, workingDots } from "./curtain.ts";
import type { Hub } from "./hub.ts";
import type { Action } from "./input.ts";
import { capLines, padTo, spread, truncate, width, wrap } from "./text.ts";
import type { Agent, ModelChoice, RecentProject, SessionSummary } from "./types.ts";

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

const CURSOR = "▶ ";
const NO_CURSOR = padTo("", width(CURSOR)); // spaces measured to the cursor's pixel width
const SUGGESTION = "→ ";
const NO_SUGGESTION = padTo("", width(SUGGESTION));
/** How long a first tap on a suggestion waits for the second one that sends it. */
const SUGGESTION_CONFIRM_MS = 8000;

interface Screen {
  frame(): Frame;
  action(a: Action): void | Promise<void>;
  enter?(): void;
  /** Where a spoken message goes from this screen, if anywhere. */
  voiceTarget?(): ((text: string) => Promise<void>) | null;
}

type VoiceState =
  | { phase: "idle" }
  | { phase: "recording"; started: number; target: (text: string) => Promise<void>; partial: string }
  | { phase: "transcribing"; target: (text: string) => Promise<void>; partial: string }
  | { phase: "confirm"; text: string; target: (text: string) => Promise<void>; send: () => Promise<void> };

// After release the transcript waits for a tap (send) or double-tap (cancel). Nothing
// sends by itself: you get to read it first, and a timer could stall anyway.
/** How often the audio so far is re-transcribed for the live preview while holding. */
const PARTIAL_EVERY_MS = 1000;

export class App {
  private stack: Screen[] = [];
  private toastText = "";
  private toastTimer: Cancel | null = null;
  private renderTimer: Cancel | null = null;
  private voice: VoiceState = { phase: "idle" };
  private chunks: Uint8Array[] = [];
  private partialTimer: Cancel | null = null;
  private partialInFlight: Promise<void> | null = null;
  private holdStartedAt = 0;
  private backgroundAt = 0;
  private tickTimer: Cancel | null = null;

  constructor(public bridge: EvenAppBridge, public display: Display, public hub: Hub) {
    hub.subscribe(() => this.render());
    this.push(new HomeScreen(this));
    this.tickTimer = every(() => {
      // The seconds of a recording, and the dots of a session behind its curtain.
      const top = this.top;
      if (this.voice.phase === "recording" || (top instanceof SessionScreen && top.animating())) this.render();
    }, 500);
  }

  get top(): Screen {
    return this.stack[this.stack.length - 1];
  }

  push(s: Screen) {
    this.stack.push(s);
    s.enter?.();
    this.render(true);
  }

  pop() {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.render(true);
    }
  }

  replace(s: Screen) {
    this.stack.pop();
    this.push(s);
  }

  toast(text: string, ms = 2500) {
    this.toastText = text;
    this.toastTimer?.cancel();
    this.toastTimer = later(() => {
      this.toastText = "";
      this.render();
    }, ms);
    this.render(true);
  }

  render(now = false) {
    if (now) {
      this.renderTimer?.cancel();
      this.renderTimer = null;
      this.draw();
      return;
    }
    // Draw right away unless we just drew; events arrive on network callbacks, which
    // run even when the WebView has stalled timers. The timer only coalesces bursts.
    if (Date.now() - this.lastDrawAt >= 150) {
      this.renderTimer?.cancel();
      this.renderTimer = null;
      this.draw();
      return;
    }
    if (this.renderTimer) return;
    this.renderTimer = later(() => {
      this.renderTimer = null;
      this.draw();
    }, 150);
  }

  /** Transcript frame captured when a hold starts; the body stays still while you talk. */
  private frozenFrame: Frame | null = null;

  private lastDrawAt = 0;
  private imuOn = false;

  /**
   * The Even app's WebView can freeze while nothing arrives from the glasses: no
   * timers, no stream callbacks, so a session you're only watching stops updating
   * until you tap. Events from the glasses wake it, so while a working or waiting
   * session is on screen, ask for a slow IMU stream (one report a second).
   */
  private keepAwake(want: boolean) {
    if (want === this.imuOn || (want && this.imuUnsupported)) return;
    this.imuOn = want;
    this.bridge
      .imuControl(want, ImuReportPace.P1000)
      .then((ok) => {
        if (want && !ok) {
          this.imuOn = false;
          this.imuUnsupported = true;
        }
      })
      .catch(() => {
        this.imuOn = false;
        if (want) this.imuUnsupported = true;
      });
  }
  private imuUnsupported = false;

  private draw() {
    this.lastDrawAt = Date.now();
    const top = this.top;
    this.keepAwake(top instanceof SessionScreen && top.isActive() && this.voice.phase === "idle");
    let frame: Frame;
    if (!this.hub.connected && this.hub.sessions.size === 0) {
      frame = {
        header: spread("Sessions", "offline", HEADER_INNER_W),
        body: wrap(`Can't reach the hub at ${this.hub.cfg.url}. Retrying.\n\nOn your computer run: codeaside doctor\n${this.hub.lastError ? `(${this.hub.lastError})` : ""}`, BODY_INNER_W),
      };
    } else if (this.voice.phase !== "idle" && this.frozenFrame) {
      frame = this.frozenFrame;
    } else {
      this.frozenFrame = null;
      frame = this.top.frame();
    }
    frame = this.overlayVoice(frame);
    if (this.toastText) frame = { ...frame, header: truncate(this.toastText, HEADER_INNER_W) };
    else if (!this.hub.connected) frame = { ...frame, header: spread(truncate(frame.header, HEADER_INNER_W - 90), "reconnecting", HEADER_INNER_W) };
    // What the user said and what a toast tells them are there to be read now.
    if (frame.brightness !== undefined && (this.voice.phase !== "idle" || this.toastText)) frame = { ...frame, brightness: FULL_BRIGHTNESS };
    this.display.show(frame);
  }

  private overlayVoice(frame: Frame): Frame {
    const v = this.voice;
    if (v.phase === "idle") return frame;
    let tail: string[];
    const preview = (text: string) => (text ? wrap(text, BODY_INNER_W, "» ", "   ").slice(-5) : []);
    if (v.phase === "recording") {
      const secs = Math.floor((Date.now() - v.started) / 1000);
      tail = ["", `● Listening  ${secs}s`, ...preview(v.partial)];
    } else if (v.phase === "transcribing") {
      tail = ["", "… Finishing", ...preview(v.partial)];
    } else {
      tail = ["", ...preview(v.text), "tap to send · hold to redo · double-tap to cancel"];
    }
    const keep = Math.max(0, BODY_LINES - tail.length);
    return { ...frame, body: [...frame.body.slice(-keep), ...tail].slice(-BODY_LINES) };
  }

  // ---------- input ----------

  async handle(a: Action) {
    if (a.type === "audio") {
      if (this.voice.phase === "recording") this.chunks.push(a.pcm);
      return;
    }
    if (a.type === "foreground") {
      // Opening the glasses menu briefly backgrounds the app. Only reconnect after a
      // real absence or when the stream is down; a reconnect is not free.
      const away = this.backgroundAt ? Date.now() - this.backgroundAt : Infinity;
      this.backgroundAt = 0;
      if (away > 60_000 && away !== Infinity) void this.hub.log(`app back in foreground after ${Math.round(away / 1000)}s`);
      if (!this.hub.connected || away > 8000) this.hub.refresh();
      void this.hub.presence();
      // The glasses may have cleared the screen while the display was off or the
      // app was away, so resend the whole frame rather than only what changed.
      this.display.invalidate();
      this.render(true);
      return;
    }
    if (a.type === "background" || a.type === "exit") {
      this.backgroundAt = Date.now();
      if (a.type === "exit") this.keepAwake(false);
      if (this.voice.phase === "recording") {
        void this.hub.log(`recording discarded: app went to ${a.type} after ${Date.now() - this.holdStartedAt}ms`);
        this.toast("Recording stopped: the glasses left the app", 4000);
        await this.stopRecording(false);
      }
      return;
    }
    // Voice gestures take priority over screen gestures.
    if (a.type === "holdStart") {
      // Holding again while reviewing a transcript discards it and records anew.
      if (this.voice.phase === "confirm") this.voice = { phase: "idle" };
      return this.startRecording();
    }
    if (a.type === "holdEnd") return this.stopRecording(true);
    if (a.type === "doubleTap" && this.voice.phase !== "idle") return this.cancelVoice();
    if (a.type === "tap" && this.voice.phase === "confirm") return this.voice.send();
    if (this.voice.phase !== "idle") return;
    try {
      await this.top.action(a);
    } catch (err) {
      this.toast(`! ${err instanceof Error ? err.message : err}`, 4000);
    }
    this.render();
  }

  private async startRecording() {
    if (this.voice.phase !== "idle") return;
    const target = this.top.voiceTarget?.();
    if (!target) {
      this.toast(this.top instanceof SessionScreen ? this.top.whyNoVoice() : "Pick a session to talk to", 3500);
      return;
    }
    this.chunks = [];
    // What is said is usually about the latest lines, so show those behind the dictation.
    if (this.hub.prefs.latestOnTalk && this.top instanceof SessionScreen) this.top.toLatest();
    this.frozenFrame = this.top.frame();
    this.holdStartedAt = Date.now();
    this.voice = { phase: "recording", started: Date.now(), target, partial: "" };
    this.render(true);
    const ok = await this.bridge.audioControl(true, AudioInputSource.Glasses).catch(() => false);
    if (!ok) {
      this.voice = { phase: "idle" };
      this.toast("! Microphone unavailable");
      return;
    }
    this.partialTimer = every(() => this.updatePartial(), PARTIAL_EVERY_MS);
  }

  private joinChunks(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      pcm.set(c, off);
      off += c.length;
    }
    return pcm;
  }

  /** Re-transcribe the audio so far, one request at a time, and show it while holding. */
  private updatePartial() {
    if (this.voice.phase !== "recording" || this.partialInFlight || !this.chunks.length) return;
    const pcm = this.joinChunks();
    if (pcm.length < 16000 * 2 * 1.2) return; // under ~1s whisper mostly guesses
    this.partialInFlight = this.hub
      .transcribe(pcm, true)
      .then((text) => {
        const v = this.voice;
        if (v.phase === "recording" && text) {
          v.partial = text;
          this.render();
        }
      })
      .catch(() => {})
      .finally(() => {
        this.partialInFlight = null;
      });
  }

  private stopPartials() {
    this.partialTimer?.cancel();
    this.partialTimer = null;
  }

  private async stopRecording(send: boolean) {
    const v = this.voice;
    if (v.phase !== "recording") return;
    this.stopPartials();
    await this.bridge.audioControl(false).catch(() => {});
    if (!send) {
      this.voice = { phase: "idle" };
      this.render();
      return;
    }
    const heldMs = Date.now() - this.holdStartedAt;
    const chunkCount = this.chunks.length;
    const pcm = this.joinChunks();
    this.chunks = [];
    void this.hub.log(`hold ${heldMs}ms, ${chunkCount} audio chunks, ${pcm.length} bytes`);
    if (heldMs < 600) {
      this.voice = { phase: "idle" };
      this.frozenFrame = null;
      this.toast(`Hold ended after ${(heldMs / 1000).toFixed(1)}s, nothing sent`, 4000);
      return;
    }
    this.voice = { phase: "transcribing", target: v.target, partial: v.partial };
    this.render(true);
    let text = "";
    try {
      await this.partialInFlight; // whisper handles one request at a time
      text = (await this.hub.transcribe(pcm)).trim();
    } catch (err) {
      this.voice = { phase: "idle" };
      this.toast(`! Voice failed: ${err instanceof Error ? err.message : err}`, 4000);
      return;
    }
    if (!text) {
      this.voice = { phase: "idle" };
      this.toast("Didn't catch that");
      return;
    }
    const target = v.target;
    let sent = false;
    const sendNow = async () => {
      if (sent) return;
      sent = true;
      this.voice = { phase: "idle" };
      this.render(true);
      try {
        await target(text);
      } catch (err) {
        this.toast(`! ${err instanceof Error ? err.message : err}`, 4000);
      }
      this.render();
    };
    this.voice = { phase: "confirm", text, target, send: sendNow };
    this.render(true);
  }

  private async cancelVoice() {
    const v = this.voice;
    if (v.phase === "recording") {
      this.stopPartials();
      await this.bridge.audioControl(false).catch(() => {});
    }
    this.voice = { phase: "idle" };
    this.toast("Cancelled", 1500);
  }
}

// ---------- helpers ----------

function windowAround<T>(rows: T[], selected: number, size: number): { start: number; rows: T[] } {
  const start = Math.max(0, Math.min(selected - Math.floor(size / 2), rows.length - size));
  return { start, rows: rows.slice(start, start + size) };
}

const AGENT_NAME: Record<Agent, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };
/** What the picker calls each agent. */
const AGENT_PRODUCT: Record<Agent, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI" };

function agentOf(s: { agent?: Agent } | undefined): Agent {
  return s?.agent === "codex" || s?.agent === "gemini" ? s.agent : "claude";
}

/** Project name, disambiguated when several sessions share a folder; every session names its agent when the hub runs more than one. */
function sessionName(s: SessionSummary, all: SessionSummary[], showAgent: boolean): string {
  const tag = showAgent ? ` · ${AGENT_NAME[agentOf(s)]}` : "";
  const twins = all.filter((o) => o.project === s.project && agentOf(o) === agentOf(s));
  if (twins.length < 2) return `${s.project}${tag}`;
  if (s.tmuxName && s.tmuxName !== s.project) return `${s.tmuxName}${tag}`;
  return `${s.project} ${s.id.slice(0, 4)}${tag}`;
}

function counts(sessions: SessionSummary[]): string {
  const working = sessions.filter((s) => s.state === "working").length;
  const waiting = sessions.filter((s) => s.state === "waiting").length;
  const parts = [];
  if (waiting) parts.push(`${waiting} need${waiting === 1 ? "s" : ""} you`);
  if (working) parts.push(`${working} working`);
  const open = sessions.filter((s) => s.state !== "ended").length;
  return parts.join(" · ") || `${open} open`;
}

// ---------- home: session list ----------

type HomeRow = { kind: "new" } | { kind: "resume" } | { kind: "session"; s: SessionSummary };

class HomeScreen implements Screen {
  private selected = 0;
  private selectedId: string | null = null;

  constructor(private app: App) {}

  private rows(): HomeRow[] {
    return [...this.app.hub.list().map((s) => ({ kind: "session" as const, s })), { kind: "new" }, { kind: "resume" }];
  }

  private clampSelection(rows: HomeRow[]) {
    // Keep the cursor on the same session when the list reorders.
    if (this.selectedId) {
      const idx = rows.findIndex((r) => r.kind === "session" && r.s.id === this.selectedId);
      if (idx >= 0) this.selected = idx;
    }
    this.selected = Math.max(0, Math.min(this.selected, rows.length - 1));
    const r = rows[this.selected];
    this.selectedId = r?.kind === "session" ? r.s.id : null;
  }

  frame(): Frame {
    const rows = this.rows();
    this.clampSelection(rows);
    const sessions = this.app.hub.list();
    const lines: string[] = [];
    const lineRows: number[] = [];
    rows.forEach((r, i) => {
      const cur = i === this.selected ? CURSOR : NO_CURSOR;
      if (r.kind === "new") {
        lines.push(`${cur}+ New session`);
        lineRows.push(i);
      } else if (r.kind === "resume") {
        lines.push(`${cur}↑ Resume a recent session`);
        lineRows.push(i);
      } else {
        const s = r.s;
        const right = `${stateLabel(s)} · ${ago(s.lastActivity)}`;
        const viewOnly = !s.controllable && s.state !== "ended" ? " (view)" : "";
        lines.push(spread(`${cur}${GLYPH[s.state]} ${sessionName(s, sessions, this.app.hub.agents.length > 1)}${viewOnly}`, right, BODY_INNER_W));
        lineRows.push(i);
        if (i === this.selected) {
          const detail = s.waiting?.detail || s.activity || s.title || s.summary || "";
          if (detail) {
            lines.push(truncate(`${NO_CURSOR}    ${detail}`, BODY_INNER_W));
            lineRows.push(i);
          }
        }
      }
    });
    const selLine = lineRows.indexOf(this.selected);
    const { rows: visible } = windowAround(lines, selLine, BODY_LINES);
    return {
      header: spread(this.app.hub.cfg.url === "demo" ? "Sessions · demo" : "Sessions", sessions.length ? counts(sessions) : "no sessions", HEADER_INNER_W),
      body: visible,
      menu: [{ id: 7, name: `Refresh · v${APP_VERSION}` }],
    };
  }

  action(a: Action) {
    const rows = this.rows();
    this.clampSelection(rows);
    if (a.type === "up") this.move(-1, rows);
    else if (a.type === "down") this.move(1, rows);
    else if (a.type === "doubleTap") void this.app.bridge.shutDownPageContainer(1);
    else if (a.type === "menu" && a.id === 7) this.app.hub.refresh();
    else if (a.type === "tap") {
      const r = rows[this.selected];
      if (r?.kind === "session") this.app.push(new SessionScreen(this.app, r.s.id));
      else if (r?.kind === "new") this.app.push(new ProjectPicker(this.app));
      else if (r?.kind === "resume") this.app.push(new ResumePicker(this.app));
    }
  }

  private move(delta: number, rows: HomeRow[]) {
    this.selected = Math.max(0, Math.min(rows.length - 1, this.selected + delta));
    const r = rows[this.selected];
    this.selectedId = r?.kind === "session" ? r.s.id : null;
  }

  voiceTarget() {
    const r = this.rows()[this.selected];
    if (r?.kind !== "session" || !r.s.controllable || r.s.waiting?.kind === "permission") return null;
    const { id, project } = r.s;
    return async (text: string) => {
      await this.app.hub.prompt(id, text);
      this.app.toast(`Sent to ${project}`);
    };
  }
}

// ---------- session transcript ----------

// Model entries take menu ids from 100 up; the glasses menu holds ten items.
const MODEL_MENU_BASE = 100;
const MAX_MODEL_ITEMS = 6;

function sessionMenu(models: ModelChoice[]): MenuItem[] {
  return [
    { id: 1, name: "Interrupt" },
    { id: 2, name: "Jump to latest" },
    ...models.slice(0, MAX_MODEL_ITEMS).map((m, i) => ({ id: MODEL_MENU_BASE + i, name: `Use ${m.name}` })),
    { id: 6, name: "Compact" },
    { id: 7, name: "Refresh" },
  ];
}

/** Lines moved per swipe. Small steps read as scrolling; a full page reads as a jump. */
const SCROLL_STEP = 3;

class SessionScreen implements Screen {
  private view = new TranscriptView();
  private following = true; // the latest lines are on screen, as of the last frame
  private wasWaiting = false; // a dialog was open, as of the last frame
  private armed: string | null = null; // the suggestion a first tap chose
  private armTimer: Cancel | null = null;
  private curtain = false; // the screen is hidden, until a swipe up
  private cursor = 0;
  private dialogOptions: string[] | null = null;
  private dialogFor = "";
  private models: ModelChoice[] = [];

  constructor(private app: App, private id: string) {}

  enter() {
    void this.app.hub.loadItems(this.id).catch((err) => this.app.toast(`! ${err.message}`));
    void this.app.hub.models(this.id).then((models) => {
      this.models = models;
      this.app.render();
    });
  }

  private get session() {
    return this.app.hub.sessions.get(this.id);
  }

  private get agentName() {
    return AGENT_NAME[agentOf(this.session)];
  }

  private viewOnlyHint() {
    const agent = agentOf(this.session);
    return agent === "codex" ? "View only: Codex isn't connected to the hub right now" : `View only: started outside codeaside. Start it with codeaside ${agent}`;
  }

  /** Show the latest lines, leaving wherever the view was scrolled or held. */
  toLatest() {
    this.view.toLatest();
  }

  /** The curtain is down, and the setting that allows it is still on. */
  private get curtained() {
    return this.curtain && this.app.hub.prefs.curtainMode;
  }

  /** Working with nothing to ask: the only thing the curtain shows, as moving dots. */
  private busy(s: SessionSummary | undefined) {
    return s?.state === "working" && !s.waiting;
  }

  /** The screen changes with the clock, not only with the session. */
  animating() {
    return this.curtained && this.busy(this.session);
  }

  /** Working or waiting: worth keeping the WebView awake for. */
  isActive() {
    const s = this.session;
    return !!s && (s.state === "working" || s.state === "waiting" || s.state === "starting");
  }

  whyNoVoice() {
    const s = this.session;
    if (!s || s.state === "ended") return "This session has ended";
    if (!s.controllable) return this.viewOnlyHint();
    if (s.waiting?.kind === "permission") return "Approve or deny first, then hold to talk";
    return "Can't talk to this session";
  }

  private waitingKey(s: SessionSummary) {
    return s.waiting ? `${s.waiting.kind}:${s.waiting.detail || ""}:${s.waiting.questionIndex || 0}:${s.lastActivity}` : "";
  }

  private options(s: SessionSummary): string[] {
    const w = s.waiting;
    if (!w) return [];
    if (w.kind === "question") {
      const q = w.questions?.[w.questionIndex || 0];
      if (q?.options?.length) return q.options.map((o) => o.label);
    }
    const key = this.waitingKey(s);
    if (this.dialogFor !== key && s.controllable) {
      // Read the real option labels off the terminal once per prompt.
      this.dialogFor = key;
      this.dialogOptions = null;
      this.cursor = 0;
      this.app.hub
        .dialog(this.id)
        .then(({ dialog }) => {
          if (this.dialogFor === key && dialog.options.length) {
            this.dialogOptions = dialog.options;
            this.app.render();
          }
        })
        .catch(() => {});
    }
    return this.dialogOptions || (w.kind === "permission" ? ["Yes", "Yes, and don't ask again", "No"] : []);
  }

  private waitingLines(s: SessionSummary): string[] {
    const w = s.waiting;
    if (!w) return [];
    const opts = this.options(s);
    this.cursor = Math.max(0, Math.min(this.cursor, Math.max(0, opts.length - 1)));
    const lines: string[] = [""];
    if (w.kind === "permission") {
      lines.push(...wrap(`Allow ${w.tool || "this"}: ${w.detail || ""}`, BODY_INNER_W, "◆ ", "   ").slice(0, 3));
    } else {
      const q = w.questions?.[w.questionIndex || 0];
      lines.push(...wrap(q?.question || w.detail || `${this.agentName} has a question`, BODY_INNER_W, "◆ ", "   ").slice(0, 3));
    }
    opts.forEach((o, i) => lines.push(truncate(`${i === this.cursor ? CURSOR : NO_CURSOR}${o}`, BODY_INNER_W)));
    if (w.kind === "question") lines.push(`${NO_CURSOR}or hold to answer by voice`);
    return lines;
  }

  /** The prompt Claude Code suggests next, while the session waits for one and shows it. */
  private suggestion(s: SessionSummary | undefined): string {
    return s && this.app.hub.prefs.showSuggestions && s.state === "idle" && !s.waiting ? s.suggestion || "" : "";
  }

  /** A first tap on this suggestion is waiting for the second. */
  private armedFor(text: string): boolean {
    return !!text && this.armed === text;
  }

  /**
   * Wait for a second tap on `text`, or stop waiting. The wait ends by a timer
   * that also redraws, so the hint on screen and what a tap does stay the same
   * thing even if the timer runs late.
   */
  private arm(text: string | null) {
    this.armTimer?.cancel();
    this.armTimer = null;
    this.armed = text;
    if (text) {
      this.armTimer = later(() => {
        this.armed = null;
        this.app.render();
      }, SUGGESTION_CONFIRM_MS);
    }
  }

  private suggestionLines(s: SessionSummary): string[] {
    const text = this.suggestion(s);
    if (!text) return [];
    const lines = ["", ...capLines(wrap(text, BODY_INNER_W, SUGGESTION, NO_SUGGESTION), 2, BODY_INNER_W)];
    if (this.armedFor(text)) lines.push(truncate(`${NO_SUGGESTION}tap again to send · double-tap to cancel`, BODY_INNER_W));
    return lines;
  }

  frame(): Frame {
    const s = this.session;
    const menu = sessionMenu(this.models);
    if (!s) return { header: "Session closed", body: wrap("This session is no longer running. Double-tap to go back.", BODY_INNER_W), menu };
    // Behind the curtain nothing shows but the dots, and those only while the
    // session works: when they stop, it has finished or wants an answer.
    if (this.curtained) return { header: this.busy(s) ? workingDots(Date.now()) : "", body: [], menu, brightness: this.brightness(s, true) };
    const items = this.app.hub.items.get(this.id);
    if (!items) this.app.hub.ensureItems(this.id); // self-heal if the cache was dropped
    const layout = items?.length ? layoutItems(items, BODY_INNER_W, this.app.hub.prefs.toolLines) : null;
    const transcript = !items ? ["Loading…"] : layout ? layout.lines : s.controllable ? ["Nothing here yet. Hold to talk."] : [];
    const prefs = this.app.hub.prefs;
    // A dialog that has closed was answered, here or at the desk: the session moves on.
    if (prefs.latestOnPrompt && this.wasWaiting && !s.waiting) this.view.toLatest();
    this.wasWaiting = !!s.waiting;
    // A dialog outranks the start of a long reply: it shows with the latest lines.
    const holdReplies = prefs.replyFromStart && !s.waiting;
    const top = items && layout ? this.view.place(items, layout, BODY_LINES, holdReplies, prefs.latestOnPrompt) : null;
    const following = (this.following = top === null);
    // Under the latest lines: the dialog to answer, or failing that a suggested prompt.
    const waitBlock = !following ? [] : s.waiting ? this.waitingLines(s) : this.suggestionLines(s);
    const room = BODY_LINES - Math.min(waitBlock.length, BODY_LINES - 2);
    const start = top ?? Math.max(0, transcript.length - room);
    const body = [...transcript.slice(start, start + room), ...waitBlock].slice(-BODY_LINES);

    const activity = s.state === "working" && s.activity ? ` · ${s.activity}` : "";
    const left = `${GLYPH[s.state]} ${s.project} · ${stateLabel(s)}${activity}`;
    const rightParts = [];
    if (!following) rightParts.push(`↓${transcript.length - start - room}`);
    if (!following && s.waiting) rightParts.push("◆ tap");
    rightParts.push(s.controllable ? shortModel(s.model) : "view only");
    return { header: spread(left, rightParts.filter(Boolean).join("  "), HEADER_INNER_W), body, menu, brightness: this.brightness(s, following) };
  }

  /**
   * With a working brightness set, the text dims while the session works and
   * comes back to full when it stops or needs the user. Text the user has
   * scrolled to, or a reply held for them, stays at full.
   */
  private brightness(s: SessionSummary, following: boolean): number | undefined {
    const level = this.app.hub.prefs.workingBrightness;
    if (!Number.isInteger(level) || level < 0 || level >= FULL_BRIGHTNESS) return undefined;
    return s.state === "working" && following ? level : FULL_BRIGHTNESS;
  }

  async action(a: Action) {
    const s = this.session;
    const page = SCROLL_STEP;
    if (this.app.hub.prefs.curtainMode && (a.type === "up" || a.type === "down" || a.type === "tap")) {
      const swipe = a.type === "tap" ? null : curtainAfterSwipe(this.curtain, a.type, { latest: this.following, working: this.busy(s) });
      if (swipe !== null) this.curtain = swipe;
      // Behind the curtain a tap has nothing to land on, and must not answer a dialog unseen.
      if (swipe !== null || this.curtain) return;
    }
    const waiting = !!s?.waiting && this.following;
    const opts = s && waiting ? this.options(s) : [];
    // Only a second tap, straight after the first, sends a suggestion: anything else calls it off.
    const suggestion = this.following && s?.controllable && this.app.hub.prefs.sendSuggestionOnTap ? this.suggestion(s) : "";
    const armed = this.armedFor(suggestion);
    this.arm(null);
    switch (a.type) {
      case "up":
        if (waiting && this.cursor > 0) this.cursor--;
        else this.view.scroll(-page);
        return;
      case "down":
        if (waiting && this.cursor < opts.length - 1) this.cursor++;
        else this.view.scroll(page);
        return;
      case "tap":
        if (!this.following) {
          this.view.toLatest();
          return;
        }
        if (s && waiting && opts.length) {
          const kind = s.waiting!.kind;
          const r = await this.app.hub.choose(this.id, kind, this.cursor);
          this.app.toast(`Chose: ${r.chosen}`);
          this.cursor = 0;
          this.view.toLatest(); // stay on what happens next, not on the reply before the dialog
          return;
        }
        if (s && suggestion && !armed) {
          this.arm(suggestion);
          return;
        }
        if (s && suggestion) {
          await this.app.hub.prompt(this.id, suggestion);
          s.suggestion = null; // the hub says so too, once Claude Code has taken the prompt
          this.app.toast("Sent");
          this.view.toLatest();
          return;
        }
        this.app.toast(s?.controllable ? "Hold to talk" : this.viewOnlyHint());
        return;
      case "doubleTap":
        if (armed) return; // called off above
        this.app.pop();
        return;
      case "menu":
        if (a.id === 2) this.view.toLatest();
        else if (a.id === 7) this.app.hub.refresh();
        else if (a.id === 1) {
          await this.app.hub.interrupt(this.id);
          this.app.toast("Interrupted");
        } else if (a.id === 6) {
          await this.app.hub.command(this.id, "/compact");
          this.app.toast("Compacting");
        } else if (a.id >= MODEL_MENU_BASE) {
          const model = this.models[a.id - MODEL_MENU_BASE];
          if (model) {
            await this.app.hub.command(this.id, `/model ${model.id}`);
            // Codex picks the model up with the next prompt; Claude Code switches now.
            this.app.toast(agentOf(s) === "codex" ? `${model.name} from your next message` : `Switched to ${model.name}`);
          }
        }
        return;
    }
  }

  voiceTarget() {
    const s = this.session;
    if (!s?.controllable) return null;
    if (s.waiting?.kind === "permission") return null; // approve or deny first; a typed Enter would pick an option
    return async (text: string) => {
      const current = this.session;
      if (current?.waiting?.kind === "question") await this.app.hub.answer(this.id, text);
      else await this.app.hub.prompt(this.id, text);
      this.view.toLatest();
    };
  }
}

// ---------- pickers ----------

interface Option {
  label: string;
  right?: string;
  run: () => Promise<void>;
}

abstract class Picker implements Screen {
  protected selected = 0;
  protected options: Option[] | null = null;
  protected error = "";

  constructor(protected app: App, protected title: string) {}

  abstract load(): Promise<Option[]>;

  enter() {
    this.load()
      .then((o) => {
        this.options = o;
        this.app.render();
      })
      .catch((err) => {
        this.error = err.message;
        this.app.render();
      });
  }

  frame(): Frame {
    if (this.error) return { header: this.title, body: wrap(`! ${this.error}`, BODY_INNER_W) };
    if (!this.options) return { header: this.title, body: ["Loading…"] };
    if (!this.options.length) return { header: this.title, body: ["Nothing here yet."] };
    const lines = this.options.map((o, i) => spread(`${i === this.selected ? CURSOR : NO_CURSOR}${o.label}`, o.right || "", BODY_INNER_W));
    return { header: spread(this.title, `${this.selected + 1}/${this.options.length}`, HEADER_INNER_W), body: windowAround(lines, this.selected, BODY_LINES).rows };
  }

  async action(a: Action) {
    const n = this.options?.length || 0;
    if (a.type === "up") this.selected = Math.max(0, this.selected - 1);
    else if (a.type === "down") this.selected = Math.min(Math.max(0, n - 1), this.selected + 1);
    else if (a.type === "doubleTap") this.app.pop();
    else if (a.type === "tap" && this.options?.[this.selected]) await this.options[this.selected].run();
  }
}

async function startSession(app: App, p: RecentProject, agent: Agent) {
  app.toast(`Starting ${AGENT_NAME[agent]} in ${p.project}…`, 15000);
  const { session } = await app.hub.launch(p.cwd, undefined, agent);
  app.hub.sessions.set(session.id, session);
  app.toast(`Started ${p.project}. Hold to talk.`);
  app.replace(new SessionScreen(app, session.id));
}

class ProjectPicker extends Picker {
  constructor(app: App) {
    super(app, "New session in…");
  }

  async load() {
    const { projects, agents } = await this.app.hub.recent();
    const available = agents?.length ? agents : this.app.hub.agents;
    return projects.map((p) => ({
      label: p.project,
      right: ago(p.mtime),
      run: async () => {
        if (available.length > 1) this.app.replace(new AgentPicker(this.app, p, available));
        else await startSession(this.app, p, available[0] || "claude");
      },
    }));
  }
}

class AgentPicker extends Picker {
  constructor(app: App, private project: RecentProject, private agents: Agent[]) {
    super(app, `${project.project} with…`);
  }

  async load() {
    return this.agents.map((agent) => ({
      label: AGENT_PRODUCT[agent] || agent,
      run: () => startSession(this.app, this.project, agent),
    }));
  }
}

class ResumePicker extends Picker {
  constructor(app: App) {
    super(app, "Resume");
  }

  async load() {
    const { sessions, agents } = await this.app.hub.recent();
    const showAgent = (agents?.length ? agents : this.app.hub.agents).length > 1;
    return sessions.map((r) => ({
      label: `${r.project} · ${r.title || "untitled"}`,
      right: `${showAgent ? `${AGENT_NAME[agentOf(r)]} ` : ""}${ago(r.mtime)}`,
      run: async () => {
        this.app.toast(`Resuming ${r.project}…`, 20000);
        const { session } = await this.app.hub.launch(r.cwd, r.id, r.agent);
        this.app.hub.sessions.set(session.id, session);
        this.app.toast(`Resumed ${r.project}`);
        this.app.replace(new SessionScreen(this.app, session.id));
      },
    }));
  }
}
