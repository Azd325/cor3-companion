// COR3 loadout + market helper.
// - Loadout: on every program, whether it fits next to what's installed and
//   the power it would get; on installed programs, what it takes to reach max
//   power. In the hardware "Change" list, what each part does to your programs.
// - Market: on hardware and software cards, how the item would change your
//   current loadout, with a star on the best upgrade.
// Reads the loadout and market data the game already receives (through the
// websocket hook in shared/socket.js) and React props; it never sends anything.
(() => {
  "use strict";
  const { esc, findProps, load, save: store, saveSoon, check, shape } = window.__cor3;

  // ---------- game model (mirrors the game's loadout code) ----------
  const RES = [
    { key: "cpu_frequency", label: "CPU Freq", unit: "GHz" },
    { key: "cpu_cores", label: "CPU Cores", unit: "" },
    { key: "gpu_power", label: "GPU Power", unit: "PFLOPS" },
    { key: "gpu_memory", label: "GPU Mem", unit: "TB" },
    { key: "ram_frequency", label: "RAM Freq", unit: "GHz" },
    { key: "ram_memory", label: "RAM Mem", unit: "TB" },
  ];
  const PSU = { key: "psu_power", demand: "psu_total", label: "PSU", unit: "kW" };
  // Which hardware spec feeds which resource.
  const HW_SUPPLY = {
    cpu: { cpu_frequency: "cpuFrequency", cpu_cores: "cpuCores" },
    gpu: { gpu_power: "gpuPower", gpu_memory: "gpuMemory" },
    ram: { ram_frequency: "ramFrequency", ram_memory: "ramMemory" },
    psu: { psu_power: "psuPower" },
  };
  const HW_DRAW = { cpu: "cpuConsuming", gpu: "gpuConsuming" };
  const SPEC_SHORT = {
    cpuFrequency: "Freq", cpuCores: "Cores", cpuConsuming: "Draw",
    gpuPower: "Power", gpuMemory: "Mem", gpuConsuming: "Draw",
    ramFrequency: "Freq", ramMemory: "Mem",
    psuPower: "Power", psuProtection: "Prot",
  };
  // For these a higher number is worse.
  const LOWER_IS_BETTER = new Set(["cpuConsuming", "gpuConsuming"]);

  const { GREEN, RED, GREY, CYAN } = window.__cor3.color;
  const YELLOW = "#ffc857";
  const EPS = 1e-9;

  // Requirement arrays are [min, max] or [base, min, max]; same as the game.
  const range = (c) => (c.length === 3
    ? { base: c[0], min: c[1] ?? 0, max: c[2] ?? 0 }
    : { base: null, min: c[0] ?? 0, max: c[c.length - 1] ?? 0 });
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const fmt = (x) => String(parseFloat(num(x).toFixed(2)));
  const signed = (x, f = fmt) => (x > 0 ? "+" : x < 0 ? "−" : "±") + f(Math.abs(x));
  const pw = (x) => String(Math.round(num(x) * 10) / 10); // program power, 1 decimal
  const norm = (s) => String(s ?? "").trim().toLowerCase();

  const abilitiesOf = (sw) => (sw?.specs || [])
    .filter((s) => s && s.type && Array.isArray(s.power) && s.power.length)
    .map((s) => ({ type: s.type, pmin: s.power[0], pmax: s.power[s.power.length - 1] }));

  // Base values of the other installed programs come off the supply for
  // [base, min, max] requirements (program-installed.tsx does the same).
  function fills(sw, supply, equipped) {
    const out = [];
    for (const r of RES) {
      const c = sw?.consuming?.[r.key];
      if (!Array.isArray(c) || !c.length) continue;
      const { min, max } = range(c);
      let avail = num(supply[r.key]);
      if (c.length === 3) {
        for (const q of equipped) {
          if (q === sw || (sw.id != null && q.id === sw.id)) continue;
          const qc = q.consuming?.[r.key];
          if (Array.isArray(qc) && qc.length === 3) avail -= num(qc[0]);
        }
      }
      const span = max - min;
      out.push({ ...r, min, max, avail, fill: span > 0 ? clamp01((avail - min) / span) : 1 });
    }
    return out;
  }

  // Estimated power: the bottleneck resource's fill picks the spot between the
  // ability's min and max. The game computes the real number on the server,
  // so this is an estimate; installed programs use the real number.
  function estimate(sw, supply, equipped) {
    const f = fills(sw, supply, equipped);
    const fill = f.length ? Math.min(...f.map((x) => x.fill)) : 1;
    return {
      fill, fills: f,
      abilities: abilitiesOf(sw).map((a) => ({ ...a, power: a.pmin + (a.pmax - a.pmin) * fill })),
    };
  }

  const minsOf = (sw) => {
    const m = {};
    for (const r of RES) {
      const c = sw?.consuming?.[r.key];
      if (Array.isArray(c) && c.length) m[r.key] = range(c).min;
    }
    return m;
  };

  // ---------- captured data ----------
  const STORE_KEY = "cor3-loadout-helper";
  const state = load(STORE_KEY, { enabled: true, loadout: null });
  const save = () => store(STORE_KEY, state);
  const lots = new Map(); // lowercase item name -> raw market lot
  window.__cor3Loadout = { state, lots };

  function scan(node, depth) {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (node instanceof Uint8Array || node instanceof Date) return;
    if (Array.isArray(node)) { for (const x of node) scan(x, depth + 1); return; }
    const d = node.data;
    const isLoadout = node.event?.name === "loadout" && d && typeof d === "object" && !Array.isArray(d);
    if (isLoadout) check("loadout", "loadout data", !!(d.resources && d.equippedHardware), shape(d));
    if (isLoadout && d.resources && d.equippedHardware) {
      state.loadout = {
        ownedSoftware: d.ownedSoftware || [],
        equippedHardware: d.equippedHardware || {},
        equippedSoftware: d.equippedSoftware || [],
        resources: d.resources,
        at: Date.now(),
      };
      // Kept, so the notes are there as soon as the game opens again.
      saveSoon(STORE_KEY, state);
      changed = true;
      return;
    }
    if (Array.isArray(node.lots)) {
      check("loadout", "market lots", !node.lots.length || node.lots.some((l) => l && l.details && typeof l.details === "object"),
        shape(node.lots[0]));
      if (node.lots.length) changed = true;
      for (const l of node.lots) {
        const name = l?.details?.name ?? l?.offer;
        if (name && l.details) lots.set(norm(name), l);
      }
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === "object") scan(v, depth + 1);
    }
  }
  // Redraw the notes as soon as new data came in.
  let changed = false;
  window.__cor3.onPacket((data) => {
    changed = false;
    scan(data, 0);
    if (changed) tick();
  });

  // ---------- scenarios ----------
  // A scenario is a loadout: supply, demand and the installed programs.
  function current() {
    const L = state.loadout;
    if (!L) return null;
    return {
      supply: { ...L.resources.supply },
      demand: { ...L.resources.demand },
      equipped: L.equippedSoftware,
      hardware: L.equippedHardware,
      actual: L.resources.softwarePower || [],
    };
  }

  function shortages(sc) {
    const out = [];
    for (const r of RES) {
      if (num(sc.demand[r.key]) > num(sc.supply[r.key]) + EPS) {
        out.push({ ...r, need: num(sc.demand[r.key]), have: num(sc.supply[r.key]) });
      }
    }
    if (num(sc.demand[PSU.demand]) > num(sc.supply[PSU.key]) + EPS) {
      out.push({ ...PSU, need: num(sc.demand[PSU.demand]), have: num(sc.supply[PSU.key]) });
    }
    return out;
  }

  const actualPower = (base, sw, type) => base.actual
    .find((p) => p.moduleId === sw.id)?.abilities?.find((a) => a.type === type)?.computedPower;

  // Power of every installed program's abilities in `sc`. For programs that
  // are installed now, the estimated change is added to the real number, so
  // the estimate's error mostly cancels out.
  function powers(sc, base) {
    const out = [];
    for (const sw of sc.equipped) {
      const est = estimate(sw, sc.supply, sc.equipped);
      const wasOn = base.equipped.some((q) => q.id === sw.id);
      const estNow = wasOn ? estimate(sw, base.supply, base.equipped) : null;
      est.abilities.forEach((a, i) => {
        const real = wasOn ? actualPower(base, sw, a.type) : undefined;
        let power = a.power;
        if (real !== undefined) power = Math.max(a.pmin, Math.min(a.pmax, real + a.power - estNow.abilities[i].power));
        out.push({ sw, type: a.type, power, pmax: a.pmax, exact: real !== undefined && Math.abs(power - real) < EPS });
      });
    }
    return out;
  }

  const bestByType = (list) => {
    const m = {};
    for (const p of list) if (!(p.type in m) || p.power > m[p.type]) m[p.type] = p.power;
    return m;
  };

  // Gain of a scenario over the current loadout: change of the best power per
  // ability type (a type you lose counts as minus its power).
  function compare(sc, base) {
    const before = powers(base, base), after = powers(sc, base);
    const b = bestByType(before), a = bestByType(after);
    const types = [...new Set([...Object.keys(b), ...Object.keys(a)])];
    const perType = types.map((t) => ({ type: t, from: b[t], to: a[t] }));
    const gain = perType.reduce((s, x) => s + (num(x.to) - num(x.from)), 0);
    const perProgram = after.map((p) => {
      const was = before.find((q) => q.sw.id === p.sw.id && q.type === p.type);
      return { ...p, from: was?.power };
    });
    return { perType, perProgram, gain, short: shortages(sc) };
  }

  function withSoftware(base, add, remove) {
    const sc = { ...base, supply: { ...base.supply }, demand: { ...base.demand } };
    sc.equipped = base.equipped.filter((q) => q !== remove);
    if (remove) for (const [k, v] of Object.entries(minsOf(remove))) sc.demand[k] = num(sc.demand[k]) - v;
    if (add) {
      sc.equipped = [...sc.equipped, add];
      for (const [k, v] of Object.entries(minsOf(add))) sc.demand[k] = num(sc.demand[k]) + v;
    }
    return sc;
  }

  function withHardware(base, hw) {
    const cat = norm(hw.category);
    const old = base.hardware?.[cat];
    const sc = { ...base, supply: { ...base.supply }, demand: { ...base.demand } };
    for (const [res, key] of Object.entries(HW_SUPPLY[cat] || {})) sc.supply[res] = num(hw.specs?.[key]);
    const draw = HW_DRAW[cat];
    if (draw) sc.demand[PSU.demand] = num(sc.demand[PSU.demand]) - num(old?.specs?.[draw]) + num(hw.specs?.[draw]);
    return { sc, old };
  }

  // Best way to add a program: next to the others, or in place of an
  // installed program that shares an ability type.
  function softwareOptions(base, sw) {
    const opts = [{ replace: null, ...compare(withSoftware(base, sw, null), base) }];
    const types = new Set(abilitiesOf(sw).map((a) => a.type));
    for (const q of base.equipped) {
      if (abilitiesOf(q).some((a) => types.has(a.type))) {
        opts.push({ replace: q, ...compare(withSoftware(base, sw, q), base) });
      }
    }
    const ok = opts.filter((o) => !o.short.length).sort((x, y) => y.gain - x.gain);
    return { best: ok[0] || null, alongside: opts[0] };
  }

  // ---------- rendering helpers ----------
  const span = (color, html, title) => `<span style="color:${color}"${title ? ` title="${esc(title)}"` : ""}>${html}</span>`;
  const swName = (sw) => esc(sw?.name ?? "?");

  function shortHtml(short) {
    return short.map((s) => span(RED, `${s.label} ${fmt(s.need)}/${fmt(s.have)}${s.unit ? " " + s.unit : ""}`)).join(", ");
  }

  function deltaHtml(from, to) {
    if (from === undefined) return span(GREEN, `≈${pw(to)} (new)`);
    if (to === undefined) return span(RED, `${pw(from)} → lost`);
    const d = to - from;
    const color = Math.abs(d) < 0.05 ? GREY : d > 0 ? GREEN : RED;
    return `${pw(from)} → ${span(color, `${pw(to)} (${signed(d, pw)})`)}`;
  }

  // Lines describing a compare() result, limited to what changes.
  function effectLines(res) {
    const lines = [];
    const changed = res.perProgram.filter((p) => p.from === undefined || Math.abs(p.power - p.from) >= 0.05);
    for (const p of changed) {
      lines.push(`${swName(p.sw)} ${esc(p.type)} ${deltaHtml(p.from, p.power)}`);
    }
    for (const t of res.perType) {
      if (t.to === undefined) lines.push(`${esc(t.type)} ${deltaHtml(t.from, undefined)}`);
    }
    return lines;
  }

  const STAR = `<span style="color:${YELLOW}" title="Best upgrade among the cards shown">&#9733;</span> `;

  function placeLabel(anchor, where, cls, html) {
    let el = where === "before"
      ? (anchor.previousElementSibling?.classList.contains(cls) ? anchor.previousElementSibling : null)
      : anchor.querySelector(`:scope > .${cls}`);
    if (!html) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.className = cls;
      el.style.cssText = "font:500 11px/1.35 ui-monospace,Consolas,monospace;color:#cfe7ee;" +
        "padding:5px 7px;margin:6px 0;border-left:2px solid " + CYAN + ";background:rgba(118,193,209,.08);" +
        "border-radius:3px;white-space:normal;word-break:break-word;pointer-events:auto";
      if (where === "before") anchor.parentNode.insertBefore(el, anchor);
      else anchor.appendChild(el);
    }
    window.__cor3.setHTML(el, html);
  }

  // Marks the best entry per group with a star (gain > 0 only).
  function starBest(entries) {
    const best = {};
    for (const e of entries) {
      if (!e.group || !(e.gain > 0.05)) continue;
      const b = best[e.group];
      if (!b || e.gain > b.gain + EPS || (Math.abs(e.gain - b.gain) < EPS && num(e.price) < num(b.price))) best[e.group] = e;
    }
    for (const e of entries) e.star = best[e.group] === e;
  }

  const LABEL = "cor3-lo-label";

  // ---------- software (program card or market lot) ----------
  function softwareResult(base, sw) {
    const installed = base.equipped.some((q) => (sw.id != null && q.id === sw.id) || norm(q.name) === norm(sw.name));
    if (installed) return { installed: true };
    const { best, alongside } = softwareOptions(base, sw);
    const types = abilitiesOf(sw).map((a) => a.type);
    return { best, alongside, gain: best ? best.gain : -Infinity, group: types.join("+") };
  }

  function softwareHtml(r, opts) {
    if (r.installed) return opts.market ? span(GREY, "Installed") : "";
    const lines = [];
    const owned = opts.market && (state.loadout?.ownedSoftware || []).some((q) => norm(q.name) === norm(opts.name));
    if (owned) lines.push(span(GREY, "You own this already"));
    if (!r.best) {
      lines.push(`${span(RED, "&#10007; Won't fit:")} ${shortHtml(r.alongside.short)}`);
      return (r.star ? STAR : "") + lines.join("<br>");
    }
    const b = r.best;
    const head = b.replace
      ? `${span(YELLOW, "&#8644; Fits in place of")} ${swName(b.replace)}`
      : span(GREEN, "&#10003; Fits next to your programs");
    lines.push(head);
    if (b.replace) lines.push(`${span(GREY, "Not next to it:")} ${shortHtml(r.alongside.short)}`);
    // Best power per ability type, only the types that change.
    for (const t of b.perType) {
      if (t.from !== undefined && t.to !== undefined && Math.abs(t.to - t.from) < 0.05) continue;
      lines.push(`${esc(t.type)} best ${deltaHtml(t.from, t.to)}`);
    }
    // Installing it can take resources from programs that are already running.
    const side = b.perProgram.filter((p) => p.from !== undefined && Math.abs(p.power - p.from) >= 0.05);
    if (side.length) lines.push(span(GREY, "Also: ") + side.map((p) => `${swName(p.sw)} ${esc(p.type)} ${deltaHtml(p.from, p.power)}`).join(", "));
    lines.push(span(GREY, "≈ estimate"));
    return (r.star ? STAR : "") + lines.join("<br>");
  }

  // ---------- hardware (loadout change list or market lot) ----------
  function hardwareResult(base, hw) {
    const cat = norm(hw.category);
    if (!HW_SUPPLY[cat]) return null;
    const { sc, old } = withHardware(base, hw);
    if (old && (old.id === hw.id && hw.id != null || norm(old.name) === norm(hw.name))) return { current: true };
    const res = compare(sc, base);
    return { res, old, gain: res.short.length ? -Infinity : res.gain, group: cat, psu: { need: sc.demand[PSU.demand], have: sc.supply[PSU.key] } };
  }

  function hardwareHtml(r, hw, opts) {
    if (!r) return "";
    if (r.current) return opts.market ? span(GREY, "Installed now") : "";
    const lines = [];
    if (opts.market && r.old) {
      // The market card shows specs but not the change against yours.
      const diffs = [];
      for (const [k, v] of Object.entries(hw.specs || {})) {
        if (typeof v !== "number" || !(k in SPEC_SHORT)) continue;
        const d = v - num(r.old.specs?.[k]);
        if (Math.abs(d) < EPS) continue;
        const good = LOWER_IS_BETTER.has(k) ? d < 0 : d > 0;
        diffs.push(`${SPEC_SHORT[k]} ${span(good ? GREEN : RED, signed(d))}`);
      }
      lines.push(`${span(GREY, "vs " + esc(r.old.name) + ":")} ${diffs.length ? diffs.join(", ") : "same specs"}`);
    }
    if (r.res.short.length) {
      lines.push(`${span(RED, "&#10007; Can't boot:")} ${shortHtml(r.res.short)}`);
    } else {
      lines.push(`${span(GREEN, "&#10003; Boots")} ${span(GREY, `(PSU ${fmt(r.psu.need)}/${fmt(r.psu.have)} kW)`)}`);
    }
    const eff = effectLines(r.res);
    if (eff.length && r.res.short.length) lines.push(span(GREY, "Once it can boot:"));
    if (eff.length) lines.push(...eff);
    else if (state.loadout.equippedSoftware.length) lines.push(span(GREY, "No change to your programs' power"));
    return (r.star ? STAR : "") + lines.join("<br>");
  }

  // ---------- installed program: what limits it ----------
  function installedHtml(base, sw) {
    const est = estimate(sw, base.supply, base.equipped);
    const below = est.fills.filter((f) => f.fill < 1 - EPS);
    if (!below.length) return span(GREEN, "&#10003; Running at max power");
    const parts = below
      .sort((a, b) => a.fill - b.fill)
      .map((f, i) => {
        const need = f.max - f.avail;
        return span(i === 0 ? YELLOW : GREY, `${f.label} +${fmt(need)}${f.unit ? " " + f.unit : ""}`);
      });
    return `${span(GREY, "For max power you need:")} ${parts.join(", ")}`;
  }

  // ---------- pages ----------
  function noDataHtml() {
    return span(GREY, "Open your Loadout once so the helper can compare this with your setup.");
  }

  function annotateLoadout(base) {
    // Program cards.
    const entries = [];
    for (const card of document.querySelectorAll('[data-component-name="ProgramItem"]')) {
      const anchor = card.querySelector(':scope > [data-component-name="ProgramInstalled"]') ||
        card.querySelector('[data-component-name="ProgramInstalled"]');
      if (!anchor) continue;
      const p = findProps(card, (q) => (q.software && "isEquipped" in q ? q : null), 4);
      if (!p) continue;
      if (!base) { placeLabel(anchor, "before", LABEL, ""); continue; }
      if (p.isEquipped) { placeLabel(anchor, "before", LABEL, installedHtml(base, p.software)); continue; }
      entries.push({ anchor, sw: p.software, ...softwareResult(base, p.software) });
    }
    starBest(entries);
    for (const e of entries) placeLabel(e.anchor, "before", LABEL, softwareHtml(e, {}));

    // Hardware "Change" list.
    const hwEntries = [];
    for (const card of document.querySelectorAll('[data-component-name="HardwareCard"]')) {
      const p = findProps(card, (q) => (q.hardware?.category && "isCurrent" in q ? q : null), 4);
      if (!p) continue;
      const inner = card.querySelector(":scope > div");
      const anchor = inner?.firstElementChild || card;
      if (!base || p.isCurrent) { placeLabel(anchor, "append", LABEL, ""); continue; }
      const r = hardwareResult(base, p.hardware);
      if (r) hwEntries.push({ anchor, hw: p.hardware, ...r });
    }
    starBest(hwEntries);
    for (const e of hwEntries) placeLabel(e.anchor, "append", LABEL, hardwareHtml(e, e.hw, {}));
  }

  function lotFor(card) {
    const p = findProps(card, (q) => (typeof q.name === "string" && "availableCount" in q ? q : null), 4);
    const name = p?.name ?? card.querySelector('[data-component-name="LotCardTitle"]')?.textContent;
    const lot = lots.get(norm(name));
    return lot ? { lot, price: p?.price ?? lot.price } : null;
  }

  function annotateMarket(base) {
    const hw = [], sw = [];
    for (const card of document.querySelectorAll('[data-component-name="LotCard"]')) {
      const anchor = card.querySelector('[data-component-name="LotCardFooter"]');
      if (!anchor) continue;
      const found = lotFor(card);
      const d = found?.lot.details;
      const isHw = d && "category" in d && d.specs && !Array.isArray(d.specs);
      const isSw = d && d.consuming && Array.isArray(d.specs);
      if (!isHw && !isSw) { placeLabel(anchor, "before", LABEL, ""); continue; }
      if (!base) { placeLabel(anchor, "before", LABEL, noDataHtml()); continue; }
      if (isHw) { const r = hardwareResult(base, d); if (r) hw.push({ anchor, d, price: found.price, ...r }); }
      else sw.push({ anchor, d, price: found.price, ...softwareResult(base, d) });
    }
    starBest(hw);
    starBest(sw);
    for (const e of hw) placeLabel(e.anchor, "before", LABEL, hardwareHtml(e, e.d, { market: true }));
    for (const e of sw) placeLabel(e.anchor, "before", LABEL, softwareHtml(e, { market: true, name: e.d.name }));
  }

  function clearAll() {
    for (const el of document.querySelectorAll(`.${LABEL}`)) el.remove();
  }

  function tick() {
    if (!state.enabled) return;
    const base = current();
    annotateLoadout(base);
    annotateMarket(base);
  }

  // Alt+L or the toolbar menu toggles the helper.
  window.__cor3.helper("loadout", () => state.enabled, (on) => {
    state.enabled = on;
    save();
    if (!state.enabled) clearAll(); else tick();
  });

  // The notes follow the game's page: when cards appear or change.
  window.__cor3.onDom(tick, 250);
})();
