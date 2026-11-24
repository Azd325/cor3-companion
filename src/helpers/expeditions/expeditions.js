// COR3 expeditions helper.
// - On a decision option, adds a line "Risk HIGHER · Rewards MORE" (or LOWER /
//   LESS / SAME) in the right colour (the game colours "risk up" green), and a
//   one-line verdict. The line sits under the choice, not in the game's tooltip.
// - With the expedition data the game sends (read through the websocket hook in
//   shared/socket.js) it adds the exact numbers: Risk HIGHER +8, the mission risk after
//   the choice, and the time left to decide.
// - Adds the exact risk score (0-100) next to LOW / MODERATE / HIGH.
// - Shows death and fail chance on the mercenary cards once the game has priced
//   that mercenary.
// Alt+E or the toolbar menu toggles it. Reads only; never sends anything.
(() => {
  "use strict";

  const SCORE_CLASS = "cor3-exp-score";
  const { findProps, load, save, check, shape, cache, toMs } = window.__cor3;
  const { GREEN, RED, GREY } = window.__cor3.color;

  const AMBER = "#ffc966";
  const OPTIONS_SEL = '[data-component-name="ExpeditionsEventButtons"]';
  const VERDICT_CLASS = "cor3-exp-verdict";
  const MINE = `.${VERDICT_CLASS}, .${SCORE_CLASS}, .cor3-exp-odds`;
  let floatNote = null;

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
  const state = load(STORE_KEY, { enabled: true });
  window.__cor3.helper("expeditions", () => state.enabled, (on) => {
    state.enabled = on;
    save(STORE_KEY, state);
    if (!on) {
      for (const el of document.querySelectorAll(MINE)) el.remove();
      floatNote = null;
    }
    else run();
  });

  // ---------- decisions from the websocket ----------
  // Each decision message carries its options with numeric riskModifier and
  // lootModifier; the expedition carries the mission's riskScore.
  const decisions = new Map(); // message id -> { options, deadline, isResolved, riskScore }
  // Expeditions with their status and end time, for the top bar.
  const expeditions = new Map(); // expedition id -> { status, endTime, opened }
  window.__cor3Expeditions = { decisions, expeditions };
  let dirty = false;

  function keepExpedition(exp) {
    if (exp.id == null || typeof exp.status !== "string" || !("endTime" in exp)) return;
    if (!("riskScore" in exp) && !("mercenary" in exp)) return;
    expeditions.set(String(exp.id), { status: exp.status, endTime: exp.endTime, opened: !!exp.containerOpenedAt });
    dirty = true;
  }

  function keepDecision(msg, exp) {
    if (!msg || msg.id == null || !Array.isArray(msg.decisionOptions)) return;
    if (msg.decisionOptions.length) {
      check("expeditions", "decision options", msg.decisionOptions.some((o) =>
        o && typeof o.riskModifier === "number" && typeof o.lootModifier === "number"), shape(msg.decisionOptions[0]));
    }
    dirty = true;
    const old = decisions.get(String(msg.id)) || {};
    decisions.set(String(msg.id), {
      options: msg.decisionOptions,
      deadline: msg.decisionDeadline ?? old.deadline,
      isResolved: !!msg.isResolved,
      riskScore: typeof exp?.riskScore === "number" ? exp.riskScore : old.riskScore,
    });
  }

  // Mercenary odds: the game's reply when you set up an expedition carries
  // outcomeChances (death and fail-but-survive chance) for that mercenary.
  const odds = new Map(); // mercenary id -> { death, fail, cost, risk }
  let lastOdds = null;
  function keepOdds(node) {
    const oc = node.outcomeChances;
    if (!oc || typeof oc !== "object") return;
    check("expeditions", "mercenary odds", typeof oc.deathChance === "number", shape(oc));
    if (typeof oc.deathChance !== "number") return;
    dirty = true;
    const o = { death: oc.deathChance, fail: typeof oc.failureSurviveChance === "number" ? oc.failureSurviveChance : null,
                cost: typeof node.totalCost === "number" ? node.totalCost : null,
                risk: typeof node.riskScore === "number" ? node.riskScore : null };
    const id = node.mercenaryId ?? node.mercenary?.id ?? null;
    if (id != null) odds.set(String(id), o);
    lastOdds = o;
  }
  window.__cor3Expeditions.odds = odds;

  function scan(node, depth) {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (node instanceof Uint8Array || node instanceof Date) return;
    if (Array.isArray(node)) { for (const x of node) scan(x, depth + 1); return; }
    keepExpedition(node);
    keepOdds(node);
    if (Array.isArray(node.messages)) for (const m of node.messages) keepDecision(m, node);
    else if (Array.isArray(node.decisionOptions)) keepDecision(node, null);
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === "object" && k !== "messages") scan(v, depth + 1);
    }
  }
  // Kept for a day, so the top bar shows an open decision or an expedition
  // on its way back as soon as the game opens again. Decisions past their
  // deadline and expeditions you've opened are left out.
  const DAY = 24 * 3600e3;
  const saved = cache("cor3-cache-expeditions", DAY);
  if (saved.data) {
    for (const [id, e] of saved.data.expeditions || []) if (!expeditions.has(id)) expeditions.set(id, e);
    for (const [id, d] of saved.data.decisions || []) if (!decisions.has(id)) decisions.set(id, d);
    for (const [id, o] of saved.data.odds || []) if (!odds.has(id)) odds.set(id, o);
  }
  function keep() {
    const now = Date.now();
    saved.put({
      expeditions: [...expeditions].filter(([, e]) => !e.opened && !(toMs(e.endTime) < now - DAY)),
      decisions: [...decisions].filter(([, d]) => isOpen(d)),
      odds: [...odds],
    });
  }

  window.__cor3.onPacket((data) => {
    dirty = false;
    scan(data, 0);
    if (!dirty) return;
    keep();
    window.__cor3.emit("expeditions");
    run();
  });

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

  // The choice tooltip is position:absolute above the button, inside the
  // events panel (overflow:hidden). Extra height there is clipped at the top
  // and lands on the button. The note is our own node under the choice.
  // A narrow window inlines the same two rows in the button item; the note
  // follows the button, still outside that button.
  const TIP_SEL = '[data-component-name="ExpeditionsEventButtonTooltip"]';
  const ITEM_SEL = '[data-component-name="ExpeditionsEventButtonItem"]';
  const ROW_SEL = '[data-component-name="ExpeditionsEventButtonTooltipItem"]';
  let hovered = null; // the choice wrapper under the pointer
  document.addEventListener("mouseover", (e) => {
    const t = e.target;
    if (!(t && t.closest)) return;
    if (t.closest(`.${VERDICT_CLASS}`)) return;
    const box = t.closest(OPTIONS_SEL);
    const next = box && optionOf(t) ? [...box.children].find((c) => c.contains(t)) || null : null;
    if (next === hovered) return;
    hovered = next;
    run();
  }, true);
  document.addEventListener("scroll", () => { if (hovered) run(); }, true);

  // Risk row, then rewards row. The game translates the words; the order does not change.
  function modifierRows(root) {
    const box = root.querySelector('[data-component-name="ExpeditionsEventButtonModifiers"]');
    return [...(box || root).children].filter((el) => el.matches && el.matches(ROW_SEL));
  }

  const NOTE_CSS = "box-sizing:border-box;max-width:280px;padding:6px 8px 8px;" +
    "border:1px solid rgba(127,154,163,.35);border-radius:8px;background:#0b1015;" +
    "color:#c5d5db;font-weight:700;font-size:.9em;line-height:1.35;white-space:normal;overflow-wrap:break-word";

  // "Risk HIGHER +8 · Rewards MORE +3", coloured, on its own line. Kept out of
  // the game's label row: written in there it overlapped the labels.
  function setWords(line, b) {
    const withNum = (w, n) => `${w[0]}${typeof n === "number" && n !== 0 ? ` ${num(n)}` : ""}`;
    const parts = [["Risk", RISK_WORD[b.riskChange], b.risk], ["Rewards", LOOT_WORD[b.lootChange], b.loot]]
      .filter(([, w]) => w);
    const key = JSON.stringify(parts.map(([l, w, n]) => [l, withNum(w, n)]));
    if (line.dataset.key === key) return;
    line.dataset.key = key;
    line.textContent = "";
    parts.forEach(([label, w, n], i) => {
      if (i) line.append(" \u00b7 ");
      const word = document.createElement("span");
      word.style.cssText = `color:${w[1]};font-weight:700`;
      word.textContent = withNum(w, n);
      line.append(`${label} `, word);
    });
    line.style.display = parts.length ? "" : "none";
  }

  function fillNote(v, b) {
    let [words, head, sub] = v.children;
    if (!sub) {
      v.textContent = "";
      words = document.createElement("div");
      words.style.cssText = "font-weight:400;margin-bottom:2px";
      head = document.createElement("div");
      sub = document.createElement("div");
      sub.style.cssText = `font-weight:400;color:${GREY};margin-top:2px;white-space:pre-line`;
      v.append(words, head, sub);
    }
    const [text, color] = verdict(b);
    setWords(words, b);
    if (head.textContent !== text) head.textContent = text;
    if (head.style.color !== color) head.style.color = color;
    const more = detail(b);
    if (sub.textContent !== more) sub.textContent = more;
    sub.style.display = more ? "" : "none";
  }

  function noteIn(parent) {
    let v = parent.querySelector(`:scope > .${VERDICT_CLASS}`);
    if (!v) {
      v = document.createElement("div");
      v.className = VERDICT_CLASS;
      v.style.cssText = NOTE_CSS + ";width:100%";
      parent.appendChild(v);
    }
    return v;
  }

  function noteOutside() {
    if (floatNote && floatNote.isConnected) return floatNote;
    floatNote = document.createElement("div");
    floatNote.className = VERDICT_CLASS;
    // Clicks pass through, so the note cannot cover a choice button.
    floatNote.style.cssText = NOTE_CSS + ";position:fixed;z-index:40;margin:0;pointer-events:none";
    document.body.appendChild(floatNote);
    return floatNote;
  }

  function placeUnder(anchor, note) {
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const width = note.offsetWidth;
    const height = note.offsetHeight;
    const clampLeft = (x) => Math.max(margin, Math.min(x, window.innerWidth - margin - width));
    const siblings = [...(anchor.parentElement ? anchor.parentElement.children : [])]
      .filter((el) => el !== anchor)
      .map((el) => el.getBoundingClientRect());
    const candidates = [
      { left: clampLeft(rect.left), top: rect.bottom },
      { left: clampLeft(rect.left), top: rect.top - height },
      { left: rect.right, top: rect.top },
      { left: rect.left - width, top: rect.top },
    ];
    const fits = (c) =>
      c.left >= 0 && c.top >= 0 && c.left + width <= window.innerWidth && c.top + height <= window.innerHeight &&
      !siblings.some((s) => c.left < s.right && c.left + width > s.left && c.top < s.bottom && c.top + height > s.top);
    const spot = candidates.find(fits) || candidates[0];
    note.style.left = `${Math.round(spot.left)}px`;
    note.style.top = `${Math.round(spot.top)}px`;
  }

  function annotatePopups() {
    const kept = new Set();
    for (const item of document.querySelectorAll(ITEM_SEL)) {
      const stale = item.querySelector(`:scope > .${VERDICT_CLASS}`);
      if (modifierRows(item).length < 2) { if (stale) stale.remove(); continue; }
      const b = optionOf(item);
      if (!b) { if (stale) stale.remove(); continue; }
      const note = noteIn(item);
      fillNote(note, b);
      kept.add(note);
    }
    const anchor = hovered && hovered.isConnected ? hovered : null;
    const tip = anchor && [...anchor.querySelectorAll(TIP_SEL)].find((t) => !t.closest(ITEM_SEL) && modifierRows(t).length >= 2);
    const wide = tip && optionOf(anchor);
    if (wide) {
      const note = noteOutside();
      fillNote(note, wide);
      placeUnder(anchor, note);
      kept.add(note);
    }
    for (const n of document.querySelectorAll(`.${VERDICT_CLASS}`)) if (!kept.has(n)) n.remove();
    if (floatNote && !floatNote.isConnected) floatNote = null;
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
      // In the setup, add the odds for the mercenary the game just priced.
      const o = lastOdds && lastOdds.risk != null && Math.round(lastOdds.risk) === Math.round(hit.score) ? lastOdds : null;
      const label = ` (${Math.round(hit.score)})${o ? ` \u00b7 death ${pct(o.death)}` : ""}`;
      if (!span) {
        span = document.createElement("span");
        span.className = SCORE_CLASS;
        value.appendChild(span);
      }
      if (span.textContent !== label) span.textContent = label;
    }
  }

  // Odds on the game's mercenary cards.
  const ODDS_CLASS = "cor3-exp-odds";
  const pct = (n) => `${Math.round(n * 10) / 10}%`;
  function mercOf(el) {
    return findProps(el, (p) => {
      const m = p.mercenary && typeof p.mercenary === "object" ? p.mercenary : p;
      return m && m.id != null && typeof m.callsign === "string" ? m : null;
    }, 6);
  }
  function annotateMercs() {
    if (!odds.size) return;
    const cards = new Map(); // merc id -> outermost element
    for (const el of document.querySelectorAll('[data-component-name*="ercenar"]')) {
      if (el.closest(`.${ODDS_CLASS}`)) continue;
      const m = mercOf(el);
      if (!m || !odds.has(String(m.id))) continue;
      const had = cards.get(String(m.id));
      if (!had || el.contains(had)) cards.set(String(m.id), el);
    }
    for (const [id, el] of cards) {
      const o = odds.get(id);
      const text = `Death ${pct(o.death)}${o.fail != null ? ` \u00b7 Fail, survives ${pct(o.fail)}` : ""}`;
      let line = el.querySelector(`:scope > .${ODDS_CLASS}`);
      if (!line) {
        line = document.createElement("div");
        line.className = ODDS_CLASS;
        line.style.cssText = "font-size:11px;font-weight:700;margin-top:4px";
        el.appendChild(line);
      }
      if (line.textContent !== text) line.textContent = text;
      line.style.color = o.death >= 10 ? RED : AMBER;
      line.title = "chance this mercenary dies, or fails and comes back";
    }
  }

  // The popup only lives while hovering, so react to page changes, not a timer.
  function run() {
    if (!state.enabled) return;
    try { annotatePopups(); annotateRiskScore(); annotateMercs(); }
    catch (e) { console.warn("[expeditions helper]", e); }
  }
  window.__cor3.onDom(run);
  // The time left to decide counts down.
  window.__cor3.every(1000, run, "expeditions helper");
})();
