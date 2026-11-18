// Builds the extension and signs the Firefox package with Mozilla (unlisted).
//   node sign.mjs
// Reads WEB_EXT_API_KEY and WEB_EXT_API_SECRET from .env (see .env.example).
// The signed .xpi lands in web-ext-artifacts/.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const envFile = join(root, ".env");

// Locally the keys come from .env; in GitHub Actions they come from repo secrets.
if (existsSync(envFile)) process.loadEnvFile(envFile);
for (const k of ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"]) {
  if (!process.env[k]) {
    console.error(`${k} is not set. Copy .env.example to .env and fill in your AMO API keys.`);
    process.exit(1);
  }
}

const version = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version;
console.log(`Signing version ${version}. Each version can be signed only once; bump "version" in manifest.json for a new one.`);

const run = (cmd, args) => {
  // shell is needed on Windows to find npx; arguments here are fixed, not user input.
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("node", ["build.mjs"]);
// web-ext reads the API key and secret from the WEB_EXT_* environment variables.
run("npx", ["--yes", "web-ext@8", "sign", "--source-dir", "dist/firefox", "--channel", "unlisted",
  "--artifacts-dir", "web-ext-artifacts"]);
