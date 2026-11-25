// A small copy button next to your player ID (FREEL_…) on the profile card.
// The game cuts the ID off with "…", so the button copies the whole text.
// Always on: it adds one icon and does nothing until clicked.
(() => {
  "use strict";
  const core = window.__cor3;
  if (!core || window.__cor3CopyId) return;
  window.__cor3CopyId = true;

  const ICON = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">' +
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1"/></svg>';
  const DONE = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8">' +
    '<path d="M3 8.5l3.2 3L13 4.5"/></svg>';

  function add() {
    for (const text of document.querySelectorAll('[data-component-name="UserIdentityUserNameText"]')) {
      const box = text.parentElement;
      if (!box || box.querySelector(":scope > .cor3-copy-id")) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cor3-copy-id";
      btn.title = "Copy player ID";
      btn.setAttribute("aria-label", "Copy player ID");
      btn.innerHTML = ICON;
      // Same colour as the ID, faded until hovered, so it reads as part of the card.
      btn.style.cssText = "all:unset;flex:none;display:inline-flex;align-items:center;justify-content:center;" +
        "width:18px;height:18px;margin-left:6px;cursor:pointer;opacity:.55;transition:opacity .15s;" +
        "color:" + getComputedStyle(text).color;
      btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
      btn.addEventListener("mouseleave", () => { if (!btn._t) btn.style.opacity = ".55"; });
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = (text.textContent || "").trim();
        if (!id || !(await core.copyText(id))) { btn.title = "Couldn't copy"; return; }
        btn.innerHTML = DONE;
        btn.title = "Copied " + id;
        btn.style.opacity = "1";
        clearTimeout(btn._t);
        btn._t = setTimeout(() => {
          btn._t = 0;
          btn.innerHTML = ICON;
          btn.title = "Copy player ID";
          if (!btn.matches(":hover")) btn.style.opacity = ".55";
        }, 1200);
      });
      // Keep the ID and the button on one line; the ID still shrinks with its "…".
      box.style.display = "flex";
      box.style.alignItems = "center";
      box.style.minWidth = "0";
      text.style.minWidth = "0";
      box.appendChild(btn);
    }
  }

  core.onDom(add, 500);
  add();
})();
