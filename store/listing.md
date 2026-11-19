# Store listings

What to fill in on the Chrome Web Store dashboard and on addons.mozilla.org (AMO).

- **Description** (both stores): [`description.txt`](description.txt). AMO gets it automatically with every
  release, together with [`amo-metadata.json`](amo-metadata.json) (summary, category, homepage, license).
  Change the listing here, not on the AMO site, or the next release overwrites it.
  The Chrome Web Store API can't set listing text, so paste it into the Chrome dashboard by hand when it changes.
- **Short description** (Chrome takes it from `description` in `src/manifest.json`, max 132 characters).
- **Screenshots** (both stores, 1280×800): [`screenshots/`](screenshots/), the README's in-game captures with a caption.
- **Small promo tile** (Chrome, 440×280): [`screenshots/promo-small.png`](screenshots/promo-small.png).
- **Privacy policy:** https://github.com/nvanderwaal/cor3-companion/blob/main/PRIVACY.md

## Chrome Web Store: Store listing tab

| Field | Value |
|---|---|
| Category | Games (or Entertainment if Games isn't offered) |
| Language | English |
| Homepage URL | https://github.com/nvanderwaal/cor3-companion |
| Support URL | https://github.com/nvanderwaal/cor3-companion/issues |
| Mature content | No |

## Chrome Web Store: Privacy tab

**Single purpose description**

> Adds in-game helpers to the cor3.gg browser game: puzzle highlighters and solvers, a job tracker, loadout
> and market upgrade checks, expedition odds and inventory prices, each shown on the game's own pages and
> switchable from the toolbar menu.

**Host permission justification** (`*://cor3.gg/*`, `*://*.cor3.gg/*`)

> The extension only works on the cor3.gg game. It needs access to cor3.gg pages to show its helpers there:
> it reads the game data the page already receives (jobs, loadout, market, expeditions, inventory, puzzle
> boards) and adds outlines, notes and a small panel to the page. It has no access to any other site.

**Are you using remote code?** No, I am not using remote code.

> All JavaScript is in the package. The only network request the extension makes is from the toolbar menu
> to api.github.com for the latest version number, and only for copies not installed from the store.

**Data usage**: tick none of the data types. Then tick all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/nvanderwaal/cor3-companion/blob/main/PRIVACY.md

## Chrome Web Store: Distribution tab

Public, all regions, free.

## AMO

Everything but the screenshots comes from the release workflow. Upload the screenshots once under
**Edit Product Page** > **Images**, with these captions:

| File | Caption |
|---|---|
| 1-job-tracker.png | Job tracker: every taken job with its to-do list, server access and the route to each server |
| 2-expeditions.png | Expeditions: clear risk and reward numbers on every decision |
| 3-loadout.png | Loadout & market: whether a program fits your setup and what it would change |
| 4-ice-wall.png | ICE WALL Break: where the pattern can still fit |
| 5-inventory.png | Inventory: sell prices, rarity borders and your stash value |

The Chrome dashboard takes the same five screenshots in the same order.
