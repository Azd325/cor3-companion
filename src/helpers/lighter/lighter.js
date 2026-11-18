// COR3 lighter screen.
// Hides the game's moving backgrounds (the background videos and the network
// map's fog) to make the game easier on the eyes and on slower computers.
// Off until you switch it on with Alt+V or the toolbar menu. Only changes what
// you see; it never sends anything to the game.
(() => {
  "use strict";

  const STORE_KEY = "cor3-lighter-screen";
  const state = { enabled: false };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (_) {}

  // One style sheet does it all, so switching off is just removing it.
  const CSS = `
    #app-background, #glitch-background, #video-glitch, #video-waves,
    video[src*="/video/network-map/fog"] { display: none !important; }
  `;
  let style = null;
  function apply() {
    if (state.enabled) {
      if (!style) { style = document.createElement("style"); style.id = "cor3-lighter-screen"; style.textContent = CSS; }
      if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
      // Hidden videos keep playing; pause them so they stop costing anything.
      for (const v of document.querySelectorAll('#video-glitch, #video-waves, #app-background video, video[src*="/video/network-map/fog"]')) {
        if (!v.paused) { v.pause(); v.dataset.cor3Paused = "1"; }
      }
    } else {
      if (style) style.remove();
      for (const v of document.querySelectorAll("video[data-cor3-paused]")) { delete v.dataset.cor3Paused; v.play().catch(() => {}); }
    }
  }

  function setEnabled(on) {
    state.enabled = on;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
    apply();
  }
  (window.__cor3Toggles = window.__cor3Toggles || {}).lighter = { get: () => state.enabled, set: setEnabled };
  window.addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "v") { e.preventDefault(); setEnabled(!state.enabled); }
  });

  // The game adds videos as you move around (the fog when you open the map).
  setInterval(() => { if (state.enabled) apply(); }, 2000);
  apply();
})();
