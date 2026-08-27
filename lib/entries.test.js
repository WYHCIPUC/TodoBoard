"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "entries-test-"));
process.env.ENTRIES_DIR = path.join(tmpRoot, "entries");

// store.readAll 也要指向临时 README,使 entriesTitle 能解析标题
const tmpReadme = path.join(tmpRoot, "README.md");
const UID = "44444444-4444-4444-8444-444444444444";
fs.writeFileSync(
  tmpReadme,
  `# Test

## 1. AI 工具

### ⏳ 1.1 测试条目
<!-- linggan:uid=${UID} -->
- **简介**:x
- **作者 / 来源**:[t](https://e.com)
- **难度**:⭐
- **研究要点**:(待补充)
`,
  "utf-8"
);
process.env.README_FILE = tmpReadme;

// store 模块用 README_FILE(在读取 README 时求值),ENTRIES_DIR 用环境变量。
const entries = require("./entries");

// === 基础:getEntry 不存在时返回虚拟空模板且保持只读 ===
let e = entries.getEntry("1.1");
assert.strictEqual(e.id, "1.1");
assert.strictEqual(e.uid, UID);
assert.ok(e.notesContent.includes("# "), "notesContent 应含标题");
assert.strictEqual(e.title, "测试条目", "title 应从 README 解析: " + e.title);
assert.strictEqual(fs.existsSync(path.join(tmpRoot, "entries", UID, "notes.md")), false, "只读 getEntry 不得创建 notes.md");
assert.strictEqual(fs.existsSync(path.join(tmpRoot, "entries", UID, "screenshots")), false, "只读 getEntry 不得创建 screenshots/");

// 空档案的字段全部走默认值,不报错
assert.strictEqual(e.fields.rating, 1, "空档案 rating 默认 1");
assert.strictEqual(e.fields.recommendLevel, 1, "空档案 recommendLevel 默认 1");
assert.strictEqual(e.fields.downloadStatus, "未下载");

// === 路径穿越防护 ===
let threw = false;
try { entries.getEntry("../../etc"); } catch (ex) { threw = true; }
assert.ok(threw, "非法 id 必须抛错");

threw = false;
try { entries.assertValidId("1"); } catch (ex) { threw = true; }
assert.ok(threw, "非 N.M 形式必须抛错");
assert.doesNotThrow(() => entries.assertValidId("12.34"), "12.34 应合法");

// safePath 二次防穿越(即便 id 通过校验,也不应跨出 entries 根)
let root = path.resolve(tmpRoot, "entries");
assert.ok(entries.safePath("1.1").startsWith(root), "safePath 应落在 entries 根内");

const withArchive = entries.getEntry("1.1", {
  archive: { getStatus: id => ({ id, state: "queued", attempt: 0, nextRunAt: null }) },
});
assert.strictEqual(withArchive.archive.state, "queued");
assert.strictEqual(entries.getEntry("1.1", { archive: { getStatus: () => null } }).archive.state, "queued");
assert.strictEqual(entries.entriesTitle("9.9"), "条目 9.9");
assert.strictEqual(entries.entryUrl("1.1"), "https://e.com");
assert.strictEqual(entries.entryUrl("9.9"), null);
assert.strictEqual(entries.resolveStorageKey("9.9"), "9.9");
assert.strictEqual(entries.parseNotes("").template, "general");
const storeModule = require("./store");
const originalReadAll = storeModule.readAll;
storeModule.readAll = () => { throw new Error("read failed"); };
try {
  assert.strictEqual(entries.entriesTitle("1.1"), "条目 1.1");
  assert.strictEqual(entries.entryUrl("1.1"), null);
  assert.strictEqual(entries.resolveStorageKey("1.1"), "1.1");
} finally { storeModule.readAll = originalReadAll; }

