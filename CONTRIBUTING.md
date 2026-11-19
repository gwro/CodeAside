# Contributing

This is the Windows-native fork of [GlanceCode](https://github.com/sousyllc/glancecode),
published at [gwro/CodeAside](https://github.com/gwro/CodeAside).
See `docs/windows-design.md` for what changed and why.

## Setup

```powershell
git clone https://github.com/gwro/CodeAside.git
cd CodeAside
npm install
npm run build:app
npm test
```

Run the hub from the checkout with `node bin/codeaside hub`. To keep a development
hub apart from an installed one, set `CODEASIDE_CONFIG_DIR`, `CODEASIDE_DATA_DIR` and
`CODEASIDE_HOST_PIPE` to scratch values and use different ports in that config.

Claude Code also reads hooks from a project's own `.claude/settings.json`, so a
scratch project folder with the hook in it lets you test the hub without touching
your user settings.

## Testing the glasses app without glasses

The Even Hub simulator runs the glasses app on the PC. Pointed at the hub's own
copy of the app with the hub address and token in the URL, it shows your real
sessions, so the whole stack short of the hardware can be tested:

```powershell
npm run build:app
$cfg = Get-Content "$env:APPDATA\codeaside\config.json" | ConvertFrom-Json
npx @evenrealities/evenhub-simulator --automation-port 9898 "http://127.0.0.1:7717/?hub=http%3A%2F%2F127.0.0.1%3A7717&token=$($cfg.token)"
```

For the demo data, or the app from Vite with live reload:

```powershell
cd app; npx vite --host 127.0.0.1
npx @evenrealities/evenhub-simulator --automation-port 9898 "http://127.0.0.1:5173/?demo"
```

The simulator's automation API takes input and screenshots. Actions are `up`,
`down`, `click`, `double_click`, `long_press`, `long_press_release` and
`context_menu`; `/api/console` returns the app's console output:

```powershell
curl.exe -X POST 127.0.0.1:9898/api/input -H "Content-Type: application/json" -d "{\"action\":\"click\"}"
curl.exe -o shot.png 127.0.0.1:9898/api/screenshot/glasses
```

Screenshots are RGBA with a transparent background. Composite them onto black
to view them.

A long press in the simulator records from the PC's microphone. Send
`long_press_release` after every `long_press`: the app ignores a second press
until it has seen the first one released.

To try a hub change without restarting your installed hub, run a second one from
the checkout on other ports, as under Setup. It has no sessions of its own, since
your hooks report to the installed hub. To give it some, copy entries from
`%APPDATA%\codeaside\sessions.json` into the scratch config folder's
`sessions.json`; with `CODEASIDE_HOST_PIPE` left unset it reads those sessions'
screens from your real host, and can type into them, so only look.

## The glasses app

`app/` is the fork's own copy of the glasses app. Upstream's build in Even Hub
keeps working with this hub, so anything the hub adds to the API has to be an
extra field that an app unaware of it can ignore; a tool call's `full` description
next to its `text` is an example.

A display setting takes four steps:

1. A default in `hub/config.mjs`.
2. The value in `prefs` in `/api/state` (`hub/server.mjs`), checked there.
3. The same default in `Hub.prefs` (`app/src/hub.ts`), for a hub that sends none.
4. A row in the README's Configuration table and a line in the changelog.

`node bin\codeaside pair --dev` sideloads the app from the hub, and
`npm run pack:personal` packs it for upload; the README has both in full.

## Guidelines

- The hub has no runtime dependencies. The two the fork needs (`@lydell/node-pty`
  for ConPTY and `@xterm/headless` for the screen buffer) live in `host/` only.
- Anything that presses keys in a session must first confirm the expected dialog
  is on screen.
- Test against a real Claude Code session in a scratch folder with a scratch
  config dir and host pipe, and never run `/model` against your real settings in
  a test.
- Glasses text must fit the 576×288 display. Use the helpers in `app/src/text.ts`,
  which measure in the firmware font's pixels; a count of characters doesn't say
  whether a line fits.
- A change to how the glasses app behaves goes behind a setting.
- The session host only picks up new code when it next starts, which is when no
  session is left in it. Prefer what the running host already offers; reading the
  styled screen through `styledScreen` is how suggestions are found without a new
  host operation.
- Restarting the hub drops a message that is being dictated. Sessions survive it.
