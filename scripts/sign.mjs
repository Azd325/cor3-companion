// Builds the extension and submits the Firefox package to Mozilla.
//   node scripts/sign.mjs
// Reads WEB_EXT_API_KEY and WEB_EXT_API_SECRET from .env (see .env.example).
// AMO_CHANNEL picks the channel: "listed" (default) publishes the version on
// addons.mozilla.org with the listing from store/ (amo-metadata.json plus
// description.txt, sent with every version so the repo is the one source);
// "unlisted" only signs it. The signed .xpi lands in web-ext-artifacts/.
//
// Exit code 3: Mozilla took the version but hadn't signed it within 5 minutes
// (it went to a human reviewer). The version is used up on AMO either way, so
// the release should carry on without the .xpi; AMO publishes it once approved.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env");

// Locally the keys come from .env; in GitHub Actions they come from repo secrets.
if (existsSync(envFile)) process.loadEnvFile(envFile);
for (const k of ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"]) {
  if (!process.env[k]) {
    console.error(`${k} is not set. Copy .env.example to .env and fill in your AMO API keys.`);
    process.exit(1);
  }
}

const version = JSON.parse(readFileSync(join(root, "src", "manifest.json"), "utf8")).version;
console.log(`Signing version ${version}. Each version can be signed only once; bump "version" in src/manifest.json for a new one.`);

const channel = process.env.AMO_CHANNEL || "listed";
if (!["listed", "unlisted"].includes(channel)) {
  console.error(`AMO_CHANNEL must be "listed" or "unlisted", not "${channel}".`);
  process.exit(1);
}

// shell is needed on Windows to find npx; arguments here are fixed, not user input.
const opts = { cwd: root, shell: process.platform === "win32" };

const build = spawnSync("node", ["scripts/build.mjs"], { ...opts, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

// web-ext reads the API key and secret from the WEB_EXT_* environment variables.
const args = ["--yes", "web-ext@8", "sign", "--source-dir", "dist/firefox", "--channel", channel,
  "--artifacts-dir", "web-ext-artifacts", "--approval-timeout", String(5 * 60 * 1000)];
if (channel === "listed") {
  const meta = JSON.parse(readFileSync(join(root, "store", "amo-metadata.json"), "utf8"));
  meta.description = { "en-US": readFileSync(join(root, "store", "description.txt"), "utf8").trim() };
  writeFileSync(join(root, "dist", "amo-metadata.json"), JSON.stringify(meta, null, 2));
  args.push("--amo-metadata", "dist/amo-metadata.json");
}

// Output is shown as it comes (so a long wait doesn't look like a hang) and
// kept, to tell "not signed yet" apart from real failures.
console.log("Uploading to Mozilla. Waiting for approval can take up to 5 minutes; don't cancel the run.");
let output = "";
const child = spawn("npx", args, { ...opts, stdio: ["inherit", "pipe", "pipe"] });
child.stdout.on("data", (d) => { output += d; process.stdout.write(d); });
child.stderr.on("data", (d) => { output += d; process.stderr.write(d); });
const status = await new Promise((res) => child.on("close", res));
if (status === 0) process.exit(0);
if (/Approval: timeout exceeded/.test(output)) {
  console.log(`Version ${version} is with Mozilla for review; AMO publishes it once approved.`);
  process.exit(3);
}
process.exit(status ?? 1);
