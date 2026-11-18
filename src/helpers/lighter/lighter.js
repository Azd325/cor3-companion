// COR3 lighter screen.
// Hides the game's moving backgrounds (the background videos and the network
// map's fog) to make the game easier on the eyes and on slower computers.
// Off until you switch it on with Alt+V or the toolbar menu. Only changes what
// you see; it never sends anything to the game.
(() => {
  "use strict";

  const STORE_KEY = "cor3-lighter-screen";
  const state = window.__cor3.load(STORE_KEY, { enabled: false });

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

  window.__cor3.helper("lighter", () => state.enabled, (on) => {
    state.enabled = on;
    window.__cor3.save(STORE_KEY, state);
    apply();
  });

  // The game adds videos as you move around (the fog when you open the map).
  setInterval(() => { if (state.enabled) apply(); }, 2000);
  apply();
})();
