// 跨平台测试聚合：依次运行 lib/*.test.js，任一失败则整体退出码非 0
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const testDirs = [path.join(rootDir, "lib"), path.join(rootDir, "scripts")];
const files = testDirs.flatMap(dir => fs.readdirSync(dir)
  .filter(f => f.endsWith(".test.js"))
  .map(f => path.join(dir, f)))
  .sort();
if (!files.length) { console.error("未找到测试文件"); process.exit(1); }

let failed = 0;
for (const file of files) {
  const f = path.relative(rootDir, file);
  try {
    execFileSync(process.execPath, [file], { stdio: "inherit" });
  } catch (e) {
    failed++;
    console.error("✗ " + f + " 失败");
  }
}
if (failed) { console.error("\n" + failed + " 个测试文件失败"); process.exit(1); }
console.log("\n✓ 全部 " + files.length + " 个测试文件通过");
