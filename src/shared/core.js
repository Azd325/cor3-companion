// Shared code for the helpers in the page (window.__cor3).
// Runs in the page's JS world at document_start, before every helper.
(() => {
  "use strict";
  if (window.__cor3) return;
  const toggles = (window.__cor3Toggles = window.__cor3Toggles || {});

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
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
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
