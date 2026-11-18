// COR3 ICE WALL Break helper.
// Runs in the page's own JS world so it can read the React props of the board.
// It never sends anything to the game server; it only draws an overlay.
(() => {
  "use strict";

  // Geometry constants copied from the game's wall-board code.
  const W = 63, F = 54, T = 31.5;
  const NS = "http://www.w3.org/2000/svg";
  const OVERLAY_ID = "iwb-helper-overlay";
  let enabled = true;

  function triPoints(cell, gridHeight) {
    const a = 2 * cell.row + 1;
    const s = 2 * gridHeight - 1;
    const l = (s - a) * T / 2 + cell.col * T;
    const r = cell.row * F;
    return cell.orientation === "up"
      ? `${l + 31.5},${r} ${l},${r + F} ${l + W},${r + F}`
      : `${l},${r} ${l + W},${r} ${l + 31.5},${r + F}`;
  }

  // Walk up the React fiber tree from the board <svg> to the WallBoard props.
  function getBoardProps(svg) {
    const key = Object.keys(svg).find((k) => k.startsWith("__reactFiber$"));
    let fiber = key && svg[key];
    for (let i = 0; fiber && i < 30; i++, fiber = fiber.return) {
      const p = fiber.memoizedProps;
      if (p && p.state && p.state.boardCells && p.state.targetPattern) return p;
    }
    return null;
  }

  // Same anchor rule the game uses: bottom row, prefer "up" cells, closest to centre.
  function pickAnchor(pattern) {
    const maxRow = Math.max(...pattern.map((c) => c.row));
    const bottom = pattern.filter((c) => c.row === maxRow).sort((a, b) => a.col - b.col);
    const ups = bottom.filter((c) => c.orientation === "up");
    const pool = ups.length ? ups : bottom;
    const mid = pool.reduce((s, c) => s + c.col, 0) / pool.length;
    return [...pool].sort((a, b) => Math.abs(a.col - mid) - Math.abs(b.col - mid))[0];
  }

  function solve(props) {
    const st = props.state;
    const cells = Array.from(st.boardCells);
    const pattern = Array.from(st.targetPattern);
    const glyphs = Array.from(st.targetGlyphs || []);
    const failed = props.failedPlacementKeys || new Set();
    if (!pattern.length) return null;

    const byPos = new Map();
    for (const c of cells) byPos.set(`${c.row}:${c.col}:${c.orientation}`, c);

    // If the server also sends glyphs for hidden cells, we can see the full answer.
    const leaked = cells.some((c) => !c.isRevealed && c.glyph);
    const anchor = pickAnchor(pattern);
    const results = [];

    for (const a of cells) {
      if (a.orientation !== anchor.orientation) continue;
      const placed = [];
      let ok = true, known = 0;
      for (let i = 0; i < pattern.length; i++) {
        const t = pattern[i];
        const dr = t.row - anchor.row;
        const b = byPos.get(`${a.row + dr}:${a.col + (t.col - anchor.col) + dr}:${t.orientation}`);
        if (!b) { ok = false; break; }
        const visible = b.isRevealed || (leaked && b.glyph);
        if (visible) {
          if (b.glyph !== glyphs[i]) { ok = false; break; }
          known++;
        }
        placed.push(b);
      }
      if (!ok) continue;
      const ids = placed.map((c) => c.id);
      if (failed.has([...ids].sort().join("|"))) continue;
      results.push({ cells: placed, known });
    }
    results.sort((x, y) => y.known - x.known);
    return { results, total: pattern.length, leaked, gridHeight: st.gridHeight };
  }

  function draw(svg, sol) {
    let g = svg.querySelector(`#${OVERLAY_ID}`);
    if (!g) {
      g = document.createElementNS(NS, "g");
      g.id = OVERLAY_ID;
      g.setAttribute("transform", "translate(12,12)");
      g.setAttribute("pointer-events", "none");
      svg.appendChild(g);
    }
    g.textContent = "";
    if (!enabled || !sol || !sol.results.length) return;

    const best = sol.results[0].known;
    const top = sol.results.filter((r) => r.known === best);
    const sure = top.length === 1 && (best === sol.total || sol.results.length === 1);

    // Show at most 6 equally good candidates so the board doesn't turn into noise.
    top.slice(0, 6).forEach((r, idx) => {
      for (const c of r.cells) {
        const p = document.createElementNS(NS, "polygon");
        p.setAttribute("points", triPoints(c, sol.gridHeight));
        p.setAttribute("fill", sure ? "rgba(0,255,120,0.25)" : "rgba(255,200,0,0.12)");
        p.setAttribute("stroke", sure ? "#00ff78" : idx === 0 ? "#ffc800" : "rgba(255,200,0,0.5)");
        p.setAttribute("stroke-width", sure ? "4" : "2.5");
        g.appendChild(p);
      }
    });

    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", "0");
    label.setAttribute("y", "20");
    label.setAttribute("fill", sure ? "#00ff78" : "#ffc800");
    label.setAttribute("font-size", "22");
    label.setAttribute("font-family", "monospace");
    label.textContent = sure
      ? `MATCH${sol.leaked ? " (full board)" : ""}`
      : `${sol.results.length} possible · best ${best}/${sol.total} known`;
    g.appendChild(label);
  }

  function tick() {
    const svg = document.querySelector('svg[data-component-name="WallBoard"]');
    if (!svg) return;
    try {
      const props = getBoardProps(svg);
      draw(svg, props && solve(props));
    } catch (e) {
      console.warn("[ICE WALL helper]", e);
    }
  }

  // Alt+H or the toolbar menu toggles the overlay.
  const setEnabled = (on) => { enabled = on; tick(); };
  (window.__cor3Toggles = window.__cor3Toggles || {}).icewall = { get: () => enabled, set: setEnabled };
  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "h") setEnabled(!enabled);
  });

  setInterval(tick, 250);
})();
