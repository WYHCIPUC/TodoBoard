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

console.log("schema: ALL PASS");
