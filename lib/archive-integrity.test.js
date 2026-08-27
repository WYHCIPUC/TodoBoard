"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sha256 } = require("./backup-format");
const { assessCandidate } = require("./archive-quality");
const integrity = require("./archive-integrity");

const UID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = "123e4567-e89b-42d3-a456-426614174000";
const CREATED = "2026-08-14T00:00:00.000Z";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "integrity-"));
const entryDir = path.join(root, UID);
const archiveDir = path.join(entryDir, "archive");
fs.mkdirSync(archiveDir, { recursive: true });
const content = "# 标题\n\n这是足够长的归档正文，用来验证完全离线的大小、摘要、结构和正文质量检查不会访问来源站点。";
const quality = assessCandidate({ content, title: "标题", authority: "official_raw", captureState: "succeeded" });
const metadata = {
  archiveSchemaVersion: 2,
  snapshotId: SNAPSHOT,
  entry: { uid: UID, id: "1.1", url: "https://example.invalid", title: "标题" },
  capture: { state: "succeeded", authority: "official_raw", manual: false, capturedAt: CREATED, source: "fixture" },
  migrationWarnings: [],
};
const metadataBytes = Buffer.from(JSON.stringify(metadata));
const contentBytes = Buffer.from(content);
fs.writeFileSync(path.join(archiveDir, "content.md"), contentBytes);
fs.writeFileSync(path.join(archiveDir, "metadata.json"), metadataBytes);
const manifest = {
  version: 1,
  snapshotId: SNAPSHOT,
  createdAt: CREATED,
  quality: { manual: false, authority: "official_raw", state: quality.state, normalizedChars: quality.normalizedChars },
  files: [
    { path: "content.md", bytes: contentBytes.length, sha256: sha256(contentBytes), provenance: "fresh" },
    { path: "metadata.json", bytes: metadataBytes.length, sha256: sha256(metadataBytes), provenance: "fresh" },
  ],
};
const manifestBytes = Buffer.from(integrity.canonicalManifest(manifest));
fs.writeFileSync(path.join(archiveDir, "manifest.json"), manifestBytes);

let checked = integrity.validateArchiveDirectory(archiveDir, { uid: UID });
assert.strictEqual(checked.valid, true);
assert.strictEqual(checked.manifestHash, sha256(manifestBytes));
assert.strictEqual(integrity.scanArchive(entryDir, { uid: UID }).state, "unchecked");
checked = integrity.scanArchive(entryDir, { uid: UID, verify: true, now: CREATED });
assert.strictEqual(checked.state, "healthy");
assert.strictEqual(integrity.scanArchive(entryDir, { uid: UID, cache: { ...checked, uid: UID } }).state, "healthy");

fs.appendFileSync(path.join(archiveDir, "content.md"), "tampered");
checked = integrity.scanArchive(entryDir, { uid: UID, verify: true, now: CREATED });
assert.strictEqual(checked.state, "damaged");
assert.ok(checked.reasonCodes.includes("checksum_mismatch"));
fs.writeFileSync(path.join(archiveDir, "content.md"), contentBytes);
const restoredMetadataBytes = fs.readFileSync(path.join(archiveDir, "metadata.json"));
fs.unlinkSync(path.join(archiveDir, "metadata.json"));
assert.ok(integrity.validateArchiveDirectory(archiveDir, { uid: UID }).reasonCodes.includes("missing"));
fs.writeFileSync(path.join(archiveDir, "metadata.json"), restoredMetadataBytes);
fs.writeFileSync(path.join(archiveDir, "extra.txt"), "x");
assert.ok(integrity.validateArchiveDirectory(archiveDir, { uid: UID }).reasonCodes.includes("unexpected_file"));
fs.unlinkSync(path.join(archiveDir, "extra.txt"));
fs.unlinkSync(path.join(archiveDir, "manifest.json"));
assert.strictEqual(integrity.scanArchive(entryDir, { uid: UID }).state, "damaged", "v2 metadata proves missing manifest is damage");

