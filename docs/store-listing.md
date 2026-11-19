# Even Hub listing

Text and assets for putting the fork's copy of the glasses app on Even Hub, as a
private or beta build of your own or as a public listing. Upstream's own listing,
for its app and its macOS and Linux hub, is in
[upstream's repository](https://github.com/sousyllc/glancecode/blob/main/docs/store-listing.md).

The package ID and name come from `app\app.local.json`; see "The fork's copy of the
glasses app" in the [README](../README.md).

**Name** (20 characters max): GlanceCode Win

**Tagline** (50 characters max):
Claude Code on your G2: watch, approve, talk back.

**Short description**, where a field allows more:
Your Claude Code sessions on your glasses. Watch progress, approve, and talk back.

**Description:**

GlanceCode Win shows the Claude Code sessions running on your Windows PC and lets
you work with them from your G2, without taking the session over.

- See every session and whether it's working, idle or waiting for you.
- Read the live transcript: replies, progress and tool calls. A long reply starts
  at its first line, so you read it from the top.
- Approve or deny a tool call, or pick an answer to a question.
- Hold to talk. Your words appear as you speak, and a tap sends them.
- Start a Claude Code session in a recent project, or resume an earlier one.
- Interrupt a session, compact it, or switch its model from the menu.
- The screen dims while a session works and brightens when it is done or needs you.
- See the next prompt Claude Code suggests, when it suggests one, and send it
  with two taps.
- Keep working in the same session from your glasses and your PC at the same time.
  Nothing is copied or split, so you can switch whenever you like.

GlanceCode Win needs the free glancecode hub for Windows running on your PC, and
Tailscale on the PC and the phone. Setup is a checkout and one command; the steps
are at https://github.com/gwro/glancecode-win. Everything stays on your own PC and
network, and voice is transcribed locally.

Not paired yet? Tap on the glasses to try a demo with sample sessions.

GlanceCode Win is a Windows fork of GlanceCode by sousy. Both are independent
projects and aren't affiliated with Anthropic, Even Realities or Microsoft.

Visit the project at:
- GitHub: https://github.com/gwro/glancecode-win
- Upstream: https://github.com/sousyllc/glancecode
- Privacy: https://github.com/gwro/glancecode-win/blob/main/docs/privacy.md

**Permissions:**
- Glasses microphone: hold to talk. Audio goes only to the hub on your PC.
- Network: connects only to your own hub on your Tailscale network.

**Review notes:**
The app works without any setup through its built-in demo. Open the app, tap once
on the glasses, and every screen is available with sample sessions: the session
list, a working session, an approval (tap to approve), hold to talk, and the menu
(tap then hold). Double-tap on the session list exits.

The demo is upstream's and also lists Codex and Gemini sessions. This fork's hub
runs Claude Code only.

**Screenshots:** `docs/screenshots/01-home.png` to `05-menu.png` (576×288, PNG with a
transparent background). They are upstream's and show its app; `06-agents.png` shows
the choice between Claude Code, Codex and Gemini, which this fork doesn't offer, so
leave it out. None of them shows what the fork's copy adds.

Even Hub rejects solid black backgrounds, because the display is see-through: black
is the part you look through, and the portal previews the screenshot over a blurred
room photo. A capture from Even's simulator already has a transparent background.
To rebuild one from a black-background capture, with ImageMagick:

```sh
magick shot.png -alpha off -separate -evaluate-sequence max \
  -morphology Dilate Octagon:1 -level 0%,70% mask.png
magick -size 576x288 xc:"#00FF00" mask.png -alpha off \
  -compose copy_opacity -composite out.png
```

The mask carries the text, dilated and brightened a little so the thin strokes stay
readable against a light background, and the color is the display's green.

**Privacy policy URL:** https://github.com/gwro/glancecode-win/blob/main/docs/privacy.md

**Icon:** draw in the portal's 24×24 editor. Keep it to 2×2 pixel blocks.
