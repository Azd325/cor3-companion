// Turns the "## Unreleased" section of CHANGELOG.md into the new version and
// writes that version's notes for the GitHub release.
//   node scripts/changelog.mjs <version> <notes-file>
// CHANGELOG.md gets "## <version> (<date>)" in place of "## Unreleased", with a
// fresh empty "## Unreleased" above it. The notes file gets that section's text.
// If "Unreleased" is empty, the notes list the PRs merged since the last tag
// instead, so a release never goes out with no notes at all.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const [version, notesFile] = process.argv.slice(2);
if (!version || !notesFile) {
  console.error("Usage: node scripts/changelog.mjs <version> <notes-file>");
  process.exit(1);
}

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "CHANGELOG.md");
const text = readFileSync(file, "utf8");
const date = new Date().toISOString().slice(0, 10);

const start = text.search(/^## Unreleased[^\n]*$/m);
let body = "";
let out = text;
if (start >= 0) {
  const headEnd = text.indexOf("\n", start) + 1 || text.length;
  const next = text.slice(headEnd).search(/^## /m);
  const end = next >= 0 ? headEnd + next : text.length;
  body = text.slice(headEnd, end).trim();
  if (body) {
    out = `${text.slice(0, start)}## Unreleased\n\n## ${version} (${date})\n\n${body}\n\n${text.slice(end)}`;
  }
}

if (!body) {
  // Fall back to the titles of the PRs merged since the last release.
  let lines = [];
  try {
    const last = execSync("git describe --tags --abbrev=0", { encoding: "utf8" }).trim();
    lines = execSync(`git log --first-parent --format=%s%x09%b%x00 ${last}..HEAD`, { encoding: "utf8" })
      .split("\0")
      .map((l) => l.trim())
      .filter((l) => l && !/^Release v/.test(l))
      .map((l) => {
        // A GitHub merge commit's subject is "Merge pull request #N from ..."; its body holds the title.
        const [subject, rest = ""] = l.split("\t");
        const title = rest.trim().split("\n")[0];
        const pr = subject.match(/#\d+/)?.[0];
        return `- ${(subject.startsWith("Merge pull request") && title) || subject}${pr && !subject.includes(`(${pr})`) ? ` (${pr})` : ""}`;
      });
  } catch {}
  body = lines.length ? `### Changes\n\n${lines.join("\n")}` : "Small fixes and improvements.";
  console.error("CHANGELOG.md has nothing under Unreleased; using the merged PR titles.");
}

writeFileSync(file, out.replace(/\n{3,}/g, "\n\n"));
writeFileSync(notesFile, `${body}\n`);
console.log(body);
