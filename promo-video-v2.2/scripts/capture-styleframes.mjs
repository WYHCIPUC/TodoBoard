import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import puppeteer from "puppeteer-core";
import { findBrowser, settle } from "./browser-utils.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const output = path.join(root, "out", "styleframes");
fs.mkdirSync(output, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(root, "styleframes.html")).href, { waitUntil: "load" });
await settle(page);
for (const id of ["sf-brand", "sf-library", "sf-brain"]) {
  const element = await page.$(`#${id}`);
  if (!element) throw new Error(`缺少 styleframe: ${id}`);
  await element.screenshot({ path: path.join(output, `${id}.png`) });
}
await browser.close();
console.log(`styleframes: ${output}`);
