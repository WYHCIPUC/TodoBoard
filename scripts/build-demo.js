"use strict";

const fs = require("fs");
const path = require("path");
const brainstorm = require("../lib/brainstorm");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, ".demo-site");
const DEMO_GOAL = "制作一个属于自己的、符合自己偏好的网站设计 Skill";

function safeOutputDir(value) {
  const output = path.resolve(value || DEFAULT_OUTPUT);
  const root = path.parse(output).root;
  if (output === root || output === ROOT) throw new Error("拒绝使用过宽的 Demo 输出目录");
  return output;
}

function buildDemo(outputDir) {
  const output = safeOutputDir(outputDir);
  const data = fs.readFileSync(path.join(ROOT, "DATA.example.md"), "utf8");
  const analysis = brainstorm.analyze(data, {
    entriesDir: path.join(ROOT, ".demo-no-entries"),
    mode: "fusion",
    goal: DEMO_GOAL,
  });

  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "board.html"), path.join(output, "index.html"));
  for (const file of ["board.css", "board-base.css", "board-workspace.css", "board-entry.css", "board-data.css", "board-relationship.css", "board-brainstorm.css", "board.js", "board-relationship.js", "board-brainstorm.js", "board-data.js", "board-study.js", "board-commands.js", "board-entry.js"]) {
    fs.copyFileSync(path.join(ROOT, file), path.join(output, file));
  }
  fs.copyFileSync(path.join(ROOT, "DATA.example.md"), path.join(output, "DATA.example.md"));
  fs.writeFileSync(path.join(output, "demo-brainstorm.json"), JSON.stringify({ ok: true, ...analysis }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(output, ".nojekyll"), "", "utf8");
  return output;
}

if (require.main === module) {
  const output = buildDemo(process.env.DEMO_OUTPUT_DIR);
  console.log("在线 Demo 已生成：" + output);
}

module.exports = { buildDemo, DEMO_GOAL };