// === round-trip(核心!) ===
const fields = {
  template: "project",
  whySaved: "评估是否采用",
  keyFindings: "本地优先",
  actionItems: "做一次迁移演练",
  conclusion: "进入候选清单",
  downloadStatus: "已下载",
  installerName: "Miora-Setup.exe",
  installStatus: "已安装",
  installPath: "C:\\Program Files\\Miora",
  rating: 4,
  metExpectation: "是",
  experience: "动效质量很高,但导出水印。\n第二行测试。",
  keep: "是",
  recommendLevel: 5,
  keepNote: "做官网动效必备",
};
entries.saveNotes("1.1", fields);
e = entries.getEntry("1.1");
const parsed = e.fields;
for (const k of Object.keys(fields)) {
  assert.strictEqual(
    parsed[k],
    fields[k],
    "round-trip 字段丢失或值不符 [" + k + "]: 期望=" +
      JSON.stringify(fields[k]) + " 实际=" + JSON.stringify(parsed[k])
  );
}

// round-trip 之二:空值字段也能完整还原(常见坑:默认空值丢失)
entries.saveNotes("1.1", {
  downloadStatus: "",
  installerName: "",
  installStatus: "",
  installPath: "",
  rating: 1,
  metExpectation: "",
  experience: "",
  keep: "",
  recommendLevel: 1,
  keepNote: "",
});
e = entries.getEntry("1.1");
assert.strictEqual(e.fields.installerName, "", "空 installerName 应原样保留");
assert.strictEqual(e.fields.installPath, "", "空 installPath 应原样保留");
assert.strictEqual(e.fields.metExpectation, "", "空 metExpectation 应原样保留");
assert.strictEqual(e.fields.keepNote, "", "空 keepNote 应原样保留");
assert.strictEqual(e.fields.experience, "", "空 experience 应原样保留");

entries.saveNotes("1.1", {
  template: "article",
  whySaved: "补充背景",
  keyFindings: "关键观点",
  actionItems: "验证来源",
  conclusion: "值得保留",
});
e = entries.getEntry("1.1");
assert.strictEqual(e.fields.template, "article");
assert.strictEqual(e.fields.whySaved, "补充背景");
assert.strictEqual(e.fields.keyFindings, "关键观点");
assert.strictEqual(e.fields.actionItems, "验证来源");
assert.strictEqual(e.fields.conclusion, "值得保留");

// round-trip 之三:rating/recommendLevel 越界被 clamp 到 [1,5]
entries.saveNotes("1.1", { rating: 99, recommendLevel: 0 });
e = entries.getEntry("1.1");
assert.strictEqual(e.fields.rating, 5, "rating>5 应 clamp 到 5");
assert.strictEqual(e.fields.recommendLevel, 1, "recommendLevel<1 应 clamp 到 1");

// 重新写回完整字段,供后续截图测试使用
entries.saveNotes("1.1", fields);

// === 截图上传(magic number 校验) ===
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const fakePng = Buffer.concat([PNG_MAGIC, Buffer.from("fake image data")]);
const r = entries.uploadScreenshot("1.1", fakePng, "主界面截图");
assert.ok(r.file.endsWith(".png"), "文件名应以 .png 结尾: " + r.file);
assert.ok(
  /^\d{8}-\d{6}\.png$/.test(r.file),
  "文件名应为 YYYYMMDD-HHMMSS.png: " + r.file
);
assert.ok(
  fs.existsSync(entries.safePath("1.1", "screenshots", r.file)),
  "截图文件应存在"
);

// 非图片拒绝
threw = false;
try { entries.uploadScreenshot("1.1", Buffer.from("not image"), "x"); } catch (ex) { threw = true; }
assert.ok(threw, "非图片必须拒绝");

// 超大文件拒绝(>5MB)
threw = false;
try {
  const big = Buffer.concat([PNG_MAGIC, Buffer.alloc(6 * 1024 * 1024)]);
  entries.uploadScreenshot("1.1", big, "big");
} catch (ex) { threw = true; }
assert.ok(threw, "超过 5MB 必须拒绝");

