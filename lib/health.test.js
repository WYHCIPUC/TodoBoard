"use strict";

const assert = require("assert");
const { inspectData } = require("./health");

const healthy = `# Test
<!-- linggan:data-version=2 -->

## 1. 收件箱

### ⏳ 1.1 A
<!-- linggan:uid=11111111-1111-4111-8111-111111111111 -->
- **作者 / 来源**：[Example](https://example.com/a)
`;
assert.deepStrictEqual(inspectData(healthy), {
  status: "ok",
  version: 2,
  counts: {
    entries: 1,
    duplicateIds: 0,
    missingUids: 0,
    invalidUids: 0,
    duplicateUids: 0,
    missingUrls: 0,
    invalidUrls: 0,
    duplicateUrls: 0,
  },
  issues: [],
});

const unhealthy = healthy + `
### 🔄 1.1 B
<!-- linggan:uid=11111111-1111-4111-8111-111111111111 -->
- **作者 / 来源**：[Example](https://example.com/a)

### ⏳ 1.3 C
- **研究要点**：（待补充）
`;
const result = inspectData(unhealthy);
assert.strictEqual(result.status, "error");
assert.strictEqual(result.counts.duplicateIds, 1);
assert.strictEqual(result.counts.duplicateUids, 1);
assert.strictEqual(result.counts.duplicateUrls, 1);
assert.strictEqual(result.counts.missingUids, 1);
assert.strictEqual(result.counts.missingUrls, 1);
assert.ok(result.issues.some(issue => issue.code === "duplicate_ids"));

console.log("health: ALL PASS");
