// COR3 helper switches.
// Each helper registers its get/set here (window.__cor3.helper in core.js), so
// the toolbar menu can show and flip it (through bridge.js) as well as the
// helper's own shortcut.
// Runs in the page's JS world before the helpers.
(() => {
  "use strict";
  const reg = (window.__cor3Toggles = window.__cor3Toggles || {});
  if (window.__cor3TogglesReady) return;
  window.__cor3TogglesReady = true;

  const states = () => {
    const out = {};
    for (const [id, t] of Object.entries(reg)) {
      try { out[id] = !!t.get(); } catch (_) {}
    }
    return out;
  };

  // Messages come from bridge.js (the extension side of this page).
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.cor3Helper !== "ask") return;
    if (m.type === "set" && reg[m.id]) {
      try { reg[m.id].set(!!m.on); } catch (err) { console.warn("[cor3 helper]", err); }
    }
    let warnings = {};
    try { warnings = window.__cor3.warnings(); } catch (_) {}
    window.postMessage({ cor3Helper: "states", nonce: m.nonce, states: states(), warnings }, "*");
  });
})();
