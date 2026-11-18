// COR3 expeditions helper.
// - Makes the game's hover popup on decision options clear: next to "Risk" and
//   "Rewards" it writes HIGHER / LOWER / SAME (or MORE / LESS) in the right colour
//   (the game colours "risk up" green), and adds a one-line verdict.
// - With the expedition data the game sends (read through the websocket hook in
//   jobs.js) it adds the exact numbers: Risk HIGHER +8, the mission risk after
//   the choice, and the time left to decide.
// - Adds the exact risk score (0-100) next to LOW / MODERATE / HIGH.
// Alt+E or the toolbar menu toggles it. Reads only; never sends anything.
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
    const exact = typeof b.risk === "number" && typeof b.loot === "number";
    if (r !== "up" && l !== "down" && (r === "down" || l === "up")) return ["★ No downside", GREEN];
    if (r === "up" && l === "up") {
      return [exact ? `Trade-off: ${num(b.loot)} loot for ${num(b.risk)} risk` : "Trade-off: more loot, more danger", AMBER];
    }
    if (r === "down" && l === "down") {
      return [exact ? `Trade-off: ${num(b.risk)} risk for ${num(b.loot)} loot` : "Trade-off: safer, less loot", AMBER];
    }
    if (r === "up") return ["✕ More danger, nothing gained", RED];
    if (l === "down") return ["✕ Less loot, nothing gained", RED];
    return ["No change", GREY];
  }

  // ---------- on/off ----------
  const STORE_KEY = "cor3-expeditions-helper";
  const state = { enabled: true };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (_) {}
  function setEnabled(on) {
    state.enabled = on;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
    if (!on) for (const el of document.querySelectorAll(MINE)) el.remove();
    else run();
  }
  (window.__cor3Toggles = window.__cor3Toggles || {}).expeditions = { get: () => state.enabled, set: setEnabled };
  window.addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      setEnabled(!state.enabled);
    }
  });

  // ---------- decisions from the websocket ----------
  // Each decision message carries its options with numeric riskModifier and
  // lootModifier; the expedition carries the mission's riskScore.
  const decisions = new Map(); // message id -> { options, deadline, isResolved, riskScore }
  window.__cor3Expeditions = { decisions };

  function keepDecision(msg, exp) {
    if (!msg || msg.id == null || !Array.isArray(msg.decisionOptions)) return;
    const old = decisions.get(String(msg.id)) || {};
    decisions.set(String(msg.id), {
      options: msg.decisionOptions,
      deadline: msg.decisionDeadline ?? old.deadline,
      isResolved: !!msg.isResolved,
      riskScore: typeof exp?.riskScore === "number" ? exp.riskScore : old.riskScore,
    });
  }

  function scan(node, depth) {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (node instanceof Uint8Array || node instanceof Date) return;
    if (Array.isArray(node)) { for (const x of node) scan(x, depth + 1); return; }
    if (Array.isArray(node.messages)) for (const m of node.messages) keepDecision(m, node);
    else if (Array.isArray(node.decisionOptions)) keepDecision(node, null);
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === "object" && k !== "messages") scan(v, depth + 1);
    }
  }
  (window.__cor3PacketListeners = window.__cor3PacketListeners || []).push(scan);

  const normText = (x) => String(x ?? "").trim().toLowerCase();
  const isOpen = (d) => !d.isResolved && !(Date.parse(d.deadline) < Date.now());

  // The websocket option behind the i-th button: by id, then by label, then by
  // position when exactly one open decision has that many options.
  function dataFor(buttons, i) {
    const b = buttons[i];
    const all = [...decisions.values()].sort((x, y) => isOpen(y) - isOpen(x));
    if (b.id != null) {
      for (const d of all) { const o = d.options.find((q) => q.id === b.id); if (o) return { opt: o, dec: d }; }
    }
    const label = normText(b.label ?? b.text ?? b.title ?? b.content);
    if (label) {
      for (const d of all) { const o = d.options.find((q) => normText(q.label) === label); if (o) return { opt: o, dec: d }; }
    }
    const fits = all.filter((d) => isOpen(d) && d.options.length === buttons.length);
    return fits.length === 1 ? { opt: fits[0].options[i], dec: fits[0] } : null;
  }

  // Use the numbers only when they agree with the game's arrows.
  const agrees = (change, n) => typeof n === "number" &&
    ((change || "no_change") === "up" ? n > 0 : change === "down" ? n < 0 : n === 0);

  // The option (and its data) for an element inside the options list.
  function optionOf(el) {
    const box = el && el.closest && el.closest(OPTIONS_SEL);
    if (!box) return null;
    const buttons = findProps(box, (p) => (Array.isArray(p.buttons) ? p.buttons : null), 5);
    if (!buttons) return null;
    // The game renders one wrapper element per option, in the same order.
    const i = Array.from(box.children).findIndex((c) => c.contains(el));
    if (!(i >= 0 && buttons[i])) return null;
    const b = buttons[i];
    const found = dataFor(buttons, i);
    const ok = found && found.opt && agrees(b.riskChange, found.opt.riskModifier) && agrees(b.lootChange, found.opt.lootModifier);
    return { ...b, risk: ok ? found.opt.riskModifier : null, loot: ok ? found.opt.lootModifier : null, dec: found ? found.dec : null };
  }

  const band = (x) => (x <= 33 ? "LOW" : x <= 66 ? "MODERATE" : "HIGH");
  const num = (n) => (n > 0 ? `+${n}` : n < 0 ? `\u2212${-n}` : "\u00b10");
  function timeLeft(v) {
    const ms = Date.parse(v instanceof Date ? v.toISOString() : v) - Date.now();
    if (!(ms > 0)) return null;
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : m ? `${m}m` : "<1m";
  }

  // Lines under the verdict: mission risk after the choice, time to decide.
  function detail(b) {
    const parts = [];
    const score = b.dec && b.dec.riskScore;
    if (typeof b.risk === "number" && typeof score === "number") {
      const to = Math.max(0, Math.min(100, Math.round(score + b.risk)));
      const from = Math.round(score);
      parts.push(`Mission risk ${from} \u2192 ${to}${band(to) !== band(from) ? ` (now ${band(to)})` : ""}`);
    }
    const left = b.dec && !b.dec.isResolved && timeLeft(b.dec.deadline);
    if (left) parts.push(`${left} to decide`);
    return parts.join("\n");
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
      const withNum = (w, n) => w && (typeof n === "number" && n !== 0 ? `${w[0]} ${num(n)}` : w[0]);
      setWord(r, withNum(rw, b && b.risk), rw && rw[1]);
      setWord(loot, withNum(lw, b && b.loot), lw && lw[1]);
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
      let head = v.firstElementChild, sub = head && head.nextElementSibling;
      if (!head) {
        head = document.createElement("div");
        sub = document.createElement("div");
        sub.style.cssText = `font-weight:400;color:${GREY};margin-top:2px;white-space:pre`;
        v.append(head, sub);
      }
      if (head.textContent !== text) head.textContent = text;
      if (head.style.color !== color) head.style.color = color;
      const more = detail(b);
      if (sub.textContent !== more) sub.textContent = more;
      sub.style.display = more ? "" : "none";
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
  function run() {
    queued = false;
    if (!state.enabled) return;
    try { annotatePopups(); annotateRiskScore(); }
    catch (e) { console.warn("[expeditions helper]", e); }
  };
  new MutationObserver(() => {
    if (!queued) { queued = true; requestAnimationFrame(run); }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(run, 1000);
})();
