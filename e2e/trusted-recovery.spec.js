"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { test, expect } = require("@playwright/test");

const repo = path.join(__dirname, "..");
let root;
let child;
let origin;
let realDataHash;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForReady(processHandle) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(output || "server timeout")), 10_000);
    processHandle.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("灵感来袭 · 待办看板")) { clearTimeout(timer); resolve(); }
    });
    processHandle.stderr.on("data", chunk => { output += chunk; });
    processHandle.once("exit", code => { clearTimeout(timer); reject(new Error("server exited " + code + "\n" + output)); });
  });
}

function stopChild(processHandle) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (processHandle.exitCode === null && processHandle.signalCode === null) processHandle.kill("SIGKILL");
    }, 5000);
    timer.unref();
    processHandle.once("exit", () => { clearTimeout(timer); resolve(); });
    processHandle.kill("SIGTERM");
  });
}

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-e2e-可信恢复-"));
  const dataFile = path.join(root, "DATA.md");
  fs.writeFileSync(dataFile, "# E2E\n\n## 1. AI 工具\n\n### ⏳ 1.1 恢复 <img src=x onerror=alert(1)>\n- **作者 / 来源**：[fixture](https://example.invalid)\n- **研究要点**：待补充\n", "utf8");
  const realData = path.join(repo, "DATA.md");
  realDataHash = fs.existsSync(realData) ? crypto.createHash("sha256").update(fs.readFileSync(realData)).digest("hex") : null;
  const port = await freePort();
  origin = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, [path.join(repo, "server.js")], {
    cwd: repo,
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", NO_OPEN: "1", README_FILE: dataFile,
      ENTRIES_DIR: path.join(root, "entries"), TRASH_DIR: path.join(root, "trash"),
      BRAINSTORM_DIR: path.join(root, "brainstorms"), RECOVERED_ORPHANS_DIR: path.join(root, "recovered-orphans"),
      AUDIT_LOG_FILE: path.join(root, "audit.log"), SERVER_ERROR_LOG_FILE: path.join(root, "server-error.log"),
      DINGTALK_CLIENT_ID: "", DINGTALK_CLIENT_SECRET: "", WECOM_CORP_ID: "", WECOM_SECRET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForReady(child);
});

test.afterAll(async () => {
  await stopChild(child);
  fs.rmSync(root, { recursive: true, force: true });
  const realData = path.join(repo, "DATA.md");
  const after = fs.existsSync(realData) ? crypto.createHash("sha256").update(fs.readFileSync(realData)).digest("hex") : null;
  expect(after).toBe(realDataHash);
});

test("trusted recovery is keyboard-safe, XSS-safe and honest about verification", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => { localStorage.setItem("linggan_onboarding_v2_seen", "1"); document.querySelector("#onboardingModal").classList.remove("open"); });
  await expect(page.locator("#trustRail")).toHaveAttribute("data-state", "healthy");
  await expect(page.locator(".row img[onerror], .card img[onerror]")).toHaveCount(0);
  await page.locator("#trustCenterBtn").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#recoveryModal")).toHaveClass(/open/);
  await expect(page.locator("#recoveryTitle")).toHaveText("数据健康");
  await expect(page.locator("#recoveryConfirmBtn")).toBeDisabled();
  await expect(page.locator("#recoverySummary")).toContainText("不会自动猜测");
});

test("390px and reduced motion keep recovery controls usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(origin);
  await page.evaluate(() => { localStorage.setItem("linggan_onboarding_v2_seen", "1"); document.querySelector("#onboardingModal").classList.remove("open"); });
  await page.locator("#trustCenterBtn").click();
  await expect(page.locator("#recoveryTitle")).toHaveText("数据健康");
  await expect(page.locator("#recoveryRefreshBtn")).toBeVisible();
  await expect(page.locator("#recoveryPreviewBtn")).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".recovery-modal")).animationName)).toBe("none");
});

test("offline refresh degrades to explicit read-only state with focused error", async ({ page, context }) => {
  await page.goto(origin);
  await page.evaluate(() => { localStorage.setItem("linggan_onboarding_v2_seen", "1"); document.querySelector("#onboardingModal").classList.remove("open"); });
  await expect(page.locator("#trustRail")).toHaveAttribute("data-state", "healthy");
  await page.locator("#trustCenterBtn").click();
  await expect(page.locator("#recoveryTitle")).toHaveText("数据健康");
  await context.setOffline(true);
  await page.locator("#recoveryRefreshBtn").click();
  await expect(page.locator("#recoveryError")).toBeVisible();
  await expect(page.locator("#recoveryError")).toBeFocused();
  await context.setOffline(false);
});
