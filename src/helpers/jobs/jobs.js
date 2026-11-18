// COR3 job tracker.
// Listens (read-only) to the game's websocket, picks out taken jobs and the
// network-map server list, and shows them in a small floating panel.
// It never sends anything to the game server.
(() => {
  "use strict";

  const { esc, toMs, load, save: store, shadowHost } = window.__cor3;

  // ---------- times ----------
  // "2h 05m", "12m", "40s"; null when the time is unknown or past.
  function shortLeft(v) {
    const ms = toMs(v) - Date.now();
    if (!(ms > 0)) return null;
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m) return `${m}m`;
    return `${s}s`;
  }

  // ---------- state ----------
  const STORE_KEY = "cor3-job-tracker";
  const state = load(STORE_KEY, { jobs: {}, servers: {}, checks: {}, panel: { x: 20, y: 80, open: true, min: false } });
  // Raw copies of the last job lists, for checking in the console (window.__cor3JobTracker).
  const debug = { lastJobs: null, lastRecentJobs: null };
  window.__cor3JobTracker = { debug, state };
  const save = () => store(STORE_KEY, state);

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
    // A server went into maintenance (push event).
    if (action === "maintenance" && d) {
      const s = Object.values(state.servers).find((x) =>
        (d.serverId != null && x.id === d.serverId) || (d.id != null && x.id === d.id) ||
        (d.serverIp && x.serverIp === d.serverIp));
      if (s) {
        s.isInMaintenance = true;
        if (d.maintenanceEndsAt) s.maintenanceEndsAt = d.maintenanceEndsAt;
        s.timeUntilMaintenance = null;
        changed = true;
      }
    }
    // When the market's jobs reset next.
    if (node.nextJobsResetAt && toMs(node.nextJobsResetAt) > 0) {
      state.market = { ...(state.market || {}), resetAt: node.nextJobsResetAt };
      changed = true;
    }
    // The network map's links between servers, for working out routes.
    if (Array.isArray(node.servers) && Array.isArray(node.connections)) {
      const ip = {};
      let home = null;
      for (const s of node.servers) {
        if (!s || s.id == null || typeof s.serverIp !== "string") continue;
        ip[s.id] = s.serverIp;
        if (s.serverTypeName === "Home" || s.serverName === "Home Server") home = s.serverIp;
      }
      const links = [];
      for (const c of node.connections) {
        if (c && ip[c.serverA] && ip[c.serverB]) links.push([ip[c.serverA], ip[c.serverB]]);
      }
      if (home && links.length) { state.net = { home, links, at: Date.now() }; changed = true; }
    }
    if (Array.isArray(node.jobs)) {
      // Offers in the market's job tab (not taken yet).
      state.market = { ...(state.market || {}), offers: node.jobs.length, at: Date.now() };
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
      const old = state.servers[node.serverIp] || {};
      const s = {
        id: node.id, serverIp: node.serverIp, serverName: node.serverName,
        isAccessible: node.isAccessible, isReachable: node.isReachable,
        hasAdminAccess: node.hasAdminAccess, isInMaintenance: node.isInMaintenance,
        _seen: Date.now(),
      };
      // Network map extras; smaller server objects in other events leave them out.
      for (const k of ["maintenanceEndsAt", "timeUntilMaintenance", "serverDefenceRate", "serverTypeName"]) {
        s[k] = k in node ? node[k] : old[k];
      }
      if (!s.isInMaintenance && "isInMaintenance" in node) s.maintenanceEndsAt = null;
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
  // Every decoded websocket packet (shared/socket.js).
  window.__cor3.onPacket((data) => {
    try {
      if (scan(data, 0)) { save(); render(); }
    } catch (e) { console.warn("[job tracker]", e); }
  });

  // ---------- panel ----------
  const CSS = `
    :host { all: initial; }
    .p { position: fixed; z-index: 2147483646; width: 340px; max-height: 70vh; display: flex; flex-direction: column;
         background: rgba(8,16,22,.92); border: 1px solid #2d4a55; border-radius: 6px; color: #cfe7ee;
         font: 11px/1.45 ui-monospace, Consolas, monospace; box-shadow: 0 4px 14px rgba(0,0,0,.45); }
    .h { display: flex; align-items: stretch; height: 22px; line-height: 22px; cursor: move; user-select: none;
         border-bottom: 1px solid #2d4a55; }
    .h b { flex: 1; padding: 0 8px; color: #76c1d1; letter-spacing: .05em; }
    .h button { all: unset; padding: 0 8px; border-left: 1px solid #1d3640; color: #cfe7ee; cursor: pointer; }
    .h button:hover { background: #10222b; }
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
    .srv { display: flex; flex-wrap: wrap; gap: 3px 6px; align-items: center; }
    .srv .ip { flex: 1 1 150px; word-break: break-all; }
    .route { color: #7f9aa3; font-size: 10px; margin: 0 0 2px 8px; word-break: break-all; }
    .route .hop { color: #ffa040; }
    .empty { color: #7f9aa3; padding: 8px 0; }
    .desc { color: #9fb6bd; margin-top: 2px; }
  `;

  let host, root, panel, lastHtml = "";
  function ensurePanel() {
    if (panel && document.documentElement.contains(host)) return true;
    if (!document.body) return false;
    ({ host, root } = shadowHost("cor3-job-tracker-host", CSS));
    panel = document.createElement("div");
    panel.className = "p";
    lastHtml = "";
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

  // Maintenance starting within this time gets a warning.
  const SOON_MS = 2 * 3600 * 1000;

  // Your best HACK power, from the loadout the loadout helper last saw.
  function hackPower() {
    const sp = window.__cor3Loadout?.state?.loadout?.resources?.softwarePower;
    let best = null;
    for (const p of Array.isArray(sp) ? sp : []) {
      for (const a of p?.abilities || []) {
        if (String(a?.type).toUpperCase() === "HACK" && typeof a.computedPower === "number") {
          best = Math.max(best ?? 0, a.computedPower);
        }
      }
    }
    return best;
  }

  // Extra facts about a server: maintenance times and defence against your HACK power.
  function serverInfo(s) {
    const out = [];
    if (s.isInMaintenance) {
      const left = shortLeft(s.maintenanceEndsAt);
      out.push({ cls: "warn", text: left ? `maintenance, ${left} left` : "maintenance", tip: "in maintenance" });
    } else {
      const ms = toMs(s.timeUntilMaintenance) - Date.now();
      if (ms > 0 && ms < SOON_MS) {
        out.push({ cls: "warn", text: `maint. in ${shortLeft(s.timeUntilMaintenance)}`, tip: "maintenance starts soon" });
      }
    }
    const def = s.serverDefenceRate;
    if (!s.isAccessible && typeof def === "number" && def > 0) {
      const hack = hackPower();
      out.push(hack == null
        ? { cls: "", text: `DEF ${def}`, tip: "defence rate; open your Loadout to compare with your HACK power" }
        : { cls: hack >= def ? "ok" : "bad", text: `DEF ${def} · HACK ${hack} ${hack >= def ? "&#10003;" : "&#10007;"}`,
            tip: hack >= def ? "your best HACK power beats the defence rate" : "your best HACK power is below the defence rate" });
    }
    return out;
  }

  // ---------- routes ----------
  // A server you don't have access to is still within reach when there is a
  // way to it from Home through servers you can pass: ones you have access to,
  // or ones your HACK power beats, and none in maintenance. Fewer hacks win,
  // then fewer hops.
  const inMaint = (s) => s.isInMaintenance && !(toMs(s.maintenanceEndsAt) <= Date.now());
  function canHack(s, hack) {
    const def = s.serverDefenceRate;
    if (typeof def !== "number" || def <= 0) return true;
    return hack == null ? null : hack >= def;
  }
  function neighbours() {
    const adj = {};
    for (const [a, b] of state.net?.links || []) {
      (adj[a] = adj[a] || []).push(b);
      (adj[b] = adj[b] || []).push(a);
    }
    return adj;
  }
  // Cheapest route from Home to target (IPs, Home and target included), or
  // null. With pass = () => true it finds the shortest route of all.
  function cheapest(target, adj, pass) {
    const home = state.net.home;
    const dist = { [home]: 0 }, prev = {}, done = new Set();
    for (;;) {
      let cur = null;
      for (const k in dist) if (!done.has(k) && (cur == null || dist[k] < dist[cur])) cur = k;
      if (cur == null) return null;
      if (cur === target) break;
      done.add(cur);
      for (const nb of adj[cur] || []) {
        if (done.has(nb)) continue;
        const cost = nb === target ? 1 : pass(nb);
        if (cost == null) continue;
        if (dist[nb] == null || dist[cur] + cost < dist[nb]) { dist[nb] = dist[cur] + cost; prev[nb] = cur; }
      }
    }
    const path = [target];
    while (path[0] !== home) path.unshift(prev[path[0]]);
    return path;
  }

  // Can you get into this server now, keeping the route in mind?
  // { ok: true | false | null (don't know yet), cls, text, tip, route }
  function reach(s) {
    if (!s) return { ok: null, cls: "", text: "? unknown", tip: "open the network map so the tracker can see this server" };
    if (inMaint(s)) return { ok: false, cls: "warn", text: "", tip: "in maintenance" };
    if (s.hasAdminAccess) return { ok: true, cls: "ok", text: "admin", tip: "admin access" };
    if (s.isAccessible) return { ok: true, cls: "ok", text: "access", tip: "access" };
    const hack = hackPower();
    const target = canHack(s, hack);
    const hackTip = target == null ? "open your Loadout to compare its defence with your HACK power" : "";
    if (!state.net?.home || !state.servers[state.net.home]) {
      // No links known yet: fall back to what the game says.
      return s.isReachable
        ? { ok: target, cls: "bad", text: "no access", tip: "no access" }
        : { ok: null, cls: "bad", text: "unreachable", tip: "unreachable; open the network map to work out a route" };
    }
    const adj = neighbours();
    let unsure = false;
    const route = cheapest(s.serverIp, adj, (ip) => {
      const h = state.servers[ip];
      if (!h || inMaint(h)) return null;
      if (h.isAccessible || ip === state.net.home) return 1;
      const c = canHack(h, hack);
      if (c === false) return null;
      if (c == null) unsure = true;
      return 10; // a hack on the way
    });
    if (!route) {
      // Name the first server that blocks the shortest route.
      const any = cheapest(s.serverIp, adj, () => 1);
      let why = "no route from Home on your network map";
      for (const ip of (any || []).slice(1, -1)) {
        const h = state.servers[ip];
        if (!h) continue;
        if (inMaint(h)) { const l = shortLeft(h.maintenanceEndsAt); why = `${h.serverName || ip} is in maintenance${l ? ` (${l} left)` : ""}`; break; }
        if (canHack(h, hack) === false && !h.isAccessible) { why = `${h.serverName || ip} defence ${h.serverDefenceRate} is above your HACK ${hack}`; break; }
      }
      return { ok: false, cls: "bad", text: "no route", tip: why };
    }
    const hops = route.slice(1, -1).filter((ip) => !state.servers[ip]?.isAccessible && ip !== state.net.home);
    const ok = target === false ? false : unsure || target == null ? null : true;
    const text = s.isReachable || !hops.length ? "no access" : `via ${hops.length} hack${hops.length > 1 ? "s" : ""}`;
    const tip = (hops.length ? `hack on the way: ${hops.map((ip) => state.servers[ip]?.serverName || ip).join(", ")}` : "reachable, no access yet") +
      (hackTip ? `; ${hackTip}` : "");
    return { ok, cls: ok === false ? "bad" : "warn", text, tip, route };
  }

  // The route as a short line, e.g. "Home → RM7-S4L2 → 10.0.0.7", with servers
  // you still have to hack in orange.
  function routeLine(route) {
    return route.map((ip, i) => {
      const s = state.servers[ip] || {};
      const name = esc(i === 0 ? "Home" : s.serverName || ip);
      return i && i < route.length - 1 && !s.isAccessible ? `<span class="hop">${name}</span>` : name;
    }).join(" &rarr; ");
  }

  window.__cor3JobTracker.reach = (ip) => reach(state.servers[ip]);

  function accessBadge(rs) {
    const s = findServer(rs);
    const r = reach(s);
    if (!s) return `<span class="badge" title="${esc(r.tip)}">${r.text}</span>`;
    const extra = serverInfo(s).map((i) => `<span class="badge ${i.cls}" title="${esc(i.tip)}">${i.text}</span>`).join("");
    return (r.text ? `<span class="badge ${r.cls}" title="${esc(r.tip)}">${r.text}</span>` : "") + extra;
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

    let html = `<div class="h"><b>&#9670; JOBS (${active})</b>
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
        if (!done && j.endTime) html += `<div class="time" data-end="${esc(j.endTime)}"></div>`;
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
            const r = reach(findServer(rs));
            if (r.route && r.route.length > 2 && r.text !== "no access") html += `<div class="route">${routeLine(r.route)}</div>`;
          }
        }
        html += `</div>`;
      }
      const seen = Object.keys(state.servers).length;
      const m = state.market;
      const when = m?.at ? new Date(m.at).toTimeString().slice(0, 5) : "";
      const reset = shortLeft(m?.resetAt);
      html += `<div class="empty">${m?.at ? `Market (${when}): ${m.offers ?? "?"} offers, ${m.taken ?? "?"} taken.<br>` : ""}${reset ? `Jobs reset in ${reset}.<br>` : ""}${seen} servers known from the network map.</div></div>`;
    }
    // Rewriting the panel resets its scroll and can swallow a click, so only
    // write it when something other than the ticking countdowns changed.
    if (html === lastHtml) return tickTimes();
    const body = panel.querySelector(".b");
    const scroll = body ? body.scrollTop : 0;
    panel.innerHTML = html;
    lastHtml = html;
    tickTimes();
    const nb = panel.querySelector(".b");
    if (nb) nb.scrollTop = scroll;
  }

  // Countdowns update in place, without redrawing the panel.
  function tickTimes() {
    if (!panel) return;
    for (const el of panel.querySelectorAll(".time[data-end]")) {
      const t = timeLeft({ endTime: el.dataset.end });
      if (el.textContent !== t) el.textContent = t;
    }
  }

  // Alt+J or the toolbar menu shows or hides the panel.
  window.__cor3.helper("jobs", () => state.panel.open, (on) => { state.panel.open = on; save(); render(); });

  // ---------- access marks on the market's job cards ----------
  // The cards only show server names as text ("Servers - RM7-S4L2, 10.0.0.7"),
  // so match each name/IP against the servers seen on the network map.
  const MARK_CLASS = "cor3-jt-mark";
  const { GREEN, RED } = window.__cor3.color;
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

  // Why a server blocks a job right now, or null when it doesn't.
  function blocker(token) {
    const s = lookupServer(token);
    if (!s) return `${token}: not on your network map yet, open the map`;
    const r = reach(s);
    if (inMaint(s)) {
      const l = shortLeft(s.maintenanceEndsAt);
      return `${token}: in maintenance${l ? `, ${l} left` : ""}`;
    }
    if (r.ok === true) return null;
    const def = s.serverDefenceRate, hack = hackPower();
    if (r.ok === false && r.text !== "no route" && typeof def === "number" && hack != null && hack < def) {
      return `${token}: defence ${def} is above your HACK ${hack}`;
    }
    return `${token}: ${r.tip}`;
  }

  // One mark per job card: ✓ when you can do the job now (every server is
  // yours or within reach), ✗ otherwise. Hovering it says what blocks it.
  function annotateJobCards() {
    for (const { el, list } of serverLines()) {
      const tokens = list.split(",").map((t) => t.trim()).filter((t) => t && t !== "N/A");
      let mark = el.querySelector(`:scope > .${MARK_CLASS}`);
      if (!tokens.length) { if (mark) mark.remove(); continue; }
      const blocks = tokens.map(blocker).filter(Boolean);
      const ok = !blocks.length;
      const tip = ok ? "You can do this job now: every server is yours or within reach" : `Blocked by:\n${blocks.join("\n")}`;
      if (!mark) {
        mark = document.createElement("span");
        mark.className = MARK_CLASS;
        mark.style.cssText = "margin-left:6px;font-weight:700;cursor:help";
        el.appendChild(mark);
      }
      const ch = ok ? "\u2713" : "\u2717";
      if (mark.textContent !== ch) mark.textContent = ch;
      mark.style.color = ok ? GREEN : RED;
      if (mark.title !== tip) mark.title = tip;
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
