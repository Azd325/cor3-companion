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

`.github/workflows/release.yml` runs on every push to `main` that changes the extension, or by hand
from the **Actions** tab (**Release** > **Run workflow**, where you can pick patch, minor or major). It:

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
the run waits 12 minutes, then releases without the `.xpi` and AMO publishes it once approved. Google's
review takes from hours to a few days, after which Chrome copies update by themselves.

Store listings, screenshots and the privacy tab answers are in [`store/`](../store/listing.md).
The privacy policy is [`PRIVACY.md`](../PRIVACY.md).

**Release notes:** every PR that changes what players see adds a line under **Unreleased** in
`CHANGELOG.md`, under **New**, **Improved** or **Fixed**, written for players. That's what the release
page shows for that version.

Changes to only the README, `CHANGELOG.md`, `PRIVACY.md`, `docs/`, `store/` or the workflow don't start a release. A run takes 3–5 minutes,
most of it "Waiting for approval..." while Mozilla signs; don't cancel it, a signed version can't be
signed again. Pull after a release, since the workflow pushes the version commit to `main`.

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
