"use strict";
const assert = require("assert");
const schema = require("./schema");

const UID1 = "11111111-1111-4111-8111-111111111111";
const UID2 = "22222222-2222-4222-8222-222222222222";
const legacy = `# Test

## 1. AI 工具

### ⏳ 1.1 第一条
- **作者 / 来源**：[测试](https://example.com/a#part)

### ✅ 1.2 第二条
- **作者 / 来源**：[测试](https://example.com/b)
`;

let next = 0;
const migrated = schema.migrateText(legacy, () => [UID1, UID2][next++]);
assert.strictEqual(migrated.fromVersion, 1);
assert.strictEqual(migrated.toVersion, 2);
assert.strictEqual(migrated.mapping.length, 2);
assert.ok(migrated.text.includes("<!-- linggan:data-version=2 -->"));
assert.ok(migrated.text.includes("<!-- linggan:uid=" + UID1 + " -->"));
assert.strictEqual(schema.getDataVersion(migrated.text), 2);
assert.strictEqual(schema.getDataVersion(), 1);

const entries = schema.scanEntries(migrated.text);
assert.strictEqual(entries[0].uid, UID1);
assert.strictEqual(entries[0].fields["作者 / 来源"], "[测试](https://example.com/a#part)");
assert.strictEqual(entries[1].uid, UID2);
assert.strictEqual(schema.storageKey(migrated.text, "1.1"), UID1);
assert.strictEqual(schema.findEntry(migrated.text, UID2).id, "1.2");
assert.strictEqual(schema.findDuplicateUrl(migrated.text, "https://example.com/a").id, "1.1");

const again = schema.migrateText(migrated.text, () => { throw new Error("不应生成新 UID"); });
assert.strictEqual(again.changed, false, "迁移应幂等");
assert.strictEqual(again.text, migrated.text);

const duplicateUid = migrated.text.replace(UID2, UID1);
assert.throws(() => schema.migrateText(duplicateUid), /UID 重复/);
assert.throws(
  () => schema.migrateText("# T\n<!-- linggan:data-version=99 -->\n"),
  /版本过新/
);

assert.strictEqual(schema.normalizeUrl("https://EXAMPLE.com/#x"), "https://example.com/");
assert.strictEqual(schema.normalizeUrl("javascript:alert(1)"), "");
assert.strictEqual(schema.normalizeUrl("https://example.com/path#hash"), "https://example.com/path");
assert.strictEqual(schema.findEntry(migrated.text, "missing"), null);
assert.strictEqual(schema.storageKey(migrated.text, "missing"), "missing");
assert.strictEqual(schema.findDuplicateUrl(migrated.text, "bad"), null);
assert.throws(() => schema.validateData(legacy), /版本必须/);
assert.strictEqual(schema.validateData("# Data\n<!-- linggan:data-version=2 -->\n### ⏳ 1.1 No uid\n", { requireUid: false }).entries.length, 1);
assert.throws(() => schema.validateEntries([{ id: "1.1", uid: "bad" }], true), /UID 非法/);
assert.throws(() => schema.validateEntries([{ id: "1.1", uid: "" }], true), /缺少稳定 UID/);
assert.strictEqual(schema.validateEntries([{ id: "1.1", uid: "" }], false), true);
assert.throws(() => schema.validateEntries([{ id: "1.1", uid: UID1 }, { id: "1.1", uid: UID2 }], true), /编号重复/);
const lifecycleText = migrated.text.replace("<!-- linggan:uid=" + UID1 + " -->", `<!-- linggan:uid=${UID1} -->\n<!-- linggan:created-at=bad -->\n<!-- linggan:created-at=2026-01-01T00:00:00.000Z -->\n<!-- linggan:created-at=2026-02-01T00:00:00.000Z -->\n<!-- linggan:last-studied-at=broken`);
const lifecycleEntry = schema.findEntry(lifecycleText, "1.1");
assert.ok(lifecycleEntry.lifecycleDiagnostics.some(item => item.code === "duplicate_lifecycle"));
assert.ok(lifecycleEntry.lifecycleDiagnostics.some(item => item.code === "invalid_lifecycle"));
assert.throws(() => schema.migrateText("# T\n### ⏳ 1.1 Bad\n<!-- linggan:uid=bad marker -->\n"), /标记格式错误|UID 非法/);
const crlf = schema.migrateText("# T\r\n### ⏳ 1.1 A\r\n", () => UID1);
assert.ok(crlf.text.includes("\r\n"));
const noTitle = schema.migrateText("### ⏳ 1.1 A\n", () => UID1);
assert.ok(noTitle.text.startsWith("<!-- linggan:data-version=2 -->"));

console.log("schema: ALL PASS");
