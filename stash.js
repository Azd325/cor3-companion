// COR3 inventory helper.
// On the game's inventory page: the sell price on every item, a gold border on
// the items worth the most, and one line with the stash's total value.
// Uses the stash data the game sends when you open the inventory (through the
// websocket hook in jobs.js). Alt+I or the toolbar menu toggles it.
// Reads only; never sends anything.
(() => {
  "use strict";

  const PRICE_CLASS = "cor3-inv-price", SUM_CLASS = "cor3-inv-sum", TOP_ATTR = "data-cor3-inv-top";
  const GOLD = "#ffc800";

  // ---------- on/off ----------
  const STORE_KEY = "cor3-inventory-helper";
  const state = { enabled: true };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (_) {}
  function clear() {
    for (const el of document.querySelectorAll(`.${PRICE_CLASS}, .${SUM_CLASS}`)) el.remove();
    for (const el of document.querySelectorAll(`[${TOP_ATTR}]`)) { el.style.outline = ""; el.removeAttribute(TOP_ATTR); }
  }
  function setEnabled(on) {
    state.enabled = on;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
    if (!on) clear(); else run();
  }
  (window.__cor3Toggles = window.__cor3Toggles || {}).inventory = { get: () => state.enabled, set: setEnabled };
  window.addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "i") { e.preventDefault(); setEnabled(!state.enabled); }
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
  (window.__cor3PacketListeners = window.__cor3PacketListeners || []).push(scan);
  window.__cor3Inventory = { get stash() { return stash; } };

  // ---------- page ----------
  function fiberOf(el) {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    return key ? el[key] : null;
  }
  // The stash item behind a tile: an `item` prop (or the props themselves)
  // whose id is in the stash.
  function itemOf(el) {
    let f = fiberOf(el);
    for (let i = 0; f && i < 4; i++, f = f.return) {
      const p = f.memoizedProps;
      if (!p || typeof p !== "object") continue;
      for (const c of [p.item, p.stashItem, p]) {
        if (c && typeof c === "object" && c.id != null && stash.items.has(String(c.id))) return stash.items.get(String(c.id));
      }
    }
    return null;
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

    // The most valuable items: the top tenth by price (at least one, at most 8).
    const sellable = [...stash.items.values()].filter(price).sort((a, b) => price(b) - price(a));
    const n = Math.min(8, Math.max(1, Math.round(sellable.length / 10)));
    const top = new Set(sellable.slice(0, n));

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
        tag.style.color = top.has(it) ? GOLD : "#cfe7ee";
        tag.title = qty(it) > 1 ? `sells for ${p.toLocaleString()} each, ${(p * qty(it)).toLocaleString()} for all ${qty(it)}` : `sells for ${p.toLocaleString()}`;
      }
      if (top.has(it)) {
        if (!el.hasAttribute(TOP_ATTR)) { el.setAttribute(TOP_ATTR, ""); el.style.outline = `2px solid ${GOLD}`; el.style.outlineOffset = "-2px"; }
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
    const text = `Stash value ${total.toLocaleString()} cr` + (stash.max ? ` · ${stash.used}/${stash.max} slots` : "") +
      (top.size ? ` · gold: your ${top.size} most valuable` : "");
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