const legacy = path.join(root, "legacy");
fs.mkdirSync(path.join(legacy, "archive"), { recursive: true });
fs.writeFileSync(path.join(legacy, "archive", "content.md"), content);
assert.strictEqual(integrity.scanArchive(legacy).state, "unverified");
assert.strictEqual(integrity.scanArchive(legacy, { expectedV2: true }).state, "damaged");
assert.strictEqual(integrity.scanArchive(path.join(root, "absent")).state, "not_archived");
assert.strictEqual(integrity.validateManifestShape({}), false);
assert.strictEqual(integrity.validateMetadata({}), false);
const clone = value => JSON.parse(JSON.stringify(value));
for (const mutate of [
  value => { value.version = 2; },
  value => { value.snapshotId = value.snapshotId.toUpperCase(); },
  value => { value.createdAt = "bad"; },
  value => { delete value.quality.manual; },
  value => { value.quality.manual = "false"; },
  value => { value.quality.authority = "bad"; },
  value => { value.quality.state = "bad"; },
  value => { value.quality.normalizedChars = -1; },
  value => { value.files = []; },
  value => { delete value.files[0].bytes; },
  value => { value.files[0].path = "../escape"; },
  value => { value.files[0].path = "manifest.json"; },
  value => { value.files[1].path = value.files[0].path; },
  value => { value.files.reverse(); },
  value => { value.files[0].bytes = -1; },
  value => { value.files[0].sha256 = "bad"; },
  value => { value.files[0].provenance = "bad"; },
  value => { value.files = value.files.filter(file => file.path !== "content.md"); },
  value => { value.files = value.files.filter(file => file.path !== "metadata.json"); },
]) {
  const value = clone(manifest);
  mutate(value);
  assert.strictEqual(integrity.validateManifestShape(value), false);
}
for (const mutate of [
  value => { value.archiveSchemaVersion = 1; },
  value => { delete value.entry.id; },
  value => { delete value.capture.source; },
  value => { value.capture.state = "bad"; },
  value => { value.capture.authority = "bad"; },
  value => { value.capture.manual = "false"; },
  value => { value.capture.capturedAt = "bad"; },
  value => { value.capture.source = "x".repeat(201); },
  value => { value.migrationWarnings = "bad"; },
  value => { value.migrationWarnings = ["bad"]; },
  value => { value.migrationWarnings = ["legacy_content_unusable", "legacy_content_conflict"]; },
  value => { value.entry.title = 1; },
]) {
  const value = clone(metadata);
  mutate(value);
  assert.strictEqual(integrity.validateMetadata(value), false);
}
assert.deepStrictEqual(integrity.validateArchiveDirectory(path.join(root, "missing-dir")).reasonCodes, ["missing"]);
const fileRoot = path.join(root, "file-root");
fs.writeFileSync(fileRoot, "x");
assert.deepStrictEqual(integrity.validateArchiveDirectory(fileRoot).reasonCodes, ["unsupported_file_type"]);
const badManifestRoot = path.join(root, "bad-manifest");
fs.mkdirSync(badManifestRoot);
fs.writeFileSync(path.join(badManifestRoot, "manifest.json"), "not-json");
assert.deepStrictEqual(integrity.validateArchiveDirectory(badManifestRoot).reasonCodes, ["invalid_manifest"]);
const manifestDirectoryRoot = path.join(root, "manifest-directory");
fs.mkdirSync(path.join(manifestDirectoryRoot, "manifest.json"), { recursive: true });
assert.deepStrictEqual(integrity.validateArchiveDirectory(manifestDirectoryRoot).reasonCodes, ["unsupported_file_type"]);

function invalidArtifact(relative, bytes) {
  const directory = path.join(root, "artifact-" + crypto.randomUUID());
  fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
  fs.writeFileSync(path.join(directory, "content.md"), contentBytes);
  fs.writeFileSync(path.join(directory, "metadata.json"), metadataBytes);
  fs.writeFileSync(path.join(directory, relative), bytes);
  const artifactManifest = {
    ...manifest,
    files: [
      { path: "content.md", bytes: contentBytes.length, sha256: sha256(contentBytes), provenance: "fresh" },
      { path: "metadata.json", bytes: metadataBytes.length, sha256: sha256(metadataBytes), provenance: "fresh" },
      { path: relative, bytes: bytes.length, sha256: sha256(bytes), provenance: "fresh" },
    ].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))),
  };
  fs.writeFileSync(path.join(directory, "manifest.json"), integrity.canonicalManifest(artifactManifest));
  return integrity.validateArchiveDirectory(directory, { uid: UID });
}
assert.ok(invalidArtifact("raw.html.gz", Buffer.from("not-gzip")).reasonCodes.includes("unsupported_file_type"));
assert.ok(invalidArtifact("images/fake.png", Buffer.from("not-png")).reasonCodes.includes("unsupported_file_type"));
assert.ok(invalidArtifact("attachments/file.bin", Buffer.from("x")).reasonCodes.includes("unsupported_file_type"));

function bundleCase(mutator, options = { uid: UID }) {
  const directory = path.join(root, "bundle-" + crypto.randomUUID());
  fs.mkdirSync(directory);
  let body = contentBytes;
  const meta = clone(metadata);
  const bundleManifest = clone(manifest);
  mutator({ meta, manifest: bundleManifest, setBody: value => { body = Buffer.from(value); } });
  const metaBytes = Buffer.from(JSON.stringify(meta));
  fs.writeFileSync(path.join(directory, "content.md"), body);
  fs.writeFileSync(path.join(directory, "metadata.json"), metaBytes);
  bundleManifest.files = [
    { path: "content.md", bytes: body.length, sha256: sha256(body), provenance: "fresh" },
    { path: "metadata.json", bytes: metaBytes.length, sha256: sha256(metaBytes), provenance: "fresh" },
  ];
  fs.writeFileSync(path.join(directory, "manifest.json"), integrity.canonicalManifest(bundleManifest));
  return integrity.validateArchiveDirectory(directory, options);
}
assert.deepStrictEqual(bundleCase(({ meta }) => { meta.snapshotId = crypto.randomUUID(); }).reasonCodes, ["invalid_manifest"]);
assert.deepStrictEqual(bundleCase(({ meta }) => { meta.capture.capturedAt = "2026-08-15T00:00:00.000Z"; }).reasonCodes, ["invalid_manifest"]);
assert.deepStrictEqual(bundleCase(() => {}, { uid: "wrong" }).reasonCodes, ["invalid_manifest"]);
assert.deepStrictEqual(bundleCase(() => {}, { snapshotId: crypto.randomUUID() }).reasonCodes, ["invalid_manifest"]);
assert.deepStrictEqual(bundleCase(({ meta }) => { meta.capture.manual = true; }).reasonCodes, ["invalid_manifest"]);
assert.deepStrictEqual(bundleCase(({ manifest: value }) => { value.quality.normalizedChars++; }).reasonCodes, ["invalid_manifest"]);
assert.deepStrictEqual(bundleCase(({ setBody }) => setBody(Buffer.from([0xff, 0xfe]))).reasonCodes, ["invalid_manifest"]);
assert.ok(crypto.randomUUID());

console.log("archive-integrity: ALL PASS");
