# Development

## Layout

Everything that ships in the extension lives in `src/`, one folder per helper:

```
src/
  manifest.json
  shared/                code every helper uses
    helpers-list.js      the helpers: id, name, Alt+key, menu text (toolbar menu, top bar, shortcuts)
    core.js              window.__cor3: settings, switch + shortcut, React props, small helpers
    toggles.js           page side of the toolbar menu's switches
    bridge.js            extension side of the same (isolated world)
    msgpack.js           decoder for the game's websocket frames
    socket.js            read-only websocket hook; hands packets to window.__cor3.onPacket
  helpers/
    icewall/  protocol/  dailyops/  jobs/  loadout/  expeditions/  inventory/  lighter/  topbar/
  popup/                 toolbar menu (popup.html, popup.js, update-check.js)
  icons/                 toolbar icons, made from icon.svg
scripts/                 build, bump, changelog, sign, make-icons (not shipped)
```

Every content script runs in the page's JS world except `shared/bridge.js`. The `shared/` files load
first (see `content_scripts` in `src/manifest.json`), so a helper can use `window.__cor3` straight away.

A new helper:

1. Add a folder under `src/helpers/` with its script, and add the script to `src/manifest.json`
   (the `document_start` group if it needs the websocket from the first packet, else `document_idle`).
2. Add it to `src/shared/helpers-list.js`. The toolbar menu, the top bar's Helpers menu and the
   shortcut come from that list.
3. In the script, register its switch with `window.__cor3.helper("<id>", get, set)` and read game data
   with `window.__cor3.onPacket(fn)`.

### Shared tools in `window.__cor3` (core.js)

| Call | Use |
|---|---|
| `onPacket(fn)` | every decoded websocket packet (socket.js hooks the socket once for everyone) |
| `onDom(fn, gapMs?)` | runs `fn` soon after the game changes the page; one shared observer, ignores our own `cor3-…` nodes, skips hidden tabs. Use it instead of polling the page on a timer |
| `every(ms, fn, tag)` | a timer that skips while the tab is hidden; only for countdowns and the minigame boards |
| `emit(topic)` / `on(topic, fn)` | tell other helpers your data changed (`jobs`, `expeditions`, `health`); the top bar redraws at once |
| `cache(key, maxAgeMs)` | game data kept between visits: `{ data, at, put(data) }`. Bump `CACHE_V` in core.js when a cached layout changes |
| `saveSoon(key, value)` | `save` at most once a second, flushed when the tab is hidden or closed |
| `check(id, what, ok, sample)` | report whether game data you recognised has the fields you use. Three misses with no hit since the game opened flag the helper with a ⚠ in the top bar and toolbar menu; `"*"` flags every `net: true` helper. Check only data you're sure is the right packet, so a flag means the game really changed |

The build packs everything in `src/` except `manifest.json` (written per browser) and `.svg` files.
The toolbar icons in `src/icons/` are made from `src/icons/icon.svg` with `node scripts/make-icons.mjs`.

## Build

```
node scripts/build.mjs
```

This writes `dist/`:

| Output | Use |
|---|---|
| `dist/chrome/` | Chrome: **Load unpacked** this folder to test |
| `dist/cor3-companion-chrome.zip` | Same files, zipped |
| `dist/firefox/` | Firefox: `about:debugging` > **Load Temporary Add-on** > `manifest.json` (gone after restart) |
| `dist/cor3-companion-firefox.xpi` | Unsigned Firefox package |

## Releases (GitHub Actions)

Releases are started by hand: **Actions** > **Release** > **Run workflow**, where you pick patch, minor or
major. Merging a PR to `main` never releases, so merge as many PRs as you like and ship them together as one
version. `.github/workflows/release.yml` then:

1. bumps `version` in `src/manifest.json` (`node scripts/bump.mjs`),
2. moves the **Unreleased** section of `CHANGELOG.md` under the new version and uses it as the release
   notes (`node scripts/changelog.mjs`); if it's empty, the notes list the PRs merged since the last release,
3. builds both packages and submits the Firefox one to addons.mozilla.org, listed
   (`node scripts/sign.mjs`), with the listing text from `store/`,
4. commits the new version and changelog, tags it `vX.Y.Z` and publishes a GitHub release with
   `cor3-companion-firefox.xpi`, `cor3-companion-chrome.zip` and `updates.json` (the last one only
   updates Firefox copies installed from GitHub before the store listing),
5. uploads the Chrome zip to the Chrome Web Store and submits it for review
   (`node scripts/chrome-upload.mjs`). A version still in review is withdrawn and replaced.

Both stores review new versions. Mozilla usually approves within minutes; if it wants a human review,
the run waits 5 minutes, then releases without the `.xpi` and AMO publishes it once approved. Google's
review takes from hours to a few days, after which Chrome copies update by themselves.

Store listings, screenshots and the privacy tab answers are in [`store/`](../store/listing.md).
The privacy policy is [`PRIVACY.md`](../PRIVACY.md).

**Release notes:** every PR that changes what players see adds a line under **Unreleased** in
`CHANGELOG.md`, under **New**, **Improved** or **Fixed**, written for players. That's what the release
page shows for that version.

A run takes 3–8 minutes, most of it "Waiting for approval..." while Mozilla signs. **Don't cancel it**:
once "Build and sign" has started, Mozilla has that version number and it can't be used again. If a run was
cancelled or failed after that point anyway, set `version` in `src/manifest.json` to the number it used
(see the run's "Bump version" step) and merge that, so the next run moves past it.
Pull after a release, since the workflow pushes the version commit to `main`.

It needs these repository secrets (Settings > Secrets and variables > Actions):

- `WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET` (JWT secret), from
  https://addons.mozilla.org/developers/addon/api/key/
- `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET` and `CHROME_REFRESH_TOKEN` (a Google OAuth client with the
  `https://www.googleapis.com/auth/chromewebstore` scope), `CHROME_PUBLISHER_ID` (Chrome Web Store
  dashboard > Account) and `CHROME_EXTENSION_ID`. Without them the Chrome step is skipped.
  See https://developer.chrome.com/docs/webstore/using-api

## Signing locally

1. Copy `.env.example` to `.env` and fill in the same two keys (`.env` is git-ignored).
2. Bump `version` in `src/manifest.json`, then run `AMO_CHANNEL=unlisted node scripts/sign.mjs`
   (without `AMO_CHANNEL=unlisted` it publishes the version on addons.mozilla.org).
   The signed `.xpi` lands in `web-ext-artifacts/`.

Use the GitHub release instead where you can: a version signed locally can't be released by the workflow.
