// Shared code for the helpers in the page (window.__cor3).
// Runs in the page's JS world at document_start, before every helper.
(() => {
  "use strict";
  if (window.__cor3) return;
  const toggles = (window.__cor3Toggles = window.__cor3Toggles || {});

  // Bump when the layout of cached game data changes, so old caches are dropped.
  const CACHE_V = 1;

  // Settings waiting to be written (saveSoon).
  const pending = new Map();
  let flushTimer = 0;
  function flush() {
    flushTimer = 0;
    for (const [key, value] of pending) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    }
    pending.clear();
  }
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });

  const topics = {}, queuedTopics = new Set();
  const checks = new Map();

  // The shared page watcher (onDom). Our own notes, marks and overlays have
  // an id or class starting with cor3- (or the ICE WALL overlay's iwb-);
  // changes inside them, or that only add or remove them, are ignored.
  const OWN = '[id^="cor3-"], [class*="cor3-"], [id^="iwb-"]';
  const own = (n) => {
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(el && el.closest && el.closest(OWN));
  };
  const domFns = [];
  let observer = null, domQueued = false, lastDomRun = 0;
  function runDom() {
    domQueued = false;
    if (document.hidden) return;
    lastDomRun = Date.now();
    for (const w of domFns) {
      const wait = w.gap - (lastDomRun - w.last);
      if (wait > 0) { if (!w.timer) w.timer = setTimeout(() => { w.timer = 0; callDom(w); }, wait); continue; }
      callDom(w);
    }
  }
  function callDom(w) {
    if (document.hidden) return;
    w.last = Date.now();
    try { w.fn(); } catch (e) { console.warn("[cor3 helper]", e); }
  }
  function queueDom() {
    if (domQueued) return;
    domQueued = true;
    const wait = 100 - (Date.now() - lastDomRun);
    if (wait > 0) setTimeout(() => requestAnimationFrame(runDom), wait);
    else requestAnimationFrame(runDom);
  }
  function watchDom() {
    if (observer) return;
    if (!document.body) { document.addEventListener("DOMContentLoaded", watchDom, { once: true }); return; }
    observer = new MutationObserver((recs) => {
      for (const r of recs) {
        if (own(r.target)) continue;
        if (r.type === "childList" && [...r.addedNodes, ...r.removedNodes].every(own)) continue;
        queueDom();
        return;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) queueDom(); });
    queueDom();
  }

  const cor3 = (window.__cor3 = {
    // Colours every helper uses, so notes and panels match.
    color: { GREEN: "#5df0a0", RED: "#ff8a70", GREY: "#7f9aa3", CYAN: "#76c1d1", TEXT: "#cfe7ee" },

    // ---------- settings in localStorage ----------
    // Fills `defaults` with what was saved under `key` and returns it.
    load(key, defaults) {
      try { Object.assign(defaults, JSON.parse(localStorage.getItem(key) || "{}")); } catch (_) {}
      return defaults;
    },
    save(key, value) {
      pending.delete(key);
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    },
    // The same, but at most once a second: game data comes in bursts. Anything
    // still waiting is written when the tab is hidden or closed.
    saveSoon(key, value) {
      pending.set(key, value);
      if (!flushTimer) flushTimer = setTimeout(flush, 1000);
    },

    // ---------- cached game data ----------
    // Game data kept between visits, so the helpers show something the moment
    // the game opens again, until the game sends fresh data. A cache older
    // than maxAgeMs, or from an older layout (CACHE_V), is thrown away.
    // Returns { data, at, put(data) }; data is null when there's nothing.
    cache(key, maxAgeMs) {
      let data = null, at = 0;
      try {
        const c = JSON.parse(localStorage.getItem(key) || "null");
        if (c && c.v === CACHE_V && Date.now() - c.at < maxAgeMs) ({ data, at } = c);
        else if (c) localStorage.removeItem(key);
      } catch (_) {}
      return { data, at, put: (d) => cor3.saveSoon(key, { v: CACHE_V, at: Date.now(), data: d }) };
    },

    // ---------- updates between helpers ----------
    // A helper calls emit("jobs") when its data changed; the others (the top
    // bar) redraw straight away instead of waiting for their next timer.
    // Several emits in a row run the listeners once.
    on(topic, fn) {
      (topics[topic] = topics[topic] || []).push(fn);
    },
    emit(topic) {
      if (queuedTopics.has(topic)) return;
      queuedTopics.add(topic);
      queueMicrotask(() => {
        queuedTopics.delete(topic);
        for (const fn of topics[topic] || []) {
          try { fn(); } catch (e) { console.warn("[cor3 helper]", e); }
        }
      });
    },

    // ---------- page changes ----------
    // One watcher on the game's page for every helper: fn runs soon after the
    // game changes what's on screen (at most ~10 times a second, or once per
    // gapMs for heavier work), not for changes the helpers make themselves,
    // and not while the tab is hidden.
    onDom(fn, gapMs) {
      domFns.push({ fn, gap: gapMs || 0, last: 0, timer: 0 });
      watchDom();
    },
    // A timer that skips while the tab is hidden and keeps going after an error.
    every(ms, fn, tag) {
      return setInterval(() => {
        if (document.hidden) return;
        try { fn(); } catch (e) { console.warn(`[${tag || "cor3 helper"}]`, e); }
      }, ms);
    },

    // ---------- game changes ----------
    // Helpers report whether game data they recognise still has the fields
    // they use: check("loadout", "loadout data", ok, sample). Three misses
    // since the game was opened, with no hit, flag that helper (shown quietly
    // in the top bar and the toolbar menu); a hit clears it. Once the data
    // looked right, odd packets later on don't flag it: the game only changes
    // when it updates, and then it loads again. Id "*" stands for every
    // helper that reads the game's data (net: true in helpers-list.js).
    check(id, what, ok, sample) {
      const k = id + "\u0000" + what;
      const c = checks.get(k) || { id, what, good: 0, bad: 0, flagged: false };
      checks.set(k, c);
      if (ok) {
        c.good++;
        if (c.flagged) { c.flagged = false; cor3.emit("health"); }
        return;
      }
      if (c.good || ++c.bad < 3 || c.flagged) return;
      c.flagged = true;
      console.warn(`[cor3 helper] ${id === "*" ? "Game data" : id}: the game's ${what} looks different than expected.` +
        " The helper may need an update.", sample ?? "");
      cor3.emit("health");
    },
    // { helperId: "what changed" } for the helpers flagged now.
    warnings() {
      const out = {};
      const net = (window.__cor3Helpers || []).filter((h) => h.net).map((h) => h.id);
      for (const c of checks.values()) {
        if (!c.flagged) continue;
        for (const id of c.id === "*" ? net : [c.id]) out[id] = out[id] ? `${out[id]}, ${c.what}` : c.what;
      }
      return out;
    },
    // Field names of a sample, for the console message (never the values).
    shape(o) {
      return o && typeof o === "object" ? Object.keys(o).slice(0, 30).join(", ") : typeof o;
    },

    // ---------- on/off switch + shortcut ----------
    // Registers a helper's switch (the toolbar menu and the top bar flip it)
    // and its Alt+key shortcut from the list in helpers-list.js.
    helper(id, get, set) {
      toggles[id] = { get, set };
      const info = (window.__cor3Helpers || []).find((h) => h.id === id);
      const key = info && info.key.toLowerCase();
      if (!key) return;
      window.addEventListener("keydown", (e) => {
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === key) {
          e.preventDefault();
          set(!get());
        }
      });
    },

    // ---------- game data ----------
    // Every decoded websocket packet goes to these (see socket.js).
    onPacket(fn) {
      (window.__cor3PacketListeners = window.__cor3PacketListeners || []).push(fn);
    },

    // The React fiber behind a DOM element, and a walk up its tree until
    // test(props) returns something.
    fiberOf(el) {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      return key ? el[key] : null;
    },
    findProps(el, test, maxDepth) {
      let f = cor3.fiberOf(el);
      for (let i = 0; f && i < maxDepth; i++, f = f.return) {
        const p = f.memoizedProps;
        if (p && typeof p === "object") {
          const hit = test(p);
          if (hit) return hit;
        }
      }
      return null;
    },

    // ---------- small helpers ----------
    // Puts markup the helpers build (game values already passed through esc)
    // into el, without innerHTML: parsed by DOMParser (which never runs
    // scripts), with scripts, embeds, on* handlers and javascript: links taken
    // out. Skips the work when el already shows this markup. Returns true if it
    // changed el.
    setHTML(el, html) {
      if (el.__cor3Html === html) return false;
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
      for (const bad of doc.body.querySelectorAll("script,iframe,object,embed,frame,link,meta,base")) bad.remove();
      for (const node of doc.body.querySelectorAll("*")) {
        for (const a of [...node.attributes]) {
          if (/^on/i.test(a.name) || (/^(href|src|action|formaction|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) {
            node.removeAttribute(a.name);
          }
        }
      }
      el.replaceChildren(...doc.body.childNodes);
      el.__cor3Html = html;
      return true;
    },
    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),

    // Game times arrive as Date (msgpack) or ISO strings (JSON / localStorage).
    toMs(v) {
      if (v instanceof Date) return v.getTime();
      if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : NaN; }
      if (typeof v === "number" && v > 1e12) return v;
      return NaN;
    },

    // A shadow-DOM host for our own panels (job panel, top bar), so the
    // game's styles can't reach in. The caller adds `host` to the page.
    shadowHost(id, css) {
      const host = document.createElement("div");
      host.id = id;
      const root = host.attachShadow({ mode: "open" });
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        root.adoptedStyleSheets = [sheet];
      } catch (_) {
        const st = document.createElement("style");
        st.textContent = css;
        root.appendChild(st);
      }
      return { host, root };
    },
  });
})();
