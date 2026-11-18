// Quiet update check for the toolbar menu.
//
// When the menu opens, asks GitHub (at most every 6 hours) for the latest
// release and, only if it is newer than this copy, shows one small line under
// the header with a link to it. No permissions, no background work, no badge.
//
// Chrome can't update unpacked extensions, so Chrome always gets the note.
// Firefox updates itself from the release's updates.json within about a day,
// so it only gets the note if a release is still not installed 2 days later.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const LATEST = "https://api.github.com/repos/nvanderwaal/cor3-companion/releases/latest";
  const KEY = "cor3UpdateCheck";
  const EVERY = 6 * 60 * 60 * 1000;
  const FIREFOX_GRACE = 2 * 24 * 60 * 60 * 1000;

  const isFirefox = api.runtime.getURL("").startsWith("moz-extension:");
  const current = api.runtime.getManifest().version;

  const parts = (v) => String(v).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  function newer(a, b) {
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (_) { return null; }
  }
  function save(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {}
  }

  async function latest() {
    const cached = load();
    if (cached && Date.now() - cached.checked < EVERY) return cached;
    try {
      const r = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const info = { checked: Date.now(), tag: j.tag_name, url: j.html_url, published: Date.parse(j.published_at) || 0 };
      save(info);
      return info;
    } catch (_) {
      // Offline or rate limited: stay silent and try again next time.
      if (cached) save({ ...cached, checked: Date.now() - EVERY + 30 * 60 * 1000 });
      return cached;
    }
  }

  function show(info) {
    const header = document.querySelector("header");
    if (!header) return;
    const bar = document.createElement("div");
    bar.id = "update";
    Object.assign(bar.style, {
      padding: "5px 12px", fontSize: "11px", color: "#cfe7ee",
      background: "#0d1d24", borderBottom: "1px solid #2d4a55",
    });
    const a = document.createElement("a");
    a.href = info.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = info.tag + " is out";
    Object.assign(a.style, { color: "#5df0a0", fontWeight: "700" });
    bar.append(a, isFirefox
      ? " · about:addons > gear > Check for Updates"
      : " · unzip it over your folder, then reload");
    header.after(bar);
  }

  latest().then((info) => {
    if (!info || !info.tag || !info.url || !newer(info.tag, current)) return;
    if (isFirefox && Date.now() - info.published < FIREFOX_GRACE) return;
    show(info);
  });
})();
