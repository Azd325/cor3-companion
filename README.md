# COR3 Helper

Browser extension for cor3.gg:

- **ICE WALL Break**: highlights where the target pattern fits on the board (Alt+H toggles).
- **Job tracker**: a panel with your taken jobs, their to-do items and server access (Alt+J toggles),
  plus an access mark after the server names on the market's job cards.

It only reads what the game already sends to your browser; it never sends anything itself.

## Releases (GitHub Actions)

`.github/workflows/release.yml` runs on every push to `main`, or by hand from the **Actions** tab
(**Release** > **Run workflow**, where you can pick patch, minor or major). It:

1. bumps `version` in `manifest.json` (`node bump.mjs`),
2. builds both packages and signs the Firefox one with Mozilla (`node sign.mjs`),
3. commits the new version, tags it `vX.Y.Z` and publishes a GitHub release with
   `cor3-helper-firefox.xpi`, `cor3-helper-chrome.zip` and `updates.json`.

It needs two repository secrets (Settings > Secrets and variables > Actions):
`WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET` (JWT secret). Pull first after a release,
since the workflow pushes the version commit to `main`.

**Firefox** copies installed from a release update themselves: their manifest points at the
latest release's `updates.json`. **Chrome** can't auto-update extensions from outside the Chrome Web Store:
download the new zip, unzip it over your extension folder and click reload in `chrome://extensions`.

## Build

```
node build.mjs
```

This writes `dist/`:

| Output | Use |
|---|---|
| `dist/chrome/` | Chrome / Edge / Brave: "Load unpacked" |
| `dist/cor3-helper-chrome.zip` | Same files, zipped |
| `dist/firefox/` | Firefox: temporary load, or source for signing |
| `dist/cor3-helper-firefox.xpi` | Firefox: install from file |

Edit `jobs.js`, `solver.js` or `manifest.json` in the project root, then build again.

## Install in Chrome (or Edge, Brave)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `dist/chrome` folder, or a folder where you unzipped
   `cor3-helper-chrome.zip` from a release. Keep that folder; Chrome loads the extension from it.

It stays installed across restarts. After a rebuild, click the reload icon on the extension's card.
Chrome may show a "developer mode extensions" notice at startup; that's normal for unpacked extensions.

## Install in Firefox

Release Firefox only installs extensions permanently if Mozilla has signed them. Pick one:

**A. Sign it yourself (works in normal Firefox, stays installed)**
1. Create a free account on addons.mozilla.org, then get API keys at
   https://addons.mozilla.org/developers/addon/api/key/
2. Copy `.env.example` to `.env` and put your JWT issuer and secret in it (`.env` is git-ignored).
3. Run:
   ```
   node sign.mjs
   ```
   This builds, then signs `dist/firefox` as "unlisted" (signed, but not published in the add-on store).
4. Drag the signed `.xpi` from `web-ext-artifacts/` onto a Firefox window and confirm.
   Bump `version` in `manifest.json` before signing again; each version can be signed once.

**B. Firefox Developer Edition / Nightly (no signing)**
1. Open `about:config`, set `xpinstall.signatures.required` to `false`.
2. Open `about:addons` > gear icon > **Install Add-on From File** > `dist/cor3-helper-firefox.xpi`.

**C. Temporary (any Firefox, gone after restart)**
`about:debugging#/runtime/this-firefox` > **Load Temporary Add-on** > `dist/firefox/manifest.json`.

If nothing shows up on cor3.gg in Firefox, click the puzzle-piece icon and allow the extension on cor3.gg.
