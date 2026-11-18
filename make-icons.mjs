// Renders icons/icon.svg to the PNG sizes the browsers want.
//   node make-icons.mjs        (needs Playwright with Chromium)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// require() also finds a globally installed Playwright.
const { chromium } = createRequire(import.meta.url)("playwright");

const root = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(root, "icons", "icon.svg"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: join(root, "icons", `icon-${size}.png`), omitBackground: true });
  console.log(`icons/icon-${size}.png`);
}
await browser.close();
