# Security

GlanceCode lets a paired phone drive Claude Code sessions on your PC, so security
issues matter here. Please report them privately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security tab,
"Report a vulnerability"). Please include steps to reproduce and the version
(`glancecode version`). This fork is provided as-is, without a promised response
time.

Don't open a public issue for a security problem. A problem that is also in
upstream's GlanceCode is worth reporting [there](https://github.com/sousyllc/glancecode/security)
too.

## Security model

- The hub API listens on 127.0.0.1. Phones reach it through `tailscale serve`,
  which terminates HTTPS on the machine's `*.ts.net` name and forwards to the hub.
- Every API request needs the pairing token (24 random bytes, compared in constant
  time). The token is stored in `%APPDATA%\glancecode\config.json`, in your Windows
  profile, and is never bundled into the glasses app. `glancecode pair` prints it,
  and the QR code from `pair --dev` carries it, so treat both like a password.
- The Claude Code hook posts to a separate port on 127.0.0.1 that is never served
  over Tailscale.
- The session host, which runs Claude Code and holds its screen, listens on a named
  pipe that only your Windows user can open. It never listens on the network.
- Keys are only sent to a session after the matching dialog is read back from the
  terminal, and prompts are refused while a permission dialog is open.
- The hub reads a session's screen to do that, and to find a prompt Claude Code
  suggests. A suggested prompt is shown on the glasses and sent only when you tap
  it and then tap again to confirm; `sendSuggestionOnTap` turns that off.

## Out of scope

- Anyone who already has the pairing token and access to your tailnet. That is
  the trust boundary by design.
- Claude Code's own permission system, which GlanceCode doesn't change.
- Other programs running as your user account. They can already run Claude Code
  directly.
