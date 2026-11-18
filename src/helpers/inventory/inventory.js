// COR3 inventory helper.
// On the game's inventory page: the sell price on every item, a border in the
// item's rarity colour (none for common), and one line with the stash's total value.
// Uses the stash data the game sends when you open the inventory (through the
// websocket hook in shared/socket.js). Alt+I or the toolbar menu toggles it.
// Reads only; never sends anything.
(() => {
  "use strict";
  const { findProps, load, save } = window.__cor3;

  const PRICE_CLASS = "cor3-inv-price", SUM_CLASS = "cor3-inv-sum", TOP_ATTR = "data-cor3-inv-top";
  // Border per rarity (the game's `tier`); common items get none.
  const TIER_COLOR = { rare: "#4da3ff", epic: "#b06cff", legendary: "#ffa040", quest: window.__cor3.color.GREEN };
  const tierColor = (it) => TIER_COLOR[String(it.tier || "").toLowerCase()] || null;

  // ---------- on/off ----------
  const STORE_KEY = "cor3-inventory-helper";
  const state = load(STORE_KEY, { enabled: true });
  function clear() {
    for (const el of document.querySelectorAll(`.${PRICE_CLASS}, .${SUM_CLASS}`)) el.remove();
    for (const el of document.querySelectorAll(`[${TOP_ATTR}]`)) { el.style.outline = ""; el.removeAttribute(TOP_ATTR); }
  }
  window.__cor3.helper("inventory", () => state.enabled, (on) => {
    state.enabled = on;
    save(STORE_KEY, state);
    if (!on) clear(); else run();
  });

  // ---------- stash data ----------
  // The stash reply: { items: [{ id, name, sellPrice, canSell, quantity, ... }], maxCapacity, currentUsage }.
  let stash = null; // { items: Map(id -> item), used, max }
  function scan(node, depth) {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (node instanceof Uint8Array || node instanceof Date) return;
    if (Array.isArray(node)) { for (const x of node) scan(x, depth + 1); return; }
    if (Array.isArray(node.items) && "maxCapacity" in node) {
      const items = new Map();
      for (const it of node.items) if (it && it.id != null) items.set(String(it.id), it);
      stash = { items, used: node.currentUsage ?? node.items.length, max: node.maxCapacity };
      queue();
      return;
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === "object") scan(v, depth + 1);
    }
  }
  window.__cor3.onPacket(scan);
  window.__cor3Inventory = { get stash() { return stash; } };

  // ---------- page ----------
  // The stash item behind a tile: an `item` prop (or the props themselves)
  // whose id is in the stash.
  function itemOf(el) {
    return findProps(el, (p) => {
      for (const c of [p.item, p.stashItem, p]) {
        if (c && typeof c === "object" && c.id != null && stash.items.has(String(c.id))) return stash.items.get(String(c.id));
      }
      return null;
    }, 4);
  }
  const price = (it) => (it.canSell !== false && typeof it.sellPrice === "number" && it.sellPrice > 0 ? it.sellPrice : 0);
  const qty = (it) => (typeof it.quantity === "number" && it.quantity > 1 ? it.quantity : 1);
  const fmt = (n) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : n >= 1e4 ? `${Math.round(n / 100) / 10}k` : n.toLocaleString());

  function annotate() {
    if (!stash || !stash.items.size) return;
    // Tiles: the outermost element per stash item.
    const tiles = new Map();
    for (const el of document.querySelectorAll("[data-component-name]")) {
      if (el.closest(`.${SUM_CLASS}`)) continue;
      const it = itemOf(el);
      if (!it) continue;
      const had = tiles.get(it);
      if (!had || el.contains(had)) tiles.set(it, el);
    }
    if (!tiles.size) return;

    for (const [it, el] of tiles) {
      const p = price(it);
      let tag = el.querySelector(`:scope > .${PRICE_CLASS}`);
      if (!p) { if (tag) tag.remove(); } else {
        if (!tag) {
          tag = document.createElement("div");
          tag.className = PRICE_CLASS;
          tag.style.cssText = "position:absolute;right:2px;bottom:2px;z-index:2;padding:0 3px;border-radius:3px;" +
            "background:rgba(8,16,22,.85);font:700 10px/14px ui-monospace,Consolas,monospace;pointer-events:none";
          if (getComputedStyle(el).position === "static") el.style.position = "relative";
          el.appendChild(tag);
        }
        const text = `${fmt(p)} cr`;
        if (tag.textContent !== text) tag.textContent = text;
        tag.style.color = tierColor(it) || window.__cor3.color.TEXT;
        tag.title = qty(it) > 1 ? `sells for ${p.toLocaleString()} each, ${(p * qty(it)).toLocaleString()} for all ${qty(it)}` : `sells for ${p.toLocaleString()}`;
      }
      const color = tierColor(it);
      if (color) {
        if (el.getAttribute(TOP_ATTR) !== color) { el.setAttribute(TOP_ATTR, color); el.style.outline = `2px solid ${color}`; el.style.outlineOffset = "-2px"; }
      } else if (el.hasAttribute(TOP_ATTR)) { el.removeAttribute(TOP_ATTR); el.style.outline = ""; }
    }

    // One line above the items: total value and space.
    const els = [...tiles.values()];
    let grid = els[0].parentElement;
    while (grid && !els.every((e) => grid.contains(e))) grid = grid.parentElement;
    if (!grid || !grid.parentElement) return;
    let sum = grid.parentElement.querySelector(`:scope > .${SUM_CLASS}`);
    if (!sum) {
      sum = document.createElement("div");
      sum.className = SUM_CLASS;
      sum.style.cssText = "margin:0 0 6px;font:11px/1.4 ui-monospace,Consolas,monospace;color:#cfe7ee";
      grid.parentElement.insertBefore(sum, grid);
    }
    const total = [...stash.items.values()].reduce((s, it) => s + price(it) * qty(it), 0);
    const text = `Stash value ${total.toLocaleString()} cr` + (stash.max ? ` \u00b7 ${stash.used}/${stash.max} slots` : "");
    if (sum.textContent !== text) sum.textContent = text;
  }

  let queued = false;
  function run() {
    queued = false;
    if (!state.enabled) return;
    try { annotate(); } catch (e) { console.warn("[inventory helper]", e); }
  }
  // The page changes a lot; look at most a few times a second.
  function queue() { if (!queued) { queued = true; setTimeout(run, 300); } }
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  setInterval(run, 2000);
})();
