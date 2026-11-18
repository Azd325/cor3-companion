# Development

Edit `jobs.js`, `solver.js`, `expeditions.js`, `loadout.js`, `topbar.js`, `popup.html` or `manifest.json` in the project root.
Each helper registers an on/off switch in `toggles.js` (page side); `bridge.js` passes the toolbar menu's switches to it.
The toolbar icons in `icons/` are made from `icons/icon.svg` with `node make-icons.mjs`.

## Build

```
node build.mjs
```

This writes `dist/`:

| Output | Use |
|---|---|
| `dist/chrome/` | Chrome: **Load unpacked** this folder to test |
| `dist/cor3-helper-chrome.zip` | Same files, zipped |
| `dist/firefox/` | Firefox: `about:debugging` > **Load Temporary Add-on** > `manifest.json` (gone after restart) |
| `dist/cor3-helper-firefox.xpi` | Unsigned Firefox package |

## Releases (GitHub Actions)

`.github/workflows/release.yml` runs on every push to `main` that changes the extension, or by hand
from the **Actions** tab (**Release** > **Run workflow**, where you can pick patch, minor or major). It:

1. bumps `version` in `manifest.json` (`node bump.mjs`),
2. builds both packages and signs the Firefox one with Mozilla (`node sign.mjs`),
3. commits the new version, tags it `vX.Y.Z` and publishes a GitHub release with
   `cor3-helper-firefox.xpi`, `cor3-helper-chrome.zip` and `updates.json`.

Changes to only the README, `docs/` or the workflow don't start a release. A run takes 3–5 minutes,
most of it "Waiting for approval..." while Mozilla signs; don't cancel it, a signed version can't be
signed again. Pull after a release, since the workflow pushes the version commit to `main`.

It needs two repository secrets (Settings > Secrets and variables > Actions):
`WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET` (JWT secret), from
https://addons.mozilla.org/developers/addon/api/key/

## Signing locally

1. Copy `.env.example` to `.env` and fill in the same two keys (`.env` is git-ignored).
2. Bump `version` in `manifest.json`, then run `node sign.mjs`.
   The signed `.xpi` lands in `web-ext-artifacts/`.

Use the GitHub release instead where you can: a version signed locally can't be released by the workflow.
