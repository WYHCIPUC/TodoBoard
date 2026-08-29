// Based on video-shotcraft assets/scripts/capture-template.mjs.
// Captures only an isolated fictional dataset; repository DATA.md is never opened.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import puppeteer from "puppeteer-core";
import { findBrowser, settle } from "./browser-utils.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const videoRoot = path.resolve(here, "..");
const repoRoot = path.resolve(videoRoot, "..");
const outDir = path.join(videoRoot, "public", "textures", "live");
const layoutPath = path.join(videoRoot, "src", "live-layout.json");
const fixtureRoot = path.join(videoRoot, "out", "capture-fixture");
const dataFile = path.join(fixtureRoot, "DATA.md");
const port = 3988;
const base = `http://127.0.0.1:${port}`;

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.dirname(layoutPath), { recursive: true });
fs.mkdirSync(fixtureRoot, { recursive: true });
fs.copyFileSync(path.join(videoRoot, "video-demo-data.md"), dataFile);

const child = spawn(process.execPath, [path.join(repoRoot, "server.js")], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    NO_OPEN: "1",
    README_FILE: dataFile,
    CONTROL_DIR: path.join(fixtureRoot, ".linggan"),
    ENTRIES_DIR: path.join(fixtureRoot, "entries"),
    BRAINSTORM_DIR: path.join(fixtureRoot, "brainstorms"),
    TRASH_DIR: path.join(fixtureRoot, "trash"),
    RECOVERED_ORPHANS_DIR: path.join(fixtureRoot, "orphans"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
child.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
child.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`本地演示服务未就绪\n${serverLog}`);
}

const boxOf = async (element) => element.evaluate((node) => {
  const rect = node.getBoundingClientRect();
  return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, w: rect.width, h: rect.height };
});

async function capturePage(page, name, selectors = {}) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 800);
  const pageH = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: path.join(outDir, `${name}-full.png`), fullPage: true });
  const entry = { pageH, boxes: {}, cutouts: [] };
  for (const [key, selector] of Object.entries(selectors.boxes || {})) {
    const elements = await page.$$(selector);
    entry.boxes[key] = [];
    for (const element of elements.slice(0, 12)) entry.boxes[key].push(await boxOf(element));
  }
  for (const cutout of selectors.cutouts || []) {
    const elements = await page.$$(cutout.selector);
    for (let index = 0; index < elements.length && index < (cutout.max || 1); index += 1) {
      const suffix = (cutout.max || 1) > 1 ? String(index + 1) : "";
      const file = `${cutout.name}${suffix}.png`;
      const box = await boxOf(elements[index]);
      const target = path.join(outDir, file);
      if (process.env.FORCE_CAPTURE === "1" || !fs.existsSync(target)) {
        await elements[index].screenshot({ path: target, omitBackground: Boolean(cutout.omitBackground) });
      }
      entry.cutouts.push({ file, ...box });
    }
  }
  return entry;
}

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("board_view", "board");
    localStorage.setItem("product_view", "inspiration");
    localStorage.setItem("linggan_onboarding_v2_seen", "1");
  });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector("#boardView .card");

  const layout = { pageW: 1920 };
  layout.library = await capturePage(page, "library", {
    boxes: { cards: "#boardView .card", trustRail: "#trustRail", search: ".search" },
    cutouts: [
      { name: "card", selector: "#boardView .card", max: 8 },
      { name: "search", selector: ".search" },
      { name: "trust-rail", selector: "#trustRail" },
    ],
  });

  await page.click("#addBtn");
  await page.waitForSelector("#modal.open");
  layout.capture = await capturePage(page, "capture", {
    boxes: { modal: "#modal .modal" },
    cutouts: [{ name: "capture-modal", selector: "#modal .modal" }],
  });
  await page.click("#cancelBtn");
  await page.waitForSelector("#modal:not(.open)");

  await page.evaluate(() => {
    document.querySelectorAll("#boardView .card").forEach((node) => { node.style.visibility = "hidden"; });
  });
  await page.screenshot({ path: path.join(outDir, "library-empty.png"), fullPage: true });
  await page.evaluate(() => {
    document.querySelectorAll("#boardView .card").forEach((node) => { node.style.visibility = ""; });
  });

  await page.evaluate(() => window.openEntry("5.1"));
  await page.waitForFunction(() => {
    const view = document.getElementById("entryView");
    const title = document.getElementById("entryTitle");
    return view && !view.hidden && title && !title.textContent.includes("正在加载");
  });
  layout.entry = await capturePage(page, "entry", {
    boxes: { view: "#entryView", archive: "#entryArchive", form: "#entryForm" },
  });
  await page.evaluate(() => window.closeEntry());
  await page.waitForSelector("#boardView:not([hidden])");

  await page.evaluate(() => window.openRelationship());
  await page.waitForSelector("#relationshipView:not([hidden])");
  await page.waitForFunction(() => document.querySelectorAll("#relationshipNodes .relationship-node").length >= 6);
  await page.evaluate(() => document.querySelector("#relationshipNodes .relationship-node")?.click());
  await settle(page, 600);
  layout.relationship = await capturePage(page, "relationship", {
    boxes: {
      viewport: "#relationshipViewport",
      nodes: "#relationshipNodes .relationship-node",
      detail: "#relationshipDetail",
      stages: ".product-nav",
    },
    cutouts: [],
  });

  await page.evaluate(async () => { await window.openRecoveryCenter(); });
  await page.waitForSelector("#recoveryModal.open, #recoveryModal[aria-hidden='false']");
  layout.recovery = await capturePage(page, "recovery", {
    boxes: { modal: "#recoveryModal .recovery-modal" },
    cutouts: [{ name: "recovery-modal", selector: "#recoveryModal .recovery-modal" }],
  });
  await page.evaluate(() => document.getElementById("recoveryModal").classList.remove("open"));

  await page.evaluate(() => {
    document.getElementById("brainstormGoal").value = "把收藏的工具组合成一套可验证的个人研究工作流";
    window.openBrainstorm();
  });
  await page.waitForSelector("#brainstormView:not([hidden])");
  await page.waitForSelector("#brainstormFusion .brainstorm-fusion-card");
  layout.brainstorm = await capturePage(page, "brainstorm", {
    boxes: {
      goal: "#brainstormGoalForm",
      fusion: "#brainstormFusion .brainstorm-fusion-card",
      tabs: ".brainstorm-modes",
    },
    cutouts: [
      { name: "brainstorm-goal", selector: "#brainstormGoalForm" },
      { name: "brainstorm-fusion", selector: "#brainstormFusion .brainstorm-fusion-card" },
    ],
  });

  fs.writeFileSync(layoutPath, `${JSON.stringify(layout, null, 2)}\n`, "utf8");
  console.log(`captures: ${outDir}`);
  console.log(`layout: ${layoutPath}`);
} finally {
  if (browser) await browser.close();
  child.kill();
}
