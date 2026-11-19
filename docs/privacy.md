# Privacy policy

Last updated: 19 November 2026

GlanceCode for Windows is made of two parts: the hub, which you install and run on
your own PC, and the glasses app for Even Realities G2 glasses. This policy covers
both, for this fork. Upstream's GlanceCode has
[its own](https://github.com/sousyllc/glancecode/blob/main/docs/privacy.md).

## What the app handles

- **Session content.** The app shows your Claude Code sessions: prompts, replies,
  tool calls and status. It fetches them from the hub on your PC and keeps them in
  memory only while the app is open.
- **Voice.** When you hold to talk, audio from the glasses microphone is sent to
  the hub on your PC, which turns it into text with a speech model running
  locally. Audio isn't stored and isn't sent to any other service.
- **Pairing details.** The hub address and pairing token are saved in the Even
  Realities app's storage for this app, so you don't have to pair again.

## What the hub reads on your PC

- **Transcripts.** Claude Code's own session files, to show a session's history
  and follow it live.
- **Hooks.** Claude Code tells the hub when a session starts, works, asks for
  something or stops.
- **The terminal screen** of sessions started with `glancecode claude`: to read
  the options of an approval or a question before pressing a key, and to find the
  next prompt Claude Code suggests in its input box. Set `showSuggestions` to
  `false` to stop the hub looking for suggestions.

The hub keeps what it needs to list your sessions again after a restart in
`%APPDATA%\glancecode\sessions.json`: their ids, folders and transcript paths, not
their content. Its log, `%LOCALAPPDATA%\glancecode\logs\hub.log`, records the
prompts sent from the glasses and what your voice was transcribed as.

## Where data goes

The app connects only to the hub address you paired with, over your own Tailscale
network. GlanceCode has no servers, accounts, analytics or tracking, and the
developers never receive your data.

The hub works with Claude Code on your PC. What Claude Code sends to Anthropic is
covered by your agreement with Anthropic, not by this policy.

If you turn on the optional phone notifications (`ntfyTopic`), the hub sends the
project name and up to 180 characters of text to the ntfy server you configure:
the start of Claude's last reply when a session finishes, or what it is asking to
do when it needs you. Anyone who knows the topic name can read them.

## Removing your data

Choose "Forget this hub" in the app and uninstall the app. On the PC, remove the
hub with `glancecode service uninstall` and `glancecode uninstall`, and
`npm uninstall -g @gwro/glancecode-win` if you installed the command globally.
Configuration lives in `%APPDATA%\glancecode`, and the speech model, whisper.cpp and
the logs in `%LOCALAPPDATA%\glancecode`; delete both folders to remove everything.

## Contact

Open an issue at https://github.com/gwro/glancecode-win/issues.
