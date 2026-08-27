"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createBundle } = require("../../backup-format");

const UID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const TRANSACTION_ID = "33333333-3333-4333-8333-333333333333";

function dataText(title = "Original") {
  return `# Test
<!-- linggan:data-version=2 -->

## 1. Test

### ⏳ 1.1 ${title}
<!-- linggan:uid=${UID} -->
- **Source**: local
`;
}

function workspace(prefix = "trusted-recovery-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const paths = {
    data: path.join(root, "user-data", "DATA.md"),
    entries: path.join(root, "entries"),
    brainstorms: path.join(root, "brainstorms"),
    trash: path.join(root, "trash"),
    orphans: path.join(root, "orphans"),
  };
  const controlDir = path.join(root, "control", ".linggan");
  fs.mkdirSync(path.dirname(paths.data), { recursive: true });
  fs.writeFileSync(paths.data, dataText());
  for (const key of ["entries", "brainstorms", "trash", "orphans"]) fs.mkdirSync(paths[key], { recursive: true });
  fs.mkdirSync(path.join(paths.entries, UID), { recursive: true });
  fs.writeFileSync(path.join(paths.entries, UID, "notes.md"), "old notes");
  fs.writeFileSync(path.join(paths.brainstorms, "plan.md"), "old plan");
  return { root, paths, controlDir };
}

function bundle(title = "Restored", options = {}) {
  return createBundle([
    { path: "DATA.md", data: Buffer.from(dataText(title)) },
    { path: `entries/${UID}/notes.md`, data: Buffer.from(options.notes || "new notes") },
    { path: "brainstorms/plan.md", data: Buffer.from("new plan") },
    { path: "trash/record.md", data: Buffer.from("trash") },
    { path: "orphans/preserved.bin", data: Buffer.from([1, 2, 3]) },
  ], { createdAt: options.createdAt || "2026-08-14T00:00:00.000Z", appVersion: "2.2.0" });
}

function managerOptions(context, overrides = {}) {
  return {
    controlDir: context.controlDir,
    paths: context.paths,
    now: overrides.now || (() => new Date("2026-08-14T01:00:00.000Z")),
    volumeIdProvider: overrides.volumeIdProvider || (() => "fixture-volume"),
    statfs: overrides.statfs || (() => ({ bavail: 1024n * 1024n, bsize: 1024n })),
    fault: overrides.fault,
    coordinator: overrides.coordinator,
  };
}

function cleanup(context) {
  fs.rmSync(context.root, { recursive: true, force: true });
}

module.exports = { UID, REQUEST_ID, TRANSACTION_ID, bundle, cleanup, dataText, managerOptions, workspace };
