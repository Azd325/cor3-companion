// COR3 job tracker.
// Listens (read-only) to the game's websocket, picks out taken jobs and the
// network-map server list, and shows them in a small floating panel.
// It never sends anything to the game server.
(() => {
  "use strict";

  // ---------- msgpack decoder (socket.io-msgpack-parser / notepack format) ----------
  function decodeMsgpack(buf) {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const td = new TextDecoder();
    let off = 0;
    const str = (n) => { const s = td.decode(bytes.subarray(off, off + n)); off += n; return s; };
    const bin = (n) => { const b = bytes.slice(off, off + n); off += n; return b; };
    const arr = (n) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = read(); return a; };
    const map = (n) => { const o = {}; for (let i = 0; i < n; i++) { const k = read(); o[k] = read(); } return o; };
    // Extension types as notepack.io writes them: undefined, dates, timestamps.
    const ext = (n) => {
      const type = view.getInt8(off); off++;
      let d;
      if (type === 0 && n === 1) { off += 1; return undefined; }
      if (type === 0 && n === 8) { d = new Date(view.getInt32(off) * 2 ** 32 + view.getUint32(off + 4)); off += 8; return d; }
      if (type === -1 && n === 4) { d = new Date(view.getUint32(off) * 1e3); off += 4; return d; }
      if (type === -1 && n === 8) {
        const hi = view.getUint32(off), lo = view.getUint32(off + 4); off += 8;
        return new Date(((hi & 3) * 2 ** 32 + lo) * 1e3 + (hi >>> 2) / 1e6);
      }
      if (type === -1 && n === 12) {
        const ns = view.getUint32(off), s = Number(view.getBigInt64(off + 4)); off += 12;
        return new Date(s * 1e3 + ns / 1e6);
      }
      return bin(n);
    };
    function read() {
      const b = bytes[off++];
      if (b < 0x80) return b;
      if (b < 0x90) return map(b & 0x0f);
      if (b < 0xa0) return arr(b & 0x0f);
      if (b < 0xc0) return str(b & 0x1f);
      if (b >= 0xe0) return b - 0x100;
      let v;
      switch (b) {
        case 0xc0: return null;
        case 0xc2: return false;
        case 0xc3: return true;
        case 0xc4: v = view.getUint8(off); off += 1; return bin(v);
        case 0xc5: v = view.getUint16(off); off += 2; return bin(v);
        case 0xc6: v = view.getUint32(off); off += 4; return bin(v);
        case 0xc7: v = view.getUint8(off); off += 1; return ext(v);
        case 0xc8: v = view.getUint16(off); off += 2; return ext(v);
        case 0xc9: v = view.getUint32(off); off += 4; return ext(v);
        case 0xca: v = view.getFloat32(off); off += 4; return v;
        case 0xcb: v = view.getFloat64(off); off += 8; return v;
        case 0xcc: v = view.getUint8(off); off += 1; return v;
        case 0xcd: v = view.getUint16(off); off += 2; return v;
        case 0xce: v = view.getUint32(off); off += 4; return v;
        case 0xcf: v = Number(view.getBigUint64(off)); off += 8; return v;
        case 0xd0: v = view.getInt8(off); off += 1; return v;
        case 0xd1: v = view.getInt16(off); off += 2; return v;
        case 0xd2: v = view.getInt32(off); off += 4; return v;
        case 0xd3: v = Number(view.getBigInt64(off)); off += 8; return v;
        case 0xd4: return ext(1);
        case 0xd5: return ext(2);
        case 0xd6: return ext(4);
        case 0xd7: return ext(8);
        case 0xd8: return ext(16);
        case 0xd9: v = view.getUint8(off); off += 1; return str(v);
        case 0xda: v = view.getUint16(off); off += 2; return str(v);
        case 0xdb: v = view.getUint32(off); off += 4; return str(v);
        case 0xdc: v = view.getUint16(off); off += 2; return arr(v);
        case 0xdd: v = view.getUint32(off); off += 4; return arr(v);
        case 0xde: v = view.getUint16(off); off += 2; return map(v);
        case 0xdf: v = view.getUint32(off); off += 4; return map(v);
      }
      throw new Error("msgpack: unknown byte 0x" + b.toString(16));
    }
    return read();
  }

  // ---------- state ----------
  const STORE_KEY = "cor3-job-tracker";
  const state = { jobs: {}, servers: {}, checks: {}, panel: { x: 20, y: 80, open: true, min: false } };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (_) {}
  // Raw copies of the last job lists, for checking in the console (window.__cor3JobTracker).
  const debug = { lastJobs: null, lastRecentJobs: null };
  window.__cor3JobTracker = { debug, state };
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {} };

  const isJob = (o) => o && typeof o === "object" && ["TAKEN", "COMPLETED", "FAILED"].includes(o.status) &&
    ("conditions" in o || "relatedServers" in o) && o.id != null;
  const isServer = (o) => o && typeof o === "object" && typeof o.serverIp === "string" &&
    typeof o.isAccessible === "boolean";

  function scan(node, depth) {
    if (!node || typeof node !== "object" || depth > 10) return false;
    let changed = false;
    if (Array.isArray(node)) {
      for (const x of node) changed = scan(x, depth + 1) || changed;
      return changed;
    }
    // Small push events from the market: the job's task is done (ready to
    // complete), or the job was completed and handed in.
    const action = node.event && typeof node.event.action === "string" ? node.event.action : null;
    const d = node.data && typeof node.data === "object" && !Array.isArray(node.data) ? node.data : null;
    if (action && d && d.jobId != null) {
      const id = String(d.jobId);
      const job = state.jobs[id];
      if (action === "job.can-complete" && job) {
        job.canComplete = d.canComplete ?? true;
        changed = true;
      } else if (action === "job.completed" && job) {
        job.status = "COMPLETED";
        job.canComplete = false;
        changed = true;
      } else if (action === "job.fail" && job) {
        job.status = "FAILED";
        changed = true;
      }
    }
    if (Array.isArray(node.jobs)) {
      // Offers in the market's job tab (not taken yet).
      state.market = { offers: node.jobs.length, at: Date.now() };
      debug.lastJobs = node.jobs;
      changed = true;
    }
    if (Array.isArray(node.recentJobs)) {
      // Authoritative list of your taken jobs: every entry counts, even if it
      // carries fewer fields than expected; drop ones that are no longer in it.
      debug.lastRecentJobs = node.recentJobs;
      const recent = node.recentJobs.filter((j) => j && typeof j === "object" && j.id != null);
      state.market = { ...(state.market || {}), taken: recent.length, at: Date.now() };
      const keep = new Set(recent.map((j) => String(j.id)));
      for (const id of Object.keys(state.jobs)) if (!keep.has(id)) delete state.jobs[id];
      for (const j of recent) {
        const id = String(j.id);
        state.jobs[id] = { status: "TAKEN", ...state.jobs[id], ...j, _seen: Date.now() };
      }
      changed = true;
    }
    if (isJob(node)) {
      state.jobs[String(node.id)] = { ...state.jobs[String(node.id)], ...node, _seen: Date.now() };
      changed = true;
    }
    if (isServer(node)) {
      const s = {
        id: node.id, serverIp: node.serverIp, serverName: node.serverName,
        isAccessible: node.isAccessible, isReachable: node.isReachable,
        hasAdminAccess: node.hasAdminAccess, isInMaintenance: node.isInMaintenance,
        _seen: Date.now(),
      };
      state.servers[node.serverIp] = s;
      changed = true;
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === "object" && !(v instanceof Uint8Array) && !(v instanceof Date)) {
        changed = scan(v, depth + 1) || changed;
      }
    }
    return changed;
  }

  function onPacket(data) {
    try {
      if (scan(data, 0)) { save(); render(); }
    } catch (e) { console.warn("[job tracker]", e); }
  }

  // ---------- websocket hook ----------
  const NativeWS = window.WebSocket;
  function handleFrame(ev) {
    const d = ev.data;
    if (d instanceof ArrayBuffer) {
      try { onPacket(decodeMsgpack(d)); } catch (_) {}
    } else if (typeof Blob !== "undefined" && d instanceof Blob) {
      d.arrayBuffer().then((b) => { try { onPacket(decodeMsgpack(b)); } catch (_) {} });
    } else if (typeof d === "string" && d.length > 2 && d[0] === "4") {
      // Plain socket.io text frame fallback: 42["event",{...}]
      const i = d.indexOf("[");
      if (i > 0) { try { onPacket(JSON.parse(d.slice(i))); } catch (_) {} }
    }
  }
  function HookedWS(...args) {
    const ws = new NativeWS(...args);
    try { ws.addEventListener("message", handleFrame); } catch (_) {}
    return ws;
  }
  HookedWS.prototype = NativeWS.prototype;
  for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) HookedWS[k] = NativeWS[k];
  window.WebSocket = HookedWS;

  // ---------- panel ----------
  const CSS = `
    :host { all: initial; }
    .p { position: fixed; z-index: 2147483646; width: 340px; max-height: 70vh; display: flex; flex-direction: column;
         background: rgba(8,16,22,.95); border: 1px solid #2d4a55; border-radius: 6px; color: #cfe7ee;
         font: 12px/1.4 ui-monospace, Consolas, monospace; box-shadow: 0 6px 24px rgba(0,0,0,.5); }
    .h { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: #10222b; cursor: move;
         border-bottom: 1px solid #2d4a55; user-select: none; border-radius: 6px 6px 0 0; }
    .h b { flex: 1; color: #76c1d1; letter-spacing: .05em; }
    .h button { background: none; border: 1px solid #2d4a55; color: #9fc; cursor: pointer; border-radius: 3px; font: inherit; padding: 0 6px; }
    .b { overflow: auto; padding: 6px 8px; }
    .job { border: 1px solid #22363f; border-radius: 4px; padding: 6px; margin-bottom: 6px; }
    .job.ready { border-color: #2fae6a; }
    .job.done { opacity: .5; }
    .t { display: flex; gap: 6px; align-items: baseline; }
    .t .n { flex: 1; font-weight: 700; color: #e6f6fa; }
    .badge { font-size: 10px; padding: 0 4px; border-radius: 3px; background: #1d3640; color: #76c1d1; }
    .badge.ok { background: #144d30; color: #5df0a0; }
    .badge.bad { background: #4d1b14; color: #ff8a70; }
    .badge.warn { background: #4d3510; color: #ffa040; }
    .time { color: #ffc800; font-size: 11px; }
    .sec { margin-top: 4px; color: #7f9aa3; font-size: 10px; text-transform: uppercase; }
    label { display: flex; gap: 6px; align-items: center; cursor: pointer; word-break: break-all; }
    label.chk span { text-decoration: line-through; opacity: .6; }
    .srv { display: flex; gap: 6px; align-items: center; }
    .srv .ip { flex: 1; word-break: break-all; }
    .empty { color: #7f9aa3; padding: 8px 0; }
    .desc { color: #9fb6bd; margin-top: 2px; }
  `;

  let host, root, panel;
  function ensurePanel() {
    if (panel && document.documentElement.contains(host)) return true;
    if (!document.body) return false;
    host = document.createElement("div");
    host.id = "cor3-job-tracker-host";
    root = host.attachShadow({ mode: "open" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch (_) {
      const st = document.createElement("style");
      st.textContent = CSS;
      root.appendChild(st);
    }
    panel = document.createElement("div");
    panel.className = "p";
    root.appendChild(panel);
    document.body.appendChild(host);

    // Dragging by the header.
    let drag = null;
    panel.addEventListener("mousedown", (e) => {
      if (!e.target.closest(".h") || e.target.closest("button")) return;
      drag = { dx: e.clientX - state.panel.x, dy: e.clientY - state.panel.y };
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      state.panel.x = Math.max(0, e.clientX - drag.dx);
      state.panel.y = Math.max(0, e.clientY - drag.dy);
      panel.style.left = state.panel.x + "px";
      panel.style.top = state.panel.y + "px";
    });
    window.addEventListener("mouseup", () => { if (drag) { drag = null; save(); } });

    panel.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (btn) {
        const act = btn.dataset.act;
        if (act === "min") state.panel.min = !state.panel.min;
        if (act === "close") state.panel.open = false;
        if (act === "clear") { state.jobs = {}; state.checks = {}; }
        save(); render();
      }
    });
    panel.addEventListener("change", (e) => {
      const cb = e.target.closest("input[data-key]");
      if (!cb) return;
      state.checks[cb.dataset.key] = cb.checked;
      save(); render();
    });
    return true;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function timeLeft(job) {
    if (!job.endTime) return "";
    const s = Math.floor((new Date(job.endTime).getTime() - Date.now()) / 1000);
    if (s <= 0) return "expired";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  }

  // Same flattening the game uses for the job card: ips, file names, log names, files.
  function conditionItems(job) {
    const out = [];
    for (const item of job.conditions?.items || []) {
      const d = item?.details || {};
      const kind = item.type || item.action || item.kind || item.conditionType || "";
      const push = (key, text, what) => out.push({ key, text, kind, what });
      if (d.ips?.length) d.ips.forEach((ip) => push(ip, ip, "ip"));
      else if (d.fileNames?.length) d.fileNames.forEach((f) => push(f, f, "file"));
      else if (d.logNames?.length) d.logNames.forEach((l) => push(l, l, "log"));
      else if (d.files?.length) d.files.forEach((f) => push(f?.id || f?.name || "", f?.name || "", "file"));
    }
    return out;
  }

  function findServer(rs) {
    if (rs.serverIp && state.servers[rs.serverIp]) return state.servers[rs.serverIp];
    return Object.values(state.servers).find((s) =>
      (rs.id && s.id === rs.id) || (rs.serverName && s.serverName === rs.serverName)) || null;
  }

  function accessBadge(rs) {
    const s = findServer(rs);
    if (!s) return `<span class="badge" title="Open the network map so the tracker can see this server">? unknown</span>`;
    if (s.isInMaintenance) return `<span class="badge warn">maintenance</span>`;
    if (s.hasAdminAccess) return `<span class="badge ok">admin</span>`;
    if (s.isAccessible) return `<span class="badge ok">access</span>`;
    if (s.isReachable) return `<span class="badge bad">no access</span>`;
    return `<span class="badge bad">unreachable</span>`;
  }

  function render() {
    if (!state.panel.open) { if (host) host.style.display = "none"; return; }
    if (!ensurePanel()) return;
    host.style.display = "";
    panel.style.left = state.panel.x + "px";
    panel.style.top = state.panel.y + "px";

    const jobs = Object.values(state.jobs).sort((a, b) => {
      const rank = (j) => (j.status === "TAKEN" ? 0 : 1);
      return rank(a) - rank(b) || String(a.endTime || "").localeCompare(String(b.endTime || ""));
    });
    const active = jobs.filter((j) => j.status === "TAKEN").length;

    let html = `<div class="h"><b>JOBS (${active})</b>
      <button data-act="clear" title="Forget stored jobs">clear</button>
      <button data-act="min">${state.panel.min ? "+" : "&ndash;"}</button>
      <button data-act="close" title="Alt+J to reopen">&times;</button></div>`;

    if (!state.panel.min) {
      html += `<div class="b">`;
      if (!jobs.length) {
        html += state.market?.at
          ? `<div class="empty">You have no taken jobs. Accept a job in the market and it shows up here.</div>`
          : `<div class="empty">No job data yet. Open the market's job tab once so the tracker can read it.</div>`;
      }
      for (const j of jobs) {
        const done = j.status !== "TAKEN";
        const items = conditionItems(j);
        const servers = j.relatedServers || [];
        html += `<div class="job ${j.canComplete ? "ready" : ""} ${done ? "done" : ""}">
          <div class="t"><span class="n">${esc(j.name || j.id)}</span>
            ${j.canComplete ? `<span class="badge ok">READY</span>` : `<span class="badge">${esc(j.status)}</span>`}</div>`;
        if (!done && j.endTime) html += `<div class="time">${esc(timeLeft(j))}</div>`;
        if (j.features?.[0]) html += `<div class="desc">${esc(j.features[0])}</div>`;
        if (items.length) {
          html += `<div class="sec">To do</div>`;
          for (const it of items) {
            const key = `${j.id}|${it.key}`;
            const chk = !!state.checks[key];
            html += `<label class="${chk ? "chk" : ""}"><input type="checkbox" data-key="${esc(key)}" ${chk ? "checked" : ""}>
              <span>${it.kind ? esc(it.kind) + " " : ""}${esc(it.what)}: ${esc(it.text)}</span></label>`;
          }
        }
        if (servers.length) {
          html += `<div class="sec">Servers</div>`;
          for (const rs of servers) {
            html += `<div class="srv"><span class="ip">${esc(rs.serverName ?? "")}${rs.serverName && rs.serverIp ? " &middot; " : ""}${esc(rs.serverIp ?? "")}</span>${accessBadge(rs)}</div>`;
          }
        }
        html += `</div>`;
      }
      const seen = Object.keys(state.servers).length;
      const m = state.market;
      const when = m?.at ? new Date(m.at).toTimeString().slice(0, 5) : "";
      html += `<div class="empty">${m?.at ? `Market (${when}): ${m.offers ?? "?"} offers, ${m.taken ?? "?"} taken.<br>` : ""}${seen} servers known from the network map.</div></div>`;
    }
    panel.innerHTML = html;
  }

  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "j") { state.panel.open = !state.panel.open; save(); render(); }
  });

  // ---------- access marks on the market's job cards ----------
  // The cards only show server names as text ("Servers - RM7-S4L2, 10.0.0.7"),
  // so match each name/IP against the servers seen on the network map.
  const MARK_CLASS = "cor3-jt-mark";
  const SERVER_TEXT = [
    '[data-component-name="JobCardCollapsedText"]',
    '[data-component-name="JobCardExpandedInfoValue"]',
    '[data-component-name="JobSideoutInfoValue"]',
  ].join(",");

  function lookupServer(token) {
    if (state.servers[token]) return state.servers[token];
    const t = token.toLowerCase();
    return Object.values(state.servers).find((s) =>
      (s.serverName || "").toLowerCase() === t || (s.serverIp || "").toLowerCase() === t) || null;
  }

  // Text of an element without our own mark.
  function ownText(el) {
    let text = "";
    for (const n of el.childNodes) if (!(n.classList && n.classList.contains(MARK_CLASS))) text += n.textContent;
    return text.trim();
  }

  // The "Servers" line of every job card: the first text line of a collapsed
  // card, and the value next to the same label in the expanded views.
  function serverLines() {
    const out = [];
    let label = null;
    for (const card of document.querySelectorAll('[data-component-name="JobCardCollapsed"]')) {
      const first = card.querySelector('[data-component-name="JobCardCollapsedText"]');
      if (!first) continue;
      const text = ownText(first);
      const i = text.indexOf(" - ");
      if (i < 0) continue;
      label = label || text.slice(0, i).trim();
      out.push({ el: first, list: text.slice(i + 3) });
    }
    for (const el of document.querySelectorAll(SERVER_TEXT)) {
      if (el.getAttribute("data-component-name") === "JobCardCollapsedText") continue;
      const labelEl = el.previousElementSibling;
      const list = ownText(el);
      const isServers = (label && labelEl && ownText(labelEl) === label) ||
        list.split(",").some((t) => lookupServer(t.trim()));
      if (isServers) out.push({ el, list });
    }
    return out;
  }

  function markFor(s) {
    if (!s) return null;
    if (s.isInMaintenance) return { ch: "&#9888;", color: "#ffa040", tip: "in maintenance" };
    if (s.hasAdminAccess) return { ch: "&#10003;", color: "#5df0a0", tip: "admin access" };
    if (s.isAccessible) return { ch: "&#10003;", color: "#5df0a0", tip: "access" };
    return { ch: "&#10007;", color: "#ff8a70", tip: s.isReachable ? "no access" : "unreachable" };
  }

  function annotateJobCards() {
    const known = Object.keys(state.servers).length;
    for (const { el, list } of serverLines()) {
      const tokens = list.split(",").map((t) => t.trim()).filter((t) => t && t !== "N/A");
      let mark = el.querySelector(`:scope > .${MARK_CLASS}`);
      if (!tokens.length) { if (mark) mark.remove(); continue; }

      const html = tokens.map((t) => {
        const m = markFor(lookupServer(t));
        return m
          ? `<span title="${esc(t)}: ${m.tip}" style="color:${m.color};font-weight:700">${m.ch}</span>`
          : `<span title="${esc(t)}: unknown, not among the ${known} servers on your network map yet" style="color:#7f9aa3;font-weight:700">?</span>`;
      }).join(" ");
      if (!mark) {
        mark = document.createElement("span");
        mark.className = MARK_CLASS;
        mark.style.marginLeft = "6px";
        el.appendChild(mark);
      }
      if (mark.innerHTML !== html) mark.innerHTML = html;
    }
  }

  // Refresh countdowns and card marks once a second.
  setInterval(() => {
    if (state.panel.open && !state.panel.min && Object.keys(state.jobs).length) render();
    try { annotateJobCards(); } catch (e) { console.warn("[job tracker]", e); }
  }, 1000);
  document.addEventListener("DOMContentLoaded", render);
  if (document.readyState !== "loading") render();
})();