// caption 能从 notes 解析回
e = entries.getEntry("1.1");
assert.ok(
  e.screenshots.some(s => s.caption === "主界面截图"),
  "caption 应能解析回: " + JSON.stringify(e.screenshots)
);

// caption 含 | 时应被转义为 /(避免破坏注释分隔)
const r2 = entries.uploadScreenshot("1.1", fakePng, "左|右对比");
const jpg = entries.uploadScreenshot("1.1", [0xff, 0xd8, 0xff, 0x00], "jpg\ncaption");
assert.ok(jpg.file.endsWith(".jpg"));
e = entries.getEntry("1.1");
assert.ok(
  e.screenshots.some(s => s.file === r2.file && s.caption === "左/右对比"),
  "caption 中的 | 应转为 /"
);

// === 截图删除 ===
entries.deleteScreenshot("1.1", r.file);
e = entries.getEntry("1.1");
assert.ok(
  !e.screenshots.some(s => s.file === r.file),
  "删除后截图应从列表消失"
);
assert.ok(
  !fs.existsSync(entries.safePath("1.1", "screenshots", r.file)),
  "磁盘文件应被删除"
);
assert.ok(
  !e.notesContent.includes("<!-- screenshot: " + r.file + " "),
  "删除后 notes.md 里的 caption 注释也应清除"
);

// 非法文件名拒绝
threw = false;
try { entries.deleteScreenshot("1.1", "evil.png"); } catch (ex) { threw = true; }
assert.ok(threw, "非法文件名必须拒绝");

// 清理 r2 截图,避免污染
entries.deleteScreenshot("1.1", r2.file);
entries.deleteScreenshot("1.1", jpg.file);

(async () => {
  const savedContent = await entries.saveContent("1.1", {
    ok: true,
    title: "可信正文",
    content: "这是足够长的 canonical 正文内容，用于验证条目写入不会回退到根级 content.md，并且通过质量门。",
    source: "fixture",
    authority: "readability",
  });
  assert.ok(["succeeded", "partial"].includes(savedContent.state));
  assert.match(entries.getContent("1.1"), /canonical 正文/);
  assert.strictEqual(fs.existsSync(path.join(tmpRoot, "entries", UID, "content.md")), false);
  assert.throws(() => entries.saveContent("9.9", { ok: true, content: "x" }), /未知条目/);
  const failedContent = await entries.saveContent("1.1", { ok: false, warning: "offline" });
  assert.strictEqual(failedContent.state, "partial");

  const originalData = fs.readFileSync(tmpReadme, "utf8");
  fs.writeFileSync(tmpReadme, originalData.replace(`<!-- linggan:uid=${UID} -->`, `<!-- linggan:uid=${UID} -->\n<!-- linggan:created-at=bad -->`));
  const warnedSave = entries.saveNotes("1.1", { actionItems: "有动作" });
  assert.strictEqual(warnedSave.warning, "invalid_lifecycle");
  fs.writeFileSync(tmpReadme, originalData);

  const lifecycleModule = require("./lifecycle");
  const originalApplyLifecycle = lifecycleModule.applyLifecycle;
  lifecycleModule.applyLifecycle = () => { throw new Error("generic"); };
  try { assert.strictEqual(entries.saveNotes("1.1", { conclusion: "x" }).warning, "lifecycle_update_failed"); }
  finally { lifecycleModule.applyLifecycle = originalApplyLifecycle; }

  const notesPath = entries.safePath("1.1", "notes.md");
  fs.writeFileSync(notesPath, "# Bare\n\n## Existing\ntext", "utf8");
  entries.saveNotes("1.1", { template: "invalid-template", conclusion: "补齐通用区" });
  const rebuilt = fs.readFileSync(notesPath, "utf8");
  assert.match(rebuilt, /linggan:template=general/);
  assert.match(rebuilt, /## 研究结论/);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log("entries: ALL PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
