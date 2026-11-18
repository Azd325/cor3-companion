// Passes the toolbar menu's switches to the helpers in the page (toggles.js).
// Runs in the extension's isolated world, which can talk to both sides.
(() => {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;

  function ask(msg) {
    return new Promise((resolve) => {
      const nonce = Math.random().toString(36).slice(2);
      const done = (states) => { window.removeEventListener("message", onMsg); clearTimeout(timer); resolve(states); };
      const onMsg = (e) => {
        const m = e.data;
        if (e.source === window && m && m.cor3Helper === "states" && m.nonce === nonce) done(m.states || {});
      };
      const timer = setTimeout(() => done(null), 1000);
      window.addEventListener("message", onMsg);
      window.postMessage({ cor3Helper: "ask", nonce, type: msg.type, id: msg.id, on: msg.on }, "*");
    });
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.cor3Helper !== true) return false;
    ask(msg).then((states) => sendResponse({ states }));
    return true; // answer asynchronously
  });
})();
