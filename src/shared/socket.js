// Read-only hook on the game's websocket.
// Decodes every frame the game receives and hands it to the helpers that
// asked for it with window.__cor3.onPacket(fn), so the socket is hooked only
// once. It never sends anything to the game server.
// Runs at document_start, before the game opens its socket.
(() => {
  "use strict";
  if (window.__cor3SocketHooked) return;
  window.__cor3SocketHooked = true;
  const decodeMsgpack = window.__cor3.decodeMsgpack;
  const listeners = (window.__cor3PacketListeners = window.__cor3PacketListeners || []);

  function onPacket(data) {
    for (const fn of listeners) {
      try { fn(data); } catch (e) { console.warn("[cor3 helper]", e); }
    }
  }

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
})();
