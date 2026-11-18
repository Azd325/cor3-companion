// Builds the extension for Chrome and Firefox.
//   node build.mjs
// Output in dist/:
//   chrome/                     folder for chrome://extensions > "Load unpacked"
//   firefox/                    folder for about:debugging or `web-ext sign`
//   cor3-companion-chrome.zip
//   cor3-companion-firefox.xpi
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const FILES = [
  "jobs.js", "loadout.js", "solver.js", "expeditions.js", "popup.html", "popup.js",
  "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png",
];
const base = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

// FIREFOX_UPDATE_URL (set by the GitHub release workflow) lets installed
// Firefox copies update themselves from the repo's latest release.
const firefox = structuredClone(base);
if (process.env.FIREFOX_UPDATE_URL) {
  firefox.browser_specific_settings.gecko.update_url = process.env.FIREFOX_UPDATE_URL;
}

const targets = {
  // Chrome rejects nothing here, but it warns about the Firefox-only key.
  chrome: (() => { const m = structuredClone(base); delete m.browser_specific_settings; return m; })(),
  firefox,
};

// ---- minimal zip writer (deflate, no external tools needed) ----
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

rmSync(dist, { recursive: true, force: true });
for (const [name, manifest] of Object.entries(targets)) {
  const dir = join(dist, name);
  mkdirSync(dir, { recursive: true });
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(dir, "manifest.json"), manifestBuf);
  for (const f of FILES) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    copyFileSync(join(root, f), join(dir, f));
  }
  const entries = [
    { name: "manifest.json", data: manifestBuf },
    ...FILES.map((f) => ({ name: f, data: readFileSync(join(root, f)) })),
  ];
  const out = join(dist, name === "chrome" ? "cor3-companion-chrome.zip" : "cor3-companion-firefox.xpi");
  writeFileSync(out, zip(entries));
  console.log(`built ${name}: dist/${name}/ and ${out.slice(root.length + 1)}`);
}
