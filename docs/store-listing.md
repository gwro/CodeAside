# Even Hub listing

Text and assets for putting the fork's copy of the glasses app on Even Hub, as a
private or beta build of your own or as a public listing. Upstream's own listing,
for its app and its macOS and Linux hub, is in
[upstream's repository](https://github.com/sousyllc/glancecode/blob/main/docs/store-listing.md).

The package ID and name come from `app\app.local.json`; see "The fork's copy of the
glasses app" in the [README](../README.md).

**Name** (20 characters max): CodeAside

The app has a name of its own, without a platform in it, so that it isn't taken
for upstream's GlanceCode or an edition of it, and still fits if the hub later
runs on more than Windows. The hub and its command have the same name, `codeaside`.

**Tagline** (50 characters max):
Claude Code on your G2: watch, approve, talk back.

**Short description**, where a field allows more:
Your Claude Code sessions on your glasses. Watch progress, approve, and talk back.

**Description:**

CodeAside shows the Claude Code sessions running on your PC and lets you work with
them from your G2, without taking the session over.

- See every session and whether it's working, idle or waiting for you.
- Read the live transcript: replies, progress and tool calls. A long reply starts
  at its first line, so you read it from the top.
- Approve or deny a tool call, or pick an answer to a question.
- Hold to talk. Your words appear as you speak, and a tap sends them.
- Start a Claude Code session in a recent project, or resume an earlier one.
- Interrupt a session, compact it, or switch its model from the menu.
- The screen dims while a session works and brightens when it is done or needs you.
- Hide the screen while a session works: swipe down past the latest lines and only
  a row of dots is left until it is done. Swipe up to bring the screen back.
- See the next prompt Claude Code suggests, when it suggests one, and send it
  with two taps.
- Keep working in the same session from your glasses and your PC at the same time.
  Nothing is copied or split, so you can switch whenever you like.

CodeAside needs the free codeaside hub running on your PC, which is for Windows
today, and Tailscale on the PC and the phone. Setup is a checkout and one command;
the steps are at https://github.com/gwro/CodeAside. Everything stays on your
own PC and network, and voice is transcribed locally.

Not paired yet? Tap on the glasses to try a demo with sample sessions.

CodeAside is built on GlanceCode by sousy, as a fork of it. Both are independent
projects and aren't affiliated with Anthropic, Even Realities or Microsoft.

Visit the project at:
- GitHub: https://github.com/gwro/CodeAside
- Upstream: https://github.com/sousyllc/glancecode
- Privacy: https://github.com/gwro/CodeAside/blob/main/docs/privacy.md

**Permissions:**
- Glasses microphone: hold to talk. Audio goes only to the hub on your PC.
- Network: connects only to your own hub on your Tailscale network.

**Review notes:**
The app works without any setup through its built-in demo. Open the app, tap once
on the glasses, and every screen is available with sample sessions: the session
list, a working session, an approval (tap to approve), hold to talk, a suggested
prompt (tap twice to send), and the menu (tap then hold). Double-tap on the session
list exits. The demo's sessions are all Claude Code, as the hub's are.

**Screenshots:** in `docs/screenshots`, 576×288, PNG with a transparent background.
They are the fork's own app running its demo in Even's simulator, so they hold no
real session:

| File | Shows |
|---|---|
| `01-sessions.png` | the session list: one needing approval, one working, two idle |
| `02-approval.png` | an approval with its options |
| `03-transcript.png` | a session's transcript with tool calls |
| `04-voice.png` | hold to talk, with the words so far |
| `05-suggestion.png` | a suggested prompt, after the first tap |

To retake them: `npm run build:app`, then
`npx @evenrealities/evenhub-simulator --automation-port 9898 "http://127.0.0.1:7717/?demo"`
and `curl.exe -o shot.png 127.0.0.1:9898/api/screenshot/glasses`.

**Cover** (576×288, the size of a screenshot): `docs/screenshots/cover.png`, on a
dark background, and `cover-transparent.png`, the same without one. The name
and the tagline, in the display's green.

Even Hub rejects solid black backgrounds for screenshots, because the display is
see-through: black is the part you look through, and the portal previews the
screenshot over a blurred room photo. A capture from Even's simulator already has a
transparent background. To rebuild one from a black-background capture, with
ImageMagick:

```sh
magick shot.png -alpha off -separate -evaluate-sequence max \
  -morphology Dilate Octagon:1 -level 0%,70% mask.png
magick -size 576x288 xc:"#00FF00" mask.png -alpha off \
  -compose copy_opacity -composite out.png
```

The mask carries the text, dilated and brightened a little so the thin strokes stay
readable against a light background, and the color is the display's green.

**Privacy policy URL:** https://github.com/gwro/CodeAside/blob/main/docs/privacy.md

**Icon** (24×24, one bit: every pixel fully on or fully off): a terminal window
with a prompt, and a solid panel to its side. In `docs/screenshots`:
`icon-transparent.png` is the one to upload: `#F4F4F4` at full opacity on fully
transparent pixels, the only two values the portal accepts (pure white is
refused). `icon.png` is white on black and `icon-black-on-white.png` the inverse,
for showing it elsewhere. It is drawn in 2×2 pixel blocks, so it can
also be redrawn in the portal's 24×24 editor from this 12×12 grid:

```text
#########.##
#.......#.##
#.#.....#.##
#..#....#.##
#...#...#.##
#....#..#.##
#....#..#.##
#...#...#.##
#..#....#.##
#.#..##.#.##
#.......#.##
#########.##
```
