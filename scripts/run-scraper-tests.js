// 联网抓取集成测试：与离线发布门禁分开，避免外部站点波动影响基础 CI。
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const scraperDir = path.join(__dirname, "..", "lib", "scraper");
const files = fs.readdirSync(scraperDir)
  .filter(f => f.endsWith(".test.js"))
  .sort();

if (!files.length) {
  console.error("未找到 scraper 集成测试文件");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, [path.join(scraperDir, file)], {
      stdio: "inherit",
      env: Object.assign({}, process.env, { TEST_KIND: "integration" }),
    });
  } catch (_) {
    failed++;
    console.error("✗ " + file + " 失败");
  }
}

if (failed) {
  console.error("\n" + failed + " 个 scraper 集成测试文件失败");
  process.exit(1);
}

console.log("\n✓ 全部 " + files.length + " 个 scraper 集成测试文件通过");
