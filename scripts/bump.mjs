// Bumps "version" in manifest.json.
//   node bump.mjs [patch|minor|major]    (default: patch)
// Prints the new version.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "manifest.json");
const part = process.argv[2] || "patch";
if (!["patch", "minor", "major"].includes(part)) {
  console.error(`Unknown bump "${part}"; use patch, minor or major.`);
  process.exit(1);
}

const text = readFileSync(file, "utf8");
const manifest = JSON.parse(text);
let [major, minor, patch] = manifest.version.split(".").map((n) => parseInt(n, 10) || 0);
if (part === "major") { major++; minor = 0; patch = 0; }
else if (part === "minor") { minor++; patch = 0; }
else patch++;
const next = `${major}.${minor}.${patch}`;

// Replace only the version line so the rest of the file keeps its formatting.
writeFileSync(file, text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`));
console.log(next);
