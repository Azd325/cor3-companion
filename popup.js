// Toolbar menu: version, and a switch per helper that talks to the open
// cor3.gg tabs (bridge.js passes it on to the helpers in the page).
const api = globalThis.browser ?? globalThis.chrome;
document.getElementById("version").textContent = "v" + api.runtime.getManifest().version;

const COR3 = ["*://cor3.gg/*", "*://*.cor3.gg/*"];
const rows = [...document.querySelectorAll("li[data-id]")];
const hint = document.getElementById("hint");

async function cor3Tabs() {
  try { return await api.tabs.query({ url: COR3 }); } catch (_) { return []; }
}

async function send(tab, msg) {
  try { return await api.tabs.sendMessage(tab.id, { cor3Helper: true, ...msg }); } catch (_) { return null; }
}

function show(states) {
  for (const li of rows) {
    const sw = li.querySelector(".sw");
    const on = states ? states[li.dataset.id] : undefined;
    sw.disabled = on === undefined;
    sw.setAttribute("aria-checked", on ? "true" : "false");
  }
  if (!states) hint.textContent = "Open cor3.gg (or reload it) to switch helpers here. Shortcuts work in the game.";
}

let tabs = [];
async function refresh() {
  tabs = await cor3Tabs();
  // The active cor3.gg tab first, so the switches show what you're looking at.
  tabs.sort((a, b) => (b.active === true) - (a.active === true));
  for (const t of tabs) {
    const r = await send(t, { type: "get" });
    if (r && r.states) return show(r.states);
  }
  show(null);
}

for (const li of rows) {
  li.querySelector(".sw").addEventListener("click", async (e) => {
    const on = e.currentTarget.getAttribute("aria-checked") !== "true";
    let states = null;
    for (const t of tabs) {
      const r = await send(t, { type: "set", id: li.dataset.id, on });
      if (r && r.states && !states) states = r.states;
    }
    show(states);
  });
}

refresh();
