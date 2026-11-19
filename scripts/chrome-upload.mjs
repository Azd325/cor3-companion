// Uploads dist/cor3-companion-chrome.zip to the Chrome Web Store and submits it
// for review (Chrome Web Store API v2). Google publishes it once approved.
//   node scripts/chrome-upload.mjs
// Needs CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN,
// CHROME_PUBLISHER_ID and CHROME_EXTENSION_ID (repo secrets, or .env locally).
// Without them it says so and exits 0, so releases still work before they're set.
//
// A version still waiting for review is withdrawn first: the store holds one
// submission at a time, and the new version replaces it.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));

const KEYS = ["CHROME_CLIENT_ID", "CHROME_CLIENT_SECRET", "CHROME_REFRESH_TOKEN", "CHROME_PUBLISHER_ID", "CHROME_EXTENSION_ID"];
const missing = KEYS.filter((k) => !process.env[k]);
if (missing.length) {
  console.log(`Skipping the Chrome Web Store: ${missing.join(", ")} not set.`);
  process.exit(0);
}
const env = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const zip = readFileSync(join(root, "dist", "cor3-companion-chrome.zip"));
const version = JSON.parse(readFileSync(join(root, "src", "manifest.json"), "utf8")).version;

const item = `publishers/${env.CHROME_PUBLISHER_ID}/items/${env.CHROME_EXTENSION_ID}`;
const API = `https://chromewebstore.googleapis.com/v2/${item}`;
const UPLOAD = `https://chromewebstore.googleapis.com/upload/v2/${item}:upload`;

async function call(url, init = {}) {
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method || "GET"} ${url.split("?")[0]}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const { access_token } = await call("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: env.CHROME_CLIENT_ID,
    client_secret: env.CHROME_CLIENT_SECRET,
    refresh_token: env.CHROME_REFRESH_TOKEN,
    grant_type: "refresh_token",
  }),
});
const auth = { Authorization: `Bearer ${access_token}` };
const status = () => call(`${API}:fetchStatus`, { headers: auth });

const before = await status();
if (before.submittedItemRevisionStatus?.state === "PENDING_REVIEW") {
  const old = before.submittedItemRevisionStatus.distributionChannels?.[0]?.crxVersion ?? "the previous version";
  console.log(`Withdrawing ${old}, still in review, so ${version} replaces it.`);
  await call(`${API}:cancelSubmission`, { method: "POST", headers: auth });
}

console.log(`Uploading ${version} (${zip.length} bytes)...`);
let up = await call(UPLOAD, { method: "POST", headers: { ...auth, "Content-Type": "application/zip" }, body: zip });
let state = up.uploadState;
for (let i = 0; state === "IN_PROGRESS" && i < 30; i++) {
  await sleep(5000);
  state = (await status()).lastAsyncUploadState;
}
if (state !== "SUCCEEDED") throw new Error(`Upload ended as ${state}: ${JSON.stringify(up)}`);

const pub = await call(`${API}:publish`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{}" });
console.log(`Submitted ${version} to the Chrome Web Store: ${pub.state}.`);
if (pub.warningInfo) console.log("Warnings:", JSON.stringify(pub.warningInfo));
