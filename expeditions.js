// COR3 expeditions helper.
// - Shows each decision option's risk/loot change on the button itself (the game
//   hides it in a hover tooltip), with risk colours the right way round.
// - Marks options that are a clear win (less risk or more loot, no downside).
// - Adds the exact risk score (0-100) next to LOW / MODERATE / HIGH.
// Reads React props only; never sends anything.
(() => {
  "use strict";

  const LABEL_CLASS = "cor3-exp-mods";
  const SCORE_CLASS = "cor3-exp-score";
  const GREEN = "#5df0a0", RED = "#ff8a70", GREY = "#7f9aa3";
  const ARROW = { up: "&#9650;", down: "&#9660;", no_change: "&#8211;" };

  function fiberOf(el) {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    return key ? el[key] : null;
  }

  // Walk up the fiber tree until test(props) matches.
  function findProps(el, test, maxDepth = 25) {
    let f = fiberOf(el);
    for (let i = 0; f && i < maxDepth; i++, f = f.return) {
      const p = f.memoizedProps;
      if (p && typeof p === "object") {
        const hit = test(p);
        if (hit) return hit;
      }
    }
    return null;
  }

  // Risk going up is bad, loot going up is good.
  const riskColor = (c) => (c === "up" ? RED : c === "down" ? GREEN : GREY);
  const lootColor = (c) => (c === "up" ? GREEN : c === "down" ? RED : GREY);

  const isClearWin = (b) =>
    b.riskChange !== "up" && b.lootChange !== "down" &&
    (b.riskChange === "down" || b.lootChange === "up");

  function labelHtml(b) {
    const parts = [];
    if (b.riskChange) parts.push(`<span style="color:${riskColor(b.riskChange)}">Risk ${ARROW[b.riskChange] || ""}</span>`);
    if (b.lootChange) parts.push(`<span style="color:${lootColor(b.lootChange)}">Loot ${ARROW[b.lootChange] || ""}</span>`);
    if (!parts.length) return "";
    const star = isClearWin(b) ? `<span style="color:${GREEN}" title="Less risk or more loot, no downside">&#9733;</span> ` : "";
    return star + parts.join(" &nbsp;");
  }

  function annotateButtons() {
    for (const box of document.querySelectorAll('[data-component-name="ExpeditionsEventButtons"]')) {
      const buttons = findProps(box, (p) => (Array.isArray(p.buttons) ? p.buttons : null), 5);
      if (!buttons) continue;
      // The game renders one wrapper element per option, in the same order.
      const items = Array.from(box.children);
      buttons.forEach((b, i) => {
        const item = items[i];
        if (!item) return;
        // On narrow windows the game already shows the modifiers inline; don't double them.
        const html = item.getAttribute("data-component-name") === "ExpeditionsEventButtonItem" ? "" : labelHtml(b);
        let label = item.querySelector(`:scope > .${LABEL_CLASS}`);
        if (!html) { if (label) label.remove(); return; }
        if (!label) {
          label = document.createElement("div");
          label.className = LABEL_CLASS;
          label.style.cssText = "margin-top:4px;font:600 11px/1.2 ui-monospace,Consolas,monospace;" +
            "text-align:center;pointer-events:none;white-space:nowrap";
          item.appendChild(label);
        }
        if (label.innerHTML !== html) label.innerHTML = html;
      });
    }
  }

  // Find the raw mission (it has a numeric riskScore) above the raid info block.
  function missionRiskScore(el) {
    return findProps(el, (p) => {
      if (typeof p.riskScore === "number") return { score: p.riskScore };
      for (const v of Object.values(p)) {
        if (v && typeof v === "object" && !Array.isArray(v) && typeof v.riskScore === "number") {
          return { score: v.riskScore };
        }
      }
      return null;
    }, 25);
  }

  function annotateRiskScore() {
    for (const value of document.querySelectorAll('[data-component-name="ExpeditionsRaidInfoValue"]')) {
      let text = "";
      for (const n of value.childNodes) if (!(n.classList && n.classList.contains(SCORE_CLASS))) text += n.textContent;
      text = text.trim();
      if (!/^(LOW|MODERATE|HIGH)$/i.test(text)) continue;
      const hit = missionRiskScore(value);
      let span = value.querySelector(`:scope > .${SCORE_CLASS}`);
      if (!hit) { if (span) span.remove(); continue; }
      const label = ` (${Math.round(hit.score)})`;
      if (!span) {
        span = document.createElement("span");
        span.className = SCORE_CLASS;
        value.appendChild(span);
      }
      if (span.textContent !== label) span.textContent = label;
    }
  }

  setInterval(() => {
    try { annotateButtons(); annotateRiskScore(); }
    catch (e) { console.warn("[expeditions helper]", e); }
  }, 500);
})();
