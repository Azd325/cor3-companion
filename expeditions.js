// COR3 expeditions helper.
// - Makes the game's hover popup on decision options clear: next to "Risk" and
//   "Rewards" it writes HIGHER / LOWER / SAME (or MORE / LESS) in the right colour
//   (the game colours "risk up" green), and adds a one-line verdict.
// - Adds the exact risk score (0-100) next to LOW / MODERATE / HIGH.
// Reads React props only; never sends anything.
(() => {
  "use strict";

  const SCORE_CLASS = "cor3-exp-score";
  const GREEN = "#5df0a0", RED = "#ff8a70", GREY = "#7f9aa3";

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

  const AMBER = "#ffc966";
  const OPTIONS_SEL = '[data-component-name="ExpeditionsEventButtons"]';
  const WORD_CLASS = "cor3-exp-word", VERDICT_CLASS = "cor3-exp-verdict";
  const MINE = `.${WORD_CLASS}, .${VERDICT_CLASS}, .${SCORE_CLASS}`;

  const RISK_WORD = { up: ["HIGHER", RED], down: ["LOWER", GREEN], no_change: ["SAME", GREY] };
  const LOOT_WORD = { up: ["MORE", GREEN], down: ["LESS", RED], no_change: ["SAME", GREY] };

  // One line that sums up the option.
  function verdict(b) {
    const r = b.riskChange || "no_change", l = b.lootChange || "no_change";
    if (r !== "up" && l !== "down" && (r === "down" || l === "up")) return ["★ No downside", GREEN];
    if (r === "up" && l === "up") return ["Trade-off: more loot, more danger", AMBER];
    if (r === "down" && l === "down") return ["Trade-off: safer, less loot", AMBER];
    if (r === "up") return ["✕ More danger, nothing gained", RED];
    if (l === "down") return ["✕ Less loot, nothing gained", RED];
    return ["No change", GREY];
  }

  // The option (and its data) for an element inside the options list.
  function optionOf(el) {
    const box = el && el.closest && el.closest(OPTIONS_SEL);
    if (!box) return null;
    const buttons = findProps(box, (p) => (Array.isArray(p.buttons) ? p.buttons : null), 5);
    if (!buttons) return null;
    // The game renders one wrapper element per option, in the same order.
    const i = Array.from(box.children).findIndex((c) => c.contains(el));
    return i >= 0 && buttons[i] ? buttons[i] : null;
  }

  // The game's popup is not inside the option, so remember the hovered one.
  let hovered = null;
  document.addEventListener("mouseover", (e) => {
    const b = optionOf(e.target);
    if (b) hovered = b;
  }, true);

  const ownText = (el) => {
    let t = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.nodeValue;
      else if (!(n.matches && n.matches(MINE))) t += ownText(n);
    }
    return t;
  };

  // Text nodes that are exactly "Risk" or "Rewards"/"Loot" (the popup's labels).
  function labelNodes(root) {
    const out = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => /^\s*(risk|rewards?|loot)\s*$/i.test(n.nodeValue) &&
        !(n.parentElement && n.parentElement.closest(MINE))
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    for (let n; (n = walk.nextNode());) out.push(n);
    return out;
  }

  function setWord(textNode, word, color) {
    let span = textNode.nextSibling;
    if (!(span && span.classList && span.classList.contains(WORD_CLASS))) {
      span = document.createElement("span");
      span.className = WORD_CLASS;
      span.style.cssText = "margin-left:.45em;font-weight:700;letter-spacing:.04em;white-space:nowrap";
      textNode.parentNode.insertBefore(span, textNode.nextSibling);
    }
    const text = word ? `${word}` : "";
    if (span.textContent !== text) span.textContent = text;
    if (span.style.color !== color) span.style.color = color || "";
  }

  // Smallest element that holds both the risk and the rewards label.
  function commonParent(a, b) {
    for (let el = a.parentElement; el; el = el.parentElement) if (el.contains(b)) return el;
    return null;
  }

  function annotatePopups() {
    const nodes = labelNodes(document.body);
    const risks = nodes.filter((n) => /risk/i.test(n.nodeValue));
    const loots = nodes.filter((n) => !/risk/i.test(n.nodeValue));
    for (const r of risks) {
      // The popup has a Risk and a Rewards label close together, and no other text.
      let popup = null, loot = null;
      for (const l of loots) {
        const p = commonParent(r, l);
        if (!p) continue;
        let depth = 0;
        for (let el = r.parentElement; el && el !== p; el = el.parentElement) depth++;
        if (depth > 4) continue;
        // Ignore chevrons and other symbols; only the two words may be there.
        if (!/^risk(rewards?|loot)$/i.test(ownText(p).replace(/[^a-z]/gi, ""))) continue;
        popup = p; loot = l; break;
      }
      if (!popup) continue;
      // Inside an option (narrow windows) use that option, else the hovered one.
      const b = optionOf(popup) || hovered;
      const rw = b && RISK_WORD[b.riskChange], lw = b && LOOT_WORD[b.lootChange];
      setWord(r, rw && rw[0], rw && rw[1]);
      setWord(loot, lw && lw[0], lw && lw[1]);
      let v = popup.querySelector(`:scope > .${VERDICT_CLASS}`);
      if (!b) { if (v) v.remove(); continue; }
      const [text, color] = verdict(b);
      if (!v) {
        v = document.createElement("div");
        v.className = VERDICT_CLASS;
        v.style.cssText = "flex-basis:100%;width:100%;margin-top:6px;padding-top:5px;" +
          "border-top:1px solid rgba(127,154,163,.35);font-weight:700;font-size:.9em;white-space:nowrap";
        popup.appendChild(v);
        // A row popup: let the verdict wrap onto its own line.
        if (getComputedStyle(popup).display.includes("flex")) popup.style.flexWrap = "wrap";
      }
      if (v.textContent !== text) v.textContent = text;
      if (v.style.color !== color) v.style.color = color;
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

  // The popup only lives while hovering, so react to DOM changes, not a timer.
  let queued = false;
  const run = () => {
    queued = false;
    try { annotatePopups(); annotateRiskScore(); }
    catch (e) { console.warn("[expeditions helper]", e); }
  };
  new MutationObserver(() => {
    if (!queued) { queued = true; requestAnimationFrame(run); }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(run, 1000);
})();
