"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
const dataFile = path.join(root, "DATA.md");
const entriesDir = path.join(root, "entries");
const UID = "77777777-7777-4777-8777-777777777777";
process.env.README_FILE = dataFile;
process.env.ENTRIES_DIR = entriesDir;
fs.writeFileSync(dataFile, `# Test
<!-- linggan:data-version=2 -->

## 1. Tools

### ⏳ 1.1 Original title
<!-- linggan:uid=${UID} -->
- **Source**: [test](https://example.com)
`, "utf-8");
fs.mkdirSync(path.join(entriesDir, UID, "screenshots"), { recursive: true });
fs.mkdirSync(path.join(entriesDir, UID, "archive", "images"), { recursive: true });
fs.writeFileSync(path.join(entriesDir, UID, "notes.md"), "original notes", "utf-8");
fs.writeFileSync(path.join(entriesDir, UID, "screenshots", "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
fs.writeFileSync(path.join(entriesDir, UID, "archive", "metadata.json"), JSON.stringify({ state: "succeeded" }), "utf-8");
fs.writeFileSync(path.join(entriesDir, UID, "archive", "content.md"), "# archived content", "utf-8");
fs.writeFileSync(path.join(entriesDir, UID, "archive", "raw.html.gz"), Buffer.from([0x1f, 0x8b, 0x08, 0x00]));
fs.writeFileSync(path.join(entriesDir, UID, "archive", "images", "cover.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 2]));
fs.writeFileSync(path.join(entriesDir, UID, "archive", "images", "inline.webp"), Buffer.from("RIFFxxxxWEBP"));
fs.writeFileSync(path.join(entriesDir, UID, "archive", "ignored.txt"), "must not be exported", "utf-8");

const backup = require("./backup");

(async () => {
  const bundle = backup.exportBundle();
  assert.strictEqual(bundle.format, "linggan-backup");
  assert.strictEqual(bundle.entries.length, 1);
  assert.strictEqual(bundle.entries[0].files.length, 7);
  assert.deepStrictEqual(bundle.entries[0].files.map(file => file.name), [
    "notes.md",
    "screenshots/shot.png",
    "archive/metadata.json",
    "archive/content.md",
    "archive/raw.html.gz",
    "archive/images/cover.png",
    "archive/images/inline.webp",
  ]);
  assert.strictEqual(backup.validateBundle(bundle).entryCount, 1);

  bundle.data = bundle.data.replace("Original title", "Restored title");
  bundle.entries[0].files.find(file => file.name === "notes.md").data = "restored notes";
  const result = await backup.importBundle(bundle);
  assert.strictEqual(result.entryCount, 1);
  assert.ok(result.backupDir);
  assert.ok(fs.readFileSync(dataFile, "utf-8").includes("Restored title"));
  assert.strictEqual(fs.readFileSync(path.join(entriesDir, UID, "notes.md"), "utf-8"), "restored notes");
  assert.strictEqual(fs.readFileSync(path.join(entriesDir, UID, "archive", "content.md"), "utf-8"), "# archived content");
  assert.deepStrictEqual(fs.readFileSync(path.join(entriesDir, UID, "archive", "images", "cover.png")), Buffer.from([0x89, 0x50, 0x4e, 0x47, 2]));
  assert.deepStrictEqual(fs.readFileSync(path.join(entriesDir, UID, "archive", "images", "inline.webp")), Buffer.from("RIFFxxxxWEBP"));

  const invalid = JSON.parse(JSON.stringify(bundle));
  invalid.entries[0].files[0].name = "../escape.txt";
  assert.throws(() => backup.validateBundle(invalid), /非法文件/);

  const invalidArchive = JSON.parse(JSON.stringify(bundle));
  invalidArchive.entries[0].files[0].name = "archive/metadata.json.bak";
  assert.throws(() => backup.validateBundle(invalidArchive), /非法文件/);

  fs.rmSync(root, { recursive: true, force: true });
  console.log("backup: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
