// Attaches Mozilla's signed .xpi to GitHub releases that went out without one.
//   node scripts/attach-xpi.mjs
// A release goes out without the .xpi when Mozilla holds the version for a
// human review (see sign.mjs). Once Mozilla approves it, this downloads the
// signed file from addons.mozilla.org and adds it to the release, with
// updates.json for the newest release (GitHub installs check that file).
// Runs from .github/workflows/attach-xpi.yml every hour; needs gh, GH_TOKEN,
// WEB_EXT_API_KEY and WEB_EXT_API_SECRET.
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.WEB_EXT_API_KEY, SECRET = process.env.WEB_EXT_API_SECRET;
const REPO = process.env.GITHUB_REPOSITORY;
if (!KEY || !SECRET || !REPO) {
  console.error("WEB_EXT_API_KEY, WEB_EXT_API_SECRET and GITHUB_REPOSITORY must be set.");
  process.exit(1);
}
const GUID = JSON.parse(readFileSync(join(root, "src", "manifest.json"), "utf8")).browser_specific_settings.gecko.id;
const AMO = "https://addons.mozilla.org/api/v5";

// AMO's API takes a short-lived HS256 JWT signed with the API secret.
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: KEY, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
const amo = async (url) => {
  const r = await fetch(url, { headers: { Authorization: `JWT ${jwt()}` } });
  if (!r.ok) throw new Error(`GET ${url}: ${r.status} ${await r.text()}`);
  return r;
};
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });

// The 10 newest releases, and which of them miss the .xpi.
const releases = JSON.parse(gh("api", `repos/${REPO}/releases?per_page=10`));
const latestTag = JSON.parse(gh("api", `repos/${REPO}/releases/latest`)).tag_name;
const missing = releases.filter((r) => !r.draft && !r.assets.some((a) => a.name === "cor3-companion-firefox.xpi"));
if (!missing.length) { console.log("Every recent release has its .xpi."); process.exit(0); }

// Every version of the add-on on AMO, listed or not, with its file's status.
const versions = new Map();
let next = `${AMO}/addons/addon/${encodeURIComponent(GUID)}/versions/?filter=all_with_unlisted&page_size=50`;
while (next) {
  const page = await (await amo(next)).json();
  for (const v of page.results) versions.set(v.version, v);
  next = page.next;
}

const dir = mkdtempSync(join(tmpdir(), "xpi-"));
for (const rel of missing) {
  const version = rel.tag_name.replace(/^v/, "");
  const v = versions.get(version);
  const status = v?.file?.status;
  if (!v || status !== "public" || !v.file.url) {
    console.log(`${rel.tag_name}: ${v ? `not approved yet (${status})` : "not on AMO"}, skipping.`);
    continue;
  }
  const xpi = join(dir, "cor3-companion-firefox.xpi");
  writeFileSync(xpi, Buffer.from(await (await amo(v.file.url)).arrayBuffer()));
  const files = [xpi];
  if (rel.tag_name === latestTag) {
    const link = `https://github.com/${REPO}/releases/download/${rel.tag_name}/cor3-companion-firefox.xpi`;
    const updates = join(dir, "updates.json");
    writeFileSync(updates, JSON.stringify({ addons: { [GUID]: { updates: [{ version, update_link: link }] } } }, null, 2));
    files.push(updates);
  }
  gh("release", "upload", rel.tag_name, ...files, "--clobber", "--repo", REPO);
  console.log(`${rel.tag_name}: attached ${files.map((f) => f.split("/").pop()).join(" and ")}.`);
}
