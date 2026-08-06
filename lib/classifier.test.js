"use strict";
const assert = require("assert");
const { classify, categoryOfSectionTitle, guessSource } = require("./classifier");

// classify —— 基线来自 regression-baseline.json,是【当前算法真实输出】
assert.strictEqual(classify("腾讯 Miora 设计 Agent 网站动效神器"), "前端 & 设计");
assert.strictEqual(classify("drawio-skill AI 自动生成架构图"), "AI 工具");
assert.strictEqual(classify("ESP32 迷你四轴无人机 45元手搓 硬件"), "硬件 & 嵌入式");
assert.strictEqual(classify("PaperTodo 极简 Windows 桌面便签"), "桌面 & 系统");
assert.strictEqual(classify("roboflow supervision computer vision github"), "开源项目 & 开发");
assert.strictEqual(classify("EyeDex 眼图 开放目录搜索引擎 osint"), "搜索 & OSINT");
assert.strictEqual(classify(""), "其他");

assert.strictEqual(categoryOfSectionTitle("1. AI 工具"), "AI 工具");
assert.strictEqual(categoryOfSectionTitle("2. 硬件 & 嵌入式 DIY"), "硬件 & 嵌入式");
assert.strictEqual(categoryOfSectionTitle("前端设计网页"), "前端 & 设计");

assert.strictEqual(guessSource("https://www.bilibili.com/video/BV1xx"), "B站视频");
assert.strictEqual(guessSource("https://mp.weixin.qq.com/s/xxx"), "微信公众号原文");
assert.strictEqual(guessSource("https://github.com/user/repo"), "GitHub 仓库");
assert.strictEqual(guessSource("https://example.com/other"), "来源");

console.log("classifier: ALL PASS");
