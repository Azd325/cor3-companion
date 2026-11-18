// msgpack decoder for the game's websocket frames
// (socket.io-msgpack-parser / notepack format). Sets window.__cor3.decodeMsgpack.
(() => {
  "use strict";

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

  window.__cor3.decodeMsgpack = decodeMsgpack;
})();
