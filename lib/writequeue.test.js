"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "writequeue-test-"));
const dataFile = path.join(root, "DATA.md");
fs.writeFileSync(dataFile, "# Queue\n", "utf-8");
process.env.README_FILE = dataFile;
const store = require("./store");

(async () => {
  const jobs = [];
  for (let i = 0; i < 20; i++) {
    jobs.push(store.mutate(text => ({
      text: text + "item-" + i + "\n",
      result: i,
    })));
  }
  const results = await Promise.all(jobs);
  assert.strictEqual(results.length, 20);
  const written = fs.readFileSync(dataFile, "utf-8");
  for (let i = 0; i < 20; i++) assert.ok(written.includes("item-" + i + "\n"));

  await assert.rejects(
    store.mutate(() => { throw new Error("expected failure"); }),
    /expected failure/
  );
  await store.mutate(text => text + "after-error\n");
  assert.ok(fs.readFileSync(dataFile, "utf-8").includes("after-error"));

  const before = fs.readFileSync(dataFile, "utf-8");
  const result = await store.mutate(() => ({ write: false, result: "duplicate" }));
  assert.strictEqual(result, "duplicate");
  assert.strictEqual(fs.readFileSync(dataFile, "utf-8"), before);

  const backups = fs.readdirSync(root).filter(f => /^DATA\.backup-\d{17}(?:-\d+)?\.md$/.test(f));
  assert.strictEqual(backups.length, 5, "应保留最近 5 个独立时间戳备份");

  fs.rmSync(root, { recursive: true, force: true });
  console.log("writequeue: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
