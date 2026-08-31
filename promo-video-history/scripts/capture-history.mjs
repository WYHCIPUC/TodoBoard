import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer-core";
import { findBrowser, settle } from "./browser-utils.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const output = path.join(root, "public", "textures", "live", "v1-board.png");
const url = process.env.LINGGAN_V1_URL || "http://127.0.0.1:3873/";

fs.mkdirSync(path.dirname(output), { recursive: true });
const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
await settle(page, 1500);
for (const label of ["跳过", "稍后", "知道了"]) {
  const buttons = await page.$$("button");
  for (const button of buttons) {
    const text = await button.evaluate((node) => node.textContent?.trim() || "");
    if (text === label) await button.click();
  }
}
await settle(page, 500);
await page.screenshot({ path: output, fullPage: false });
await browser.close();
console.log(`history capture: ${output}`);
