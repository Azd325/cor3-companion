// COR3 top bar.
// A thin strip at the top of the game with what needs your attention now
// (jobs ready to hand in, the next job deadline, an open expedition decision)
// and a menu to switch the helpers. It reads what the other helpers already
// collected; it never sends anything to the game. Alt+B shows or hides it.
(() => {
  "use strict";

  const STORE_KEY = "cor3-topbar";
  const state = { open: true, min: false };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (_) {}
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {} };

  // The helpers in the menu, in the toolbar menu's order.
  const HELPERS = [
    ["icewall", "ICE WALL Break", "Alt+H"],
    ["jobs", "Job tracker", "Alt+J"],
    ["loadout", "Loadout & market", "Alt+L"],
    ["expeditions", "Expeditions", "Alt+E"],
    ["topbar", "Top bar", "Alt+B"],
  ];
  const toggles = () => window.__cor3Toggles || {};

  // ---------- data ----------
  const toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : NaN);
  // "1h 05m", "42m", "4m 30s", "40s"; null when unknown or past.
  function left(v) {
    const ms = toMs(v) - Date.now();
    if (!(ms > 0)) return null;
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m >= 10) return `${m}m`;
    if (m) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
    return `${s}s`;
  }

  function jobsInfo() {
    const st = window.__cor3JobTracker?.state;
    if (!st) return null;
    const taken = Object.values(st.jobs || {}).filter((j) => j.status === "TAKEN");
    const ready = taken.filter((j) => j.canComplete).length;
    // The soonest deadline among jobs that still need work.
    const next = taken.filter((j) => !j.canComplete && toMs(j.endTime) > Date.now())
      .sort((a, b) => toMs(a.endTime) - toMs(b.endTime))[0];
    return { taken: taken.length, ready, nextMs: next ? toMs(next.endTime) - Date.now() : null,
             next: next ? left(next.endTime) : null, reset: left(st.market?.resetAt) };
  }

  function decisionInfo() {
    const decs = window.__cor3Expeditions?.decisions;
    if (!decs) return null;
    let soonest = null;
    for (const d of decs.values()) {
      const t = toMs(d.deadline);
      if (d.isResolved || !(t > Date.now())) continue;
      if (!soonest || t < soonest.t) soonest = { t };
    }
    return soonest && { ms: soonest.t - Date.now(), text: left(soonest.t) };
  }

  // ---------- bar ----------
  const CSS = `
    :host { all: initial; }
    .bar { position: fixed; top: 0; left: 50%; transform: translateX(-50%); z-index: 2147483645;
           display: flex; align-items: stretch; height: 22px; max-width: calc(100vw - 16px);
           background: rgba(8,16,22,.92); border: 1px solid #2d4a55; border-top: none; border-radius: 0 0 6px 6px;
           color: #cfe7ee; font: 11px/22px ui-monospace, Consolas, monospace; white-space: nowrap;
           box-shadow: 0 4px 14px rgba(0,0,0,.45); user-select: none; }
    .seg { padding: 0 8px; border-left: 1px solid #1d3640; overflow: hidden; text-overflow: ellipsis; }
    .seg:first-child { border-left: none; }
    button.seg { all: unset; padding: 0 8px; border-left: 1px solid #1d3640; cursor: pointer; }
    button.seg:hover { background: #10222b; }
    button.seg:first-child { border-left: none; }
    .logo { color: #76c1d1; font-weight: 700; letter-spacing: .05em; }
    .ok { color: #5df0a0; font-weight: 700; }
    .warn { color: #ffa040; font-weight: 700; }
    .bad { color: #ff8a70; font-weight: 700; }
    .dim { color: #7f9aa3; }
    .t { color: #ffc800; }
    .menu { position: fixed; top: 24px; z-index: 2147483645; min-width: 220px; max-width: 360px;
            background: rgba(8,16,22,.97); border: 1px solid #2d4a55; border-radius: 6px; padding: 4px 0;
            color: #cfe7ee; font: 12px/1.4 ui-monospace, Consolas, monospace; box-shadow: 0 6px 24px rgba(0,0,0,.5); }
    .row { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%;
           padding: 5px 10px; cursor: pointer; }
    .row:hover { background: #10222b; }
    .row .n { flex: 1; }
    .row kbd { color: #5df0a0; font: inherit; font-size: 10px; }
    .sw { width: 26px; height: 14px; border-radius: 7px; border: 1px solid #2d4a55; background: #16262e; position: relative; }
    .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: #7f9aa3; }
    .sw.on { background: #144d30; border-color: #2fae6a; }
    .sw.on::after { left: 14px; background: #5df0a0; }
  `;

  let host, root, bar, menu, openMenu = null, lastHtml = "";

  function ensure() {
    if (host && document.documentElement.contains(host)) return true;
    if (!document.body) return false;
    host = document.createElement("div");
    host.id = "cor3-topbar-host";
    root = host.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = CSS;
    root.appendChild(st);
    bar = document.createElement("div");
    bar.className = "bar";
    menu = document.createElement("div");
    menu.className = "menu";
    menu.hidden = true;
    root.append(bar, menu);
    document.body.appendChild(host);
    lastHtml = "";

    bar.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "min") { state.min = !state.min; openMenu = null; save(); }
      if (act === "helpers") openMenu = openMenu ? null : "helpers";
      if (act === "decision" && !openExpeditions()) {
        const btn = e.target.closest("[data-act]");
        btn.title = "Couldn't find the game's Expeditions button. Open Expeditions in the game.";
      }
      if (act === "jobs") toggles().jobs?.set(true);
      render(true);
    });
    menu.addEventListener("click", (e) => {
      const id = e.target.closest("[data-id]")?.dataset.id;
      const t = id && toggles()[id];
      if (t) { try { t.set(!t.get()); } catch (err) { console.warn("[cor3 topbar]", err); } }
      render(true);
    });
    // A click anywhere else closes the menu.
    window.addEventListener("mousedown", (e) => {
      if (openMenu && !e.composedPath().includes(host)) { openMenu = null; render(true); }
    }, true);
    return true;
  }

  function barHtml() {
    if (state.min) return `<button class="seg logo" data-act="min" title="Show the COR3 Companion bar">&#9670;</button>`;
    const parts = [`<button class="seg logo" data-act="min" title="Shrink the bar (Alt+B hides it)">&#9670; COR3</button>`];

    const j = jobsInfo();
    if (j && j.taken) {
      let txt = `Jobs ${j.taken}`;
      if (j.ready) txt += ` &middot; <span class="ok">${j.ready} READY</span>`;
      if (j.next) txt += ` &middot; next <span class="${j.nextMs < 15 * 60e3 ? "bad" : "t"}">${j.next}</span>`;
      parts.push(`<button class="seg" data-act="jobs" title="Open the job tracker">${txt}</button>`);
    } else if (j && j.reset) {
      parts.push(`<span class="seg dim" title="When the market's jobs reset">Jobs reset ${j.reset}</span>`);
    }

    const d = decisionInfo();
    if (d) {
      parts.push(`<button class="seg" data-act="decision" title="Open the expedition in the game">Decision <span class="${d.ms < 60e3 ? "bad" : "warn"}">${d.text}</span></button>`);
    }

    parts.push(`<button class="seg" data-act="helpers" title="Switch helpers">Helpers &#9662;</button>`);
    return parts.join("");
  }

  function menuHtml() {
    const t = toggles();
    return HELPERS.filter(([id]) => t[id]).map(([id, name, key]) => {
      let on = false;
      try { on = !!t[id].get(); } catch (_) {}
      return `<button class="row" data-id="${id}"><span class="sw ${on ? "on" : ""}"></span><span class="n">${name.replace("&", "&amp;")}</span><kbd>${key}</kbd></button>`;
    }).join("");
  }

  // Decision click: bring up the game's own expedition window. If its choice
  // buttons are already on screen, scroll to them and flash them; otherwise
  // click the game's Expeditions button (found by its text, since the game
  // gives it no stable id). Opening a window only changes what you see.
  const mine = (el) => el.closest("#cor3-topbar-host, #cor3-job-tracker-host");
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  function openExpeditions() {
    const opts = document.querySelector('[data-component-name="ExpeditionsEventButtons"]');
    if (opts && visible(opts)) {
      opts.scrollIntoView({ block: "center", behavior: "smooth" });
      opts.animate([{ outline: "2px solid #ffa040" }, { outline: "2px solid transparent" }], { duration: 1200 });
      return true;
    }
    const want = /^expeditions?$/i;
    const hits = [...document.querySelectorAll('button, a, [role="button"], [data-component-name], [title], [aria-label], span, div')]
      .filter((el) => !mine(el) && visible(el) &&
        (want.test((el.textContent || "").trim()) || want.test(el.getAttribute("aria-label") || "") || want.test(el.getAttribute("title") || "")));
    if (!hits.length) return false;
    // The innermost match, then the nearest clickable thing around it.
    const leaf = hits.find((el) => !hits.some((o) => o !== el && el.contains(o))) || hits[0];
    const target = leaf.closest('button, a, [role="button"]') || leaf;
    target.click();
    return true;
  }

  // Line the open menu up under its button, right edges together.
  function placeMenu() {
    const btn = bar.querySelector(`[data-act="${openMenu}"]`);
    if (!btn) { openMenu = null; return; }
    const r = btn.getBoundingClientRect();
    menu.style.top = r.bottom + 2 + "px";
    menu.style.right = Math.max(8, window.innerWidth - r.right) + "px";
  }

  function render(force) {
    if (!state.open) { if (host) host.style.display = "none"; return; }
    if (document.hidden && !force) return;
    if (!ensure()) return;
    host.style.display = "";
    const html = barHtml();
    if (html !== lastHtml) { bar.innerHTML = html; lastHtml = html; }
    if (state.min) openMenu = null;
    if (openMenu) placeMenu();
    menu.hidden = !openMenu;
    if (openMenu) {
      const html = menuHtml();
      if (menu.innerHTML !== html) menu.innerHTML = html;
    }
  }

  // Alt+B or the toolbar menu shows or hides the bar.
  const setOpen = (on) => { state.open = on; if (!on) openMenu = null; save(); render(true); };
  (window.__cor3Toggles = window.__cor3Toggles || {}).topbar = { get: () => state.open, set: setOpen };
  window.addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "b") { e.preventDefault(); setOpen(!state.open); }
  });

  setInterval(() => { try { render(false); } catch (e) { console.warn("[cor3 topbar]", e); } }, 1000);
  render(true);
})();
