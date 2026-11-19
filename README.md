# CodeAside

> **Provided as-is.** This port comes with no guarantees or support; use it at
> your own risk, as the [MIT license](LICENSE) states.

CodeAside is a Windows-native port of [GlanceCode](https://github.com/sousyllc/glancecode):
drive your Claude Code sessions from Even Realities G2 glasses. See the live
transcript, approve tool calls, answer questions, and hold to talk. Everything runs
on your own PC and your own Tailscale network.

GlanceCode is an independent project by [sousy](https://github.com/sousyllc). This
fork adapts its hub and command-line tool to Windows, as `codeaside`, and carries
its own copy of the glasses app, which adds a few things for reading on the
glasses; see [The fork's copy of the glasses app](#the-forks-copy-of-the-glasses-app).
Upstream's GlanceCode app in Even Hub pairs with this hub too, as it would with the
original.
Neither project is affiliated with Anthropic, Even Realities or Microsoft.

## About this fork

Upstream GlanceCode runs on macOS and Linux and relies on tmux to hold each Claude
Code session, type into it and read its screen; on launchd or systemd for the
background service; and on Homebrew for whisper.cpp. None of those exist on Windows,
and running them through WSL would put Claude Code in a different operating system
from your editor and your files.

This fork replaces each of those pieces with its Windows equivalent and keeps
everything else: the hub's HTTP API, the session model and the transcript reader
are upstream's, so the same Even Hub app works with both. What the hub sends
beyond upstream's API is extra fields that upstream's app ignores.

| Upstream | This fork |
|---|---|
| tmux server, `send-keys`, `capture-pane` | A **session host**: a small Node process that runs Claude Code in a Windows pseudo-console (ConPTY), keeps a headless copy of its screen, and serves the hub and the CLI over a user-private named pipe |
| `glancecode-hook` (bash + curl) | A Node script that Claude Code runs under PowerShell; no Git Bash required |
| launchd / systemd user service | A Task Scheduler task for the signed-in user, started hidden at logon, restarted on failure, logging to `%LOCALAPPDATA%\codeaside\logs` |
| `caffeinate` | A helper holding the system awake (not the display) while on AC power |
| `brew install whisper-cpp` | `setup-voice` downloads whisper.cpp's Windows release and the speech model; on a PC with an NVIDIA GPU it installs the CUDA build |
| Codex and Gemini CLI support | Not included. The fork follows Claude Code only. |

The fork is versioned on its own, starting at 0.1.0. It was taken from upstream
0.6.2 (glasses app 0.3.1) and does not track later upstream releases; see
[CHANGELOG.md](CHANGELOG.md).

The design, the decisions behind it and what the implementation found along the way
are written up in [docs/windows-design.md](docs/windows-design.md). Two of those
findings apply to upstream as well: a screen read taken while Claude Code's UI is
mid-redraw can miss a line of a numbered dialog, and a hub that starts while Claude
is already waiting on a dialog should find it on screen. Both are handled here.

**Status.** The port is feature-complete. Sessions, the live transcript, approvals
with the real option labels, interrupt, model switching, new and resumed sessions,
the background service and hold to talk have all been exercised against a real hub
on Windows 11, using Even's simulator for the glasses app. It has since been used
with G2 glasses, with the fork's own copy of the app: pairing, the transcript,
voice, answering a question, and dimming while a session works.

## How it works

Every session is ordinary Claude Code running inside the session host, the way
upstream runs it inside tmux. The host runs Claude Code in a pseudo-console, keeps a
copy of its screen, and lets the hub type into it and read it back. The hub follows
your sessions through Claude Code hooks and their transcript files. The glasses app
talks only to the hub, over your private Tailscale network.

```
claude.exe (in ConPTY) ◀── keys ─── session host ◀── named pipe ──┬── codeaside claude / attach (your terminal)
        │ screen ──────────────────▶ (headless terminal)            └── hub (127.0.0.1)
        └── hooks ──────────────────────────────────────────────────────▶ hub ◀── tailscale serve (HTTPS) ◀── Even app ◀── G2
            transcript ─────────────────────────────────────────────────▶ hub
```

Claude Code itself is never replaced or modified, so your model, permission mode,
background tasks and Remote Control keep working. There is only ever one Claude
process per session, and the terminal and the glasses see the same conversation.
The host is a separate process from the hub, so restarting or upgrading the hub
leaves your sessions running, and the hub picks them up again when it comes back.

## What you get on the glasses

- A list of every Claude Code session on your PC, with live state: working, idle,
  or waiting for you.
- The live transcript of any session: prompts, replies, progress notes and tool
  calls, wrapped for the G2 display.
- Approvals and questions with the exact options the session is offering. Keys are
  only pressed after that dialog has been read back from the terminal.
- Start a new session in a recent project, or resume a past session.
- A menu to interrupt, compact, or switch the session's model without changing
  your default.
- Hold to talk. Words appear while you speak. Release to review, then tap to send.

With the fork's own copy of the app, also:

- A long reply is held at its first line, so you read it from the start.
- The screen dims while a session works and comes back to full brightness when it
  finishes or needs you.
- Tool descriptions fill the lines you allow them and are cut where the display
  ends, not at a fixed number of characters.
- The next prompt Claude Code suggests, when it suggests one. Two taps send it.

## Requirements

On your PC (Windows 10 version 1809 or newer; Windows 11 recommended):

- Node.js 20 or newer
- [Claude Code](https://claude.com/claude-code), signed in. The native installer,
  WinGet and npm installs all work. Git for Windows is not required.
- [Tailscale](https://tailscale.com/download/windows), signed in, with HTTPS
  certificates enabled for your tailnet at
  [login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns)
- Optional, for voice: nothing to install by hand. `codeaside setup-voice`
  downloads whisper.cpp and the speech model (about 550 MB) into
  `%LOCALAPPDATA%\codeaside`. With an NVIDIA GPU it takes the CUDA build (about
  685 MB, runtime included; only the normal driver is needed), which transcribes a
  sentence in under a tenth of a second. The CPU build (`--cpu`) takes about as
  long as the speech itself. Transcription is local and offline; there is no API
  key or subscription. Without it, everything except hold to talk still works.

On your phone:

- The Even Realities app, paired with your G2 glasses
- Tailscale for iPhone or Android, signed in to the same Tailscale account as the PC

## Install

From a checkout of this repository, in PowerShell:

```powershell
git clone https://github.com/gwro/CodeAside.git
cd CodeAside
npm install
npm run build:app
node bin\codeaside setup
```

`setup` checks the requirements, adds the hook to `%USERPROFILE%\.claude\settings.json`,
registers the hub as a Task Scheduler task that starts at logon, serves it over
HTTPS on your `*.ts.net` name, downloads the speech model, and prints a pairing
code. Each step is also its own command (`install`, `service install`, `serve`,
`setup-voice`, `pair`), and `doctor` reports which pieces are missing.

Then open the glasses app and paste the pairing code on the phone screen, or scan
the QR code that `pair` prints. The fork's own app is CodeAside; see
[The fork's copy of the glasses app](#the-forks-copy-of-the-glasses-app) for how to
get it. Upstream's GlanceCode app from Even Hub pairs the same way, without the
fork's additions.

To let the glasses drive a session you start at your desk, start it through the
host:

```powershell
node bin\codeaside claude       # takes the same arguments as claude
```

Sessions started any other way still appear on the glasses, marked view only.
Closing the terminal window only detaches; the session keeps running and
`codeaside attach` opens it again. Ctrl+] detaches deliberately.

To have `codeaside` on your PATH instead of `node bin\codeaside`, run
`npm install -g .` from the checkout. The installed service keeps working, since it
refers to the checkout by absolute path.

## The fork's copy of the glasses app

The app in `app/` started as upstream's 0.3.1 and is now versioned with the fork.
It has a name of its own, **CodeAside**, so that it isn't taken for upstream's app
or an edition of it. The hub and its command are `codeaside` as well.
It reads seven display settings from the hub, all described under
[Configuration](#configuration):

| Setting | What it does |
|---|---|
| `replyFromStart` | holds a long reply at its first line until you scroll on or tap for the latest |
| `workingBrightness` | dims a session's screen while it works |
| `latestOnTalk` | jumps to the latest lines when you start to talk |
| `latestOnPrompt` | jumps to the latest lines when a prompt is sent or a dialog answered, at the desk too |
| `toolLines` | how many lines a tool call's description may take |
| `showSuggestions` | shows the next prompt Claude Code suggests |
| `sendSuggestionOnTap` | lets two taps send that suggestion |

Apart from the settings, a view you have scrolled stays on the same line while new
lines arrive, and the header shows how many lines are below it (`↓13`).

Upstream's app in Even Hub has none of this and ignores the settings. There are
two ways to run the fork's copy, and both need a developer account with Even:
sign in once at [hub.evenrealities.com](https://hub.evenrealities.com/login) with
the account you use in the Even Realities app, then force-quit and reopen that app.

**Sideload it from the hub.** Nothing to upload, and it always runs the build in
your checkout:

```powershell
npm run build:app
node bin\codeaside pair --dev
```

In the Even Realities app, open the Even Hub tab, then the developer section in
its top-right corner, choose Scan QR and scan the second code, the one under
"Development sideload". It carries the hub address and the token, so the app opens
paired. Even's app suspends a sideloaded page when the phone app goes to the
background, and it usually has to be scanned again afterwards.

**Install your own build.** It stays on the phone like any Even Hub app, without
being published:

1. Give it an identity of your own in `app\app.local.json`, which git ignores. The
   package ID has to be one nobody else has claimed:
   ```json
   { "package_id": "com.example.codeaside", "name": "My CodeAside" }
   ```
2. Run `npm run pack:personal`. It raises the app's version, builds it and writes
   `codeaside.ehpk` in the checkout. Even's portal only offers phones an update
   when the version is new, which is why every pack raises it; add `-- --no-bump`
   to pack the current version again.
3. At hub.evenrealities.com, create an app for it and upload the file under
   Builds. If the portal asks for a name and package ID, they must match the ones
   in the package. The upload arrives as a private build.
4. To have it on the glasses menu and running with the phone locked, add yourself
   under Testing group, accept the invitation email, and promote the build to
   Beta. Then install it in the Even Realities app under Me > Beta tester. A build
   left private installs from Me > Apps > Private builds, with those two limits.
5. Open it and pair with the code from `codeaside pair`.

## Using it

| Gesture | Session list | Session |
|---|---|---|
| Swipe | move | scroll, or move between options |
| Tap | open | choose the highlighted option, or jump to the latest; twice, to send a suggested prompt |
| Hold | talk to the highlighted session | talk, or answer an open question; hold again to redo |
| Double-tap | exit | back |
| Tap then hold | menu | interrupt, jump to latest, switch model, compact |

After a hold, the transcript of what you said waits on screen: tap sends it, hold
records again, double-tap discards it.

In a session's transcript, `»` marks your prompts and `▷` a tool call; calls to the
same tool in a row collapse into one line (`Read ×3`), and only the last three
groups of a run show, under a line that counts the others. Tool output is not
shown, and a reply is cut at 4,000 characters. With the fork's copy of the app,
`↓13` in the header counts the lines below the view, and `→` marks a prompt Claude
Code suggests.

At your desk:

| Command | What it does |
|---|---|
| `codeaside claude [args]` | start Claude Code in the host and attach this console |
| `codeaside attach [name]` | open a running session in this terminal |
| `codeaside ls` | list sessions |
| `codeaside feed` | a readable live feed of every session |
| `codeaside status` | hub and sessions |
| `codeaside doctor` | check every piece and say what to fix |
| `codeaside pair [--dev]` | print the pairing code and its QR code; `--dev` adds the QR code that sideloads the fork's copy of the app |
| `codeaside service restart` | restart the hub; running sessions are untouched |
| `codeaside setup-voice [--cuda\|--cpu]` | install or switch the whisper.cpp build |

Logs are in `%LOCALAPPDATA%\codeaside\logs`: `hub.log` for the hub and `host.log`
for the session host.

The examples use PowerShell. In Git Bash, write the path with forward slashes
(`node bin/codeaside status`): Bash reads a backslash as an escape.

### If the glasses can't reach the hub

The app says so, with the address it tried and the reason in brackets.

- `(bad token)`: the phone reached the hub with an old token. Pair again.
- Anything else, such as `(Failed to fetch)`: the request never arrived. Run
  `codeaside doctor` on the PC, then open the hub's address
  (`https://<your-pc>.<tailnet>.ts.net:7443`) in the phone's browser.
  - If the page loads there, the phone reaches the PC and something on the phone
    is keeping the Even Realities app off Tailscale, for example app-based split
    tunnelling.
  - If it doesn't, check that Tailscale on the phone is connected, on the same
    account as the PC, and not put to sleep by battery optimisation. No exit node
    is needed.

## Security

- The hub listens on 127.0.0.1 only. Your phone reaches it through
  `tailscale serve`, so traffic stays inside your tailnet and is encrypted.
- Every request needs the pairing token. Anyone with that token and access to your
  tailnet can type into your sessions, so keep it private. To replace it, delete
  the `token` line in `%APPDATA%\codeaside\config.json` and restart the hub.
- The hook port accepts connections from 127.0.0.1 only.
- The session host listens on a named pipe that only your Windows user can open.
  It never listens on the network.
- Voice is transcribed on your PC. Audio is not sent anywhere else.

See [SECURITY.md](SECURITY.md) and [docs/privacy.md](docs/privacy.md).

## Configuration

`%APPDATA%\codeaside\config.json` is created on first run.

| Key | Default | Purpose |
|---|---|---|
| `port` | 7717 | hub API on 127.0.0.1 |
| `httpsPort` | 7443 | HTTPS port on your `*.ts.net` name |
| `hookPort` | 7718 | hook intake on 127.0.0.1 |
| `hostPipe` | `\\.\pipe\codeaside-host-<user>` | the session host's named pipe |
| `claudeArgs` | `[]` | extra arguments for sessions started from the glasses |
| `whisperBin` | `%LOCALAPPDATA%\codeaside\whisper\whisper-server.exe` | whisper.cpp server, as installed by `setup-voice`; point it at your own build to use that instead |
| `whisperThreads` | half the logical CPUs, 2 to 8 | CPU threads for transcription (CPU build) |
| `sttVocabulary` | | words the speech model should expect |
| `ntfyTopic` | empty | optional phone push through ntfy when a session finishes or needs you |
| `preventSleep` | true | keep the PC awake (not the display) while the hub runs and the PC is on AC power |
| `bindTailscaleIP` | false | also listen on the raw Tailscale IP over plain HTTP, for development |
| `replyFromStart` | true | on the glasses, hold a reply that arrives while a session is open, and is too long for the screen, at its first line, so you read it from the start; swipe down to read on, tap for the latest. A session you open always starts on its latest lines. With `false`, a session always shows its latest lines, as upstream's app does |
| `workingBrightness` | 0 | on the glasses, the text brightness of a session's screen while it is working, from 0 (dimmest) to 4 (full). Below 4, the screen dims while Claude works and returns to full when it finishes or needs you; text you have scrolled to, a held reply, and what you dictate stay at full. With `4`, nothing dims, as in upstream's app |
| `latestOnTalk` | true | on the glasses, when you hold to talk in a session that is scrolled up or held at the start of a reply, jump to its latest lines before listening. With `false`, the view stays where it was, as in upstream's app |
| `toolLines` | 2 | on the glasses, the lines a tool call's description may take, 1 to 6. A longer description is cut where the display runs out, measured in pixels, and ends in "…" |
| `latestOnPrompt` | true | on the glasses, jump to a session's latest lines when a prompt is sent to it or a dialog in it is answered, at the desk as well as from the glasses. With `false`, a view you have scrolled stays where it is |
| `showSuggestions` | true | on the glasses, show the next prompt Claude Code suggests, when it suggests one, under an idle session's latest lines, marked `→`. Claude Code only draws it in its input box, so the hub reads it off the screen of sessions started with `codeaside claude`; view-only sessions show none. With `false`, the hub doesn't look |
| `sendSuggestionOnTap` | true | on the glasses, let a tap on a shown suggestion send it as your next prompt once a second tap confirms it. After the first tap the glasses ask for the second for eight seconds; a double-tap or a swipe calls it off. With `false`, a suggestion is only shown |

The last seven are for [the fork's copy of the glasses app](#the-forks-copy-of-the-glasses-app).
Upstream's build in Even Hub ignores them and behaves as it always has. A setting
left out of the file has its default, so the file only needs the ones you change.

Restart the hub after changing the file: `codeaside service restart`. Sessions
keep running through a restart; a message being dictated at that moment is lost.

## Limitations

- Even Hub apps only run while they are open on the glasses. To hear about a
  session while another app is open, set `ntfyTopic`.
- The G2 display has one font weight, so markdown is shown as plain text.
- Sessions must be started with `codeaside claude` for the glasses to type into
  them. Others are view only, and show no suggested prompts, since the hub can't
  read their screen.
- A suggested prompt appears a few seconds after Claude Code draws it, and only
  when Claude Code offers one. Sending it types it into the session as a prompt
  of yours, so it runs with whatever permissions the session has.
- The app makes no sound and no vibration; the screen is its only signal. Dimming
  while a session works is the nearest thing to an alert: the screen brightens
  when it is done.
- How dim the lowest brightness is depends on the glasses and the light. If
  `workingBrightness` 0 is too dark to read, use 1.
- Voice on the CPU build runs at about real time, so the live preview while holding
  lags behind speech; the CUDA build does not. There is no prebuilt whisper.cpp
  server for AMD or Intel GPUs, but `whisperBin` can point at your own build.
- Codex and Gemini CLI, which upstream supports, are not included.

## Development

```powershell
npm install
npm run build:app          # build the glasses app
npm test                   # hub, host and app tests
node bin\codeaside hub    # run the hub in the foreground
npm run pack:personal      # pack the glasses app as codeaside.ehpk
```

The hub itself has no runtime dependencies, as upstream's doesn't. The session host
uses two: `@lydell/node-pty` for ConPTY, which ships prebuilt binaries for x64 and
ARM64 Windows, and `@xterm/headless` for the screen buffer. The CLI uses
`qrcode-terminal` for the pairing code.

[CONTRIBUTING.md](CONTRIBUTING.md) covers testing against a scratch configuration
and driving the glasses app in Even's simulator without hardware.
[docs/windows-design.md](docs/windows-design.md) is the design and the record of
what each stage of the port found.

## Acknowledgements

This fork exists because of [GlanceCode](https://github.com/sousyllc/glancecode) by
[sousy](https://github.com/sousyllc), whose hub design, transcript reader and
glasses app are used here with gratitude. Upstream in turn credits
[cc-g2](https://github.com/wmoto-ai/cc-g2),
[claude-code-g2](https://github.com/sam-siavoshian/claude-code-g2) and Even
Realities' [templates](https://github.com/even-realities/evenhub-templates). The
Windows port adds [node-pty](https://github.com/lydell/node-pty) by Simon Lydell,
[xterm.js](https://github.com/xtermjs/xterm.js) and
[whisper.cpp](https://github.com/ggml-org/whisper.cpp). All MIT licensed.

## License

[MIT](LICENSE), as upstream.
