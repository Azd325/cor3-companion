// COR3 protocol solver (the cleaner-bot / config hack minigame).
// The game hides one combination of four fields (Version, Method, Channel,
// Cipher) and after each attempt says how many fields are wrong. This helper
// reads the minigame's log and shows the best next move inside the window,
// with the fields you still have to change outlined. You set them yourself:
// it never presses a key or sends anything. Alt+P or the menus toggle it.
(() => {
  "use strict";
  const { load, save, color } = window.__cor3;

  const NOTE_CLASS = "cor3-proto-note", MARK_ATTR = "data-cor3-proto";
  const STORE_KEY = "cor3-protocol-helper";
  const state = load(STORE_KEY, { enabled: true });

  // ---------- solver ----------
  // Candidates are indices into `combos`; a combo is one option index per field.
  // The move picked is the one that wins the most remaining targets within the
  // attempts left (not the one with the fewest guesses in the worst case, which
  // loses more 4-attempt rounds).
  function makeSolver(sizes) {
    const combos = sizes.reduce((acc, n) => acc.flatMap((c) => Array.from({ length: n }, (_, v) => [...c, v])), [[]]);
    const N = combos.length, F = sizes.length;
    const dist = new Uint8Array(N * N);
    for (let a = 0; a < N; a++) {
      for (let b = a; b < N; b++) {
        let d = 0;
        for (let f = 0; f < F; f++) if (combos[a][f] !== combos[b][f]) d++;
        dist[a * N + b] = dist[b * N + a] = d;
      }
    }
    const memo = new Map();

    const split = (cands, g) => {
      const groups = Array.from({ length: F + 1 }, () => []);
      for (const c of cands) groups[dist[g * N + c]].push(c);
      return groups;
    };
    const score = (cands, g, tries) => {
      const groups = split(cands, g);
      let wins = groups[0].length;
      for (let d = 1; d <= F; d++) if (groups[d].length) wins += solvable(groups[d], tries - 1);
      return wins;
    };
    // How many of `cands` can surely be hit within `tries` attempts.
    function solvable(cands, tries) {
      if (tries <= 0 || !cands.length) return 0;
      if (tries === 1 || cands.length === 1) return 1;
      const key = tries + ":" + cands.join(",");
      let best = memo.get(key);
      if (best !== undefined) return best;
      best = 0;
      for (let g = 0; g < N && best < cands.length; g++) best = Math.max(best, score(cands, g, tries));
      memo.set(key, best);
      return best;
    }
    // Plan with the fewest attempts that still win everything, so spare
    // attempts never make a win slower.
    function bestMove(cands, triesLeft) {
      if (triesLeft <= 0 || !cands.length) return null;
      if (triesLeft === 1 || cands.length === 1) return { guess: cands[0], wins: 1 };
      let tries = triesLeft;
      for (let t = 1; t < triesLeft; t++) if (solvable(cands, t) === cands.length) { tries = t; break; }
      const possible = new Set(cands);
      let best = null;
      for (let g = 0; g < N; g++) {
        const wins = score(cands, g, tries);
        if (!best || wins > best.wins || (wins === best.wins && possible.has(g) && !possible.has(best.guess))) best = { guess: g, wins };
      }
      return best;
    }
    const all = combos.map((_, i) => i);
    function solve(history, limit) {
      let cands = all;
      for (const { guess, mismatched } of history) cands = cands.filter((c) => dist[guess * N + c] === mismatched);
      const left = limit - history.length;
      // Every opening move is alike (the fields are symmetric), so the first
      // move is fixed; on the usual 3x3x3x3 board its win count is known.
      if (!history.length && left >= 1) {
        const std = sizes.length === 4 && sizes.every((n) => n === 3);
        const wins = left >= 5 ? N : std && left === 4 ? 55 : null;
        if (wins != null) return { cands, left, move: { guess: 0, wins } };
      }
      return { cands, left, move: bestMove(cands, left) };
    }
    return { combos, solve };
  }

  let solver = null; // rebuilt only if the game changes the fields
  function solverFor(fields) {
    const key = fields.map((f) => f.join("|")).join("||");
    if (!solver || solver.key !== key) solver = { key, ...makeSolver(fields.map((f) => f.length)) };
    return solver;
  }

  // ---------- reading the minigame ----------
  const q = (root, name) => root.querySelector(`[data-sentry-component="${name}"], [data-component-name="${name}"]`);
  const findWindow = () => q(document, "ConfigHackApplication");
  const logOf = (win) => win.querySelector('[data-sentry-element="LogContentStyled"]');

  // Log lines: "→ v1.0 / v1.1 / v2.0" per field, "Attempts: …", and per attempt
  // "Input: v1.0 GET LTE AES" / "Result:" / "Mismatched 2".
  function readLog(log) {
    // Only innermost divs, so a wrapper's text never counts an attempt twice.
    const lines = [...log.querySelectorAll("div")].filter((d) => !d.querySelector("div"))
      .map((d) => d.textContent.trim()).filter(Boolean);
    const fields = [], history = [];
    let limit = null;
    for (const line of lines) {
      const inp = line.match(/^Input:\s*(.+?)\s*Result:\s*Mismatched\s*(\d+)/is);
      if (inp) { history.push({ values: inp[1].trim().split(/\s+/), mismatched: Number(inp[2]) }); continue; }
      const opt = line.match(/→\s*(.+)/);
      if (opt) {
        const f = opt[1].split("/").map((s) => s.trim()).filter(Boolean);
        if (f.length > 1) fields.push(f);
        continue;
      }
      // "Attempts: 4" (or "2/4"): the first one, before any attempt, is the round's total.
      const att = line.match(/^Attempts:\s*(\d+)(?:\s*\/\s*(\d+))?/i);
      if (att && limit == null) limit = Number(att[2] || att[1]) + (att[2] ? 0 : history.length);
    }
    return { fields, history, limit };
  }

  // The four field buttons and the value each shows now.
  function fieldButtons(win) {
    const cells = q(win, "ParameterCells");
    if (!cells) return [];
    return [...cells.querySelectorAll('button[type="button"]')]
      .filter((b) => b.getAttribute("data-sentry-element") !== "SendButtonStyled")
      .map((b) => { const s = b.querySelectorAll("span"); return { el: b, value: s.length >= 2 ? s[1].textContent.trim() : null }; });
  }

  // ---------- drawing ----------
  function clear() {
    for (const el of document.querySelectorAll(`.${NOTE_CLASS}`)) el.remove();
    for (const el of document.querySelectorAll(`[${MARK_ATTR}]`)) { el.style.outline = ""; el.style.outlineOffset = ""; el.removeAttribute(MARK_ATTR); }
  }

  function noteIn(win) {
    let note = win.querySelector(`.${NOTE_CLASS}`);
    if (!note) {
      note = document.createElement("div");
      note.className = NOTE_CLASS;
      note.style.cssText = "font:inherit;font-size:12px;letter-spacing:.04em;padding:6px 10px;margin:6px 0;" +
        `border:1px solid ${color.CYAN}55;color:${color.TEXT};background:rgba(0,0,0,.35);pointer-events:none`;
      const cells = q(win, "ParameterCells");
      (cells && cells.parentElement ? cells.parentElement : win).insertBefore(note, cells || null);
    }
    return note;
  }

  let lastKey = "", lastLog = "";
  function tick() {
    const win = findWindow();
    if (!state.enabled || !win) { if (lastKey) { clear(); lastKey = ""; } return; }
    const log = logOf(win);
    if (!log) return;
    const buttons = fieldButtons(win);
    const text = log.textContent;
    const key = text + "|" + buttons.map((b) => b.value).join(" ");
    if (key === lastKey) return;
    lastKey = key;

    const { fields, history, limit } = readLog(log);
    if (fields.length < 2) return;
    const s = solverFor(fields);
    const hist = [];
    for (const h of history) {
      const idx = h.values.map((v, f) => (fields[f] ? fields[f].indexOf(v) : -1));
      if (idx.length !== fields.length || idx.includes(-1)) continue;
      hist.push({ guess: s.combos.findIndex((c) => c.every((v, f) => v === idx[f])), mismatched: h.mismatched });
    }
    const total = limit || 6;
    const res = s.solve(hist, Math.max(total, hist.length));
    if (text !== lastLog) {
      lastLog = text;
      console.info("[COR3 protocol]", { fields, attempts: history, limit, possible: res.cands.length });
    }
    draw(win, buttons, fields, s, res, hist);
  }

  function draw(win, buttons, fields, s, res, hist) {
    for (const el of win.querySelectorAll(`[${MARK_ATTR}]`)) { el.style.outline = ""; el.style.outlineOffset = ""; el.removeAttribute(MARK_ATTR); }
    const note = noteIn(win);
    const solved = hist.length && hist[hist.length - 1].mismatched === 0;
    if (solved) { note.remove(); return; }
    if (!res.cands.length) {
      note.innerHTML = `<span style="color:${color.RED}">No combination fits these results.</span>`;
      return;
    }
    if (!res.move) { note.remove(); return; }
    const target = s.combos[res.move.guess].map((v, f) => fields[f][v]);
    const sure = res.cands.length === 1;
    const odds = !sure && res.move.wins < res.cands.length
      ? ` · <span style="color:${color.GREY}">wins ${res.move.wins} of ${res.cands.length}</span>` : "";
    note.innerHTML = `<span style="color:${sure ? color.GREEN : color.CYAN}">${sure ? "ANSWER" : "NEXT"}</span> ` +
      `<b>${target.map(window.__cor3.esc).join(" · ")}</b>` +
      (sure ? "" : ` · <span style="color:${color.GREY}">${res.cands.length} possible</span>`) + odds;
    buttons.forEach((b, f) => {
      if (f < target.length && b.value != null && b.value !== target[f]) {
        b.el.setAttribute(MARK_ATTR, "");
        b.el.style.outline = `2px solid ${sure ? color.GREEN : color.CYAN}`;
        b.el.style.outlineOffset = "-2px";
      }
    });
  }

  // ---------- on/off ----------
  window.__cor3.helper("protocol", () => state.enabled, (on) => {
    state.enabled = on;
    save(STORE_KEY, state);
    lastKey = "";
    if (!on) clear(); else tick();
  });
  window.__cor3Protocol = { makeSolver, readLog };

  setInterval(() => { try { tick(); } catch (e) { console.warn("[COR3 protocol]", e); } }, 250);
})();
