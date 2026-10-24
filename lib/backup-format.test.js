"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const format = require("./backup-format");
const { UID, dataText } = require("./fixtures/recovery/helpers");

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", "v2.2", "bundles", name));
}

function expectCode(work, code) {
  assert.throws(work, error => error.code === code);
}

(() => {
  const parsed = format.parseBundle(fixture("valid-v2.json"));
  assert.strictEqual(parsed.bundle.version, 2);
  assert.strictEqual(parsed.hash.length, 64);
  assert.strictEqual(format.serializeBundle(parsed.bundle), fixture("valid-v2.json").toString("utf8").trim());
  expectCode(() => format.parseBundle(fixture("malformed-v2.json")), "invalid_timestamp");
  expectCode(() => format.parseBundle(fixture("duplicate-v2.json")), "invalid_bundle");
  expectCode(() => format.parseBundle(fixture("truncated-v2.json")), "invalid_bundle");

  const gzip = zlib.gzipSync(Buffer.from("raw html"));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
  const files = [
    { path: "DATA.md", data: Buffer.from(dataText()) },
    { path: `entries/${UID}/archive/raw.html.gz`, data: gzip },
    { path: `entries/${UID}/screenshots/a.png`, data: png },
    { path: `entries/${UID}/notes.md`, data: Buffer.from("notes") },
  ];
  const bundle = format.createBundle(files, { createdAt: "2026-08-14T00:00:00.000Z" });
  assert.strictEqual(bundle.source.appVersion, require("../package.json").version, "默认 appVersion 必须来自当前产品版本");
  assert.strictEqual(format.parseBundle(bundle).decoded.length, 4);
  assert.strictEqual(bundle.files.find(file => file.path.endsWith(".gz")).uncompressedBytes, 8);
  assert.deepStrictEqual(Object.keys(JSON.parse(format.serializeBundle(bundle))), ["format", "version", "createdAt", "source", "manifest", "files"]);
  const metadata = { ...bundle, ignored: true, source: { ...bundle.source, ignored: true }, manifest: { ...bundle.manifest, ignored: true } };
  assert.strictEqual(format.parseBundle(metadata).bundle.ignored, undefined);

  const badVersion = { ...bundle, version: 3 };
  expectCode(() => format.parseBundle(badVersion), "unsupported_version");
  expectCode(() => format.parseBundle(null), "invalid_bundle");
  expectCode(() => format.parseBundle(Buffer.alloc(format.LIMITS.httpBody + 1)), "bundle_too_large");
  expectCode(() => format.parseBundle(Buffer.from([0xff])), "invalid_bundle");
  expectCode(() => format.normalizeVirtualPath("../x"), "invalid_path");
  expectCode(() => format.normalizeVirtualPath(null), "invalid_path");
  expectCode(() => format.normalizeVirtualPath("x".repeat(1025)), "invalid_path");
  expectCode(() => format.normalizeVirtualPath("a\u0001b"), "invalid_path");
  expectCode(() => format.normalizeVirtualPath("a\\b"), "invalid_path");
  expectCode(() => format.normalizeVirtualPath("CON.txt"), "invalid_path");
  expectCode(() => format.normalizeVirtualPath("bad./x"), "invalid_path");
  expectCode(() => format.normalizeVirtualPath("a/" + "x".repeat(121)), "invalid_path");
  expectCode(() => format.strictBase64("YQ="), "invalid_bundle");
  assert.deepStrictEqual(format.strictBase64("YQ=="), Buffer.from("a"));
  expectCode(() => format.fatalUtf8(Buffer.from([0xff])), "invalid_bundle");
  assert.strictEqual(format.isCanonicalUtc("2026-08-14T00:00:00.000Z"), true);
  assert.strictEqual(format.isCanonicalUtc("2026-08-14T00:00:00Z"), false);

  const mutate = callback => {
    const copy = JSON.parse(JSON.stringify(bundle));
    callback(copy);
    return copy;
  };
  expectCode(() => format.parseBundle(mutate(copy => { copy.createdAt = "bad"; })), "invalid_timestamp");
  expectCode(() => format.validateV2({}), "invalid_bundle");
  expectCode(() => format.validateV2({ ...bundle, format: "other" }), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => { copy.source.dataVersion = 3; })), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => { copy.source.appVersion = "not-semver"; })), "invalid_bundle");
  expectCode(() => format.createBundle(files, { createdAt: "2026-08-14T00:00:00.000Z", appVersion: "" }), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => { copy.manifest.scopes = ["data"]; })), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => { copy.manifest.fileCount++; })), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => { copy.files = "bad"; })), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => { copy.manifest.totalBytes++; })), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => { copy.files[0].sha256 = "0".repeat(64); })), "checksum_mismatch");
  expectCode(() => format.parseBundle(mutate(copy => { copy.files[0].bytes++; })), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => { copy.files[0].encoding = "utf8"; })), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => { copy.files[0].extra = true; })), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => { copy.files.reverse(); })), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => { copy.files = copy.files.filter(file => file.path !== "DATA.md"); copy.manifest.fileCount--; copy.manifest.totalBytes -= bundle.files.find(file => file.path === "DATA.md").bytes; })), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => {
    const file = copy.files.find(item => item.path.endsWith("a.png"));
    file.data = Buffer.from("bad").toString("base64"); file.bytes = 3; file.sha256 = format.sha256(Buffer.from("bad"));
    copy.manifest.totalBytes = copy.files.reduce((sum, item) => sum + item.bytes, 0);
  })), "invalid_bundle");
  expectCode(() => format.parseBundle(mutate(copy => {
    const json = Buffer.from("{");
    copy.files.push({ path: `entries/${UID}/archive/metadata.json`, encoding: "base64", bytes: json.length, sha256: format.sha256(json), data: json.toString("base64") });
    copy.files.sort((a, b) => format.compareUtf8(a.path, b.path)); copy.manifest.fileCount++; copy.manifest.totalBytes += json.length;
  })), "invalid_bundle");
  expectCode(() => format.createBundle([{ path: "DATA.md", data: Buffer.from("no marker") }], { createdAt: "2026-08-14T00:00:00.000Z" }), "invalid_bundle");
  expectCode(() => format.createBundle([
    { path: "DATA.md", data: Buffer.from(dataText()) },
    { path: "runtime/queue.json", data: Buffer.from("{}") },
  ], { createdAt: "2026-08-14T00:00:00.000Z" }), "invalid_path");
  expectCode(() => format.createBundle([
    { path: "DATA.md", data: Buffer.from(dataText()) },
    { path: "entries/99999999-9999-4999-8999-999999999999/notes.md", data: Buffer.from("x") },
  ], { createdAt: "2026-08-14T00:00:00.000Z" }), "invalid_bundle");
  expectCode(() => format.createBundle([
    { path: "DATA.md", data: Buffer.from(dataText()) },
    { path: `entries/${UID}/archive/raw.html.gz`, data: Buffer.from("bad gzip") },
  ], { createdAt: "2026-08-14T00:00:00.000Z" }), "invalid_bundle");
  const moreImages = format.createBundle([
    { path: "DATA.md", data: Buffer.from(dataText()) },
    { path: `entries/${UID}/archive/images/a.jpg`, data: Buffer.from([0xff, 0xd8, 0xff]) },
    { path: `entries/${UID}/archive/images/b.gif`, data: Buffer.from("GIF89a") },
    { path: `entries/${UID}/archive/images/c.webp`, data: Buffer.from("RIFFxxxxWEBP") },
  ], { createdAt: "2026-08-14T00:00:00.000Z" });
  assert.strictEqual(moreImages.files.length, 4);
  expectCode(() => format.createBundle([
    { path: "DATA.md", data: Buffer.from(dataText()) },
    { path: `entries/${UID}/screenshots/large.png`, data: Buffer.alloc(format.LIMITS.screenshot + 1, 1) },
  ], { createdAt: "2026-08-14T00:00:00.000Z" }), "bundle_too_large");
  expectCode(() => format.parseBundle(mutate(copy => {
    const file = copy.files.find(item => item.path.endsWith(".gz")); file.uncompressedBytes++;
  })), "invalid_bundle");

  const legacy = JSON.parse(fixture("legacy-v1.json"));
  const legacyParsed = format.parseBundle(legacy, { createdAt: "2026-08-14T00:00:00.000Z" });
  assert.strictEqual(legacyParsed.legacy, true);
  assert.strictEqual(legacyParsed.bundle.version, 2);
  assert.strictEqual(format.parseBundle({ ...legacy, ignored: true }, { createdAt: "2026-08-14T00:00:00.000Z" }).legacy, true);
  const legacyFull = {
    format: "linggan-backup", version: 1, data: dataText(), entries: [{ uid: UID, id: "1.1", files: [
      { name: "notes.md", encoding: "utf8", data: "legacy notes" },
      { name: "screenshots/a.png", encoding: "base64", data: png.toString("base64") },
    ] }],
  };
  assert.strictEqual(format.parseBundle(legacyFull, { createdAt: "2026-08-14T00:00:00.000Z" }).decoded.length, 3);
  const corruptLegacy = {
    ...legacyFull,
    entries: [{ uid: UID, files: [
      { name: "content.md", encoding: "utf8", data: "legacy body" },
      { name: "archive/metadata.json", encoding: "utf8", data: "{" },
      { name: "archive/images/opaque.bin", encoding: "base64", data: Buffer.from([1, 2, 3]).toString("base64") },
    ] }],
  };
  const isolated = format.parseBundle(corruptLegacy, { createdAt: "2026-08-14T00:00:00.000Z" });
  assert.ok(isolated.decoded.some(file => file.path === `entries/${UID}/archive/content.md`));
  assert.ok(!isolated.decoded.some(file => file.path === `entries/${UID}/content.md`));
  assert.strictEqual(isolated.decoded.filter(file => /orphans\/unclassified\/.+\/payload\.bin$/.test(file.path)).length, 2);
  assert.strictEqual(isolated.warnings.filter(item => item.code === "corrupt_v1_artifact").length, 2);
  const orphanMissingPair = JSON.parse(JSON.stringify(isolated.bundle));
  const removedOrphan = orphanMissingPair.files.findIndex(file => /orphans\/unclassified\/.+\/payload\.bin$/.test(file.path));
  orphanMissingPair.manifest.totalBytes -= orphanMissingPair.files[removedOrphan].bytes;
  orphanMissingPair.manifest.fileCount--;
  orphanMissingPair.files.splice(removedOrphan, 1);
  expectCode(() => format.parseBundle(orphanMissingPair), "invalid_bundle");
  expectCode(() => format.parseBundle({ ...legacyFull, entries: [legacyFull.entries[0], legacyFull.entries[0]] }), "invalid_bundle");
  expectCode(() => format.parseBundle({ ...legacyFull, entries: [{ ...legacyFull.entries[0], extra: true }] }), "invalid_bundle");
  expectCode(() => format.parseBundle({ ...legacyFull, entries: [{ ...legacyFull.entries[0], files: [{ name: "../x", encoding: "utf8", data: "x" }] }] }), "invalid_bundle");
  expectCode(() => format.parseBundle({ ...legacyFull, entries: [{ ...legacyFull.entries[0], files: [{ name: "notes.md", encoding: "base64", data: "eA==" }] }] }), "invalid_bundle");
  expectCode(() => format.parseBundle({ ...legacyFull, entries: [{ ...legacyFull.entries[0], files: [legacyFull.entries[0].files[0], legacyFull.entries[0].files[0]] }] }), "invalid_bundle");
  expectCode(() => format.validateV1({}), "invalid_bundle");
  expectCode(() => format.validateV1({ ...legacyFull, data: "\ud800" }), "invalid_bundle");
  expectCode(() => format.parseBundle({ ...legacyFull, entries: [{ ...legacyFull.entries[0], files: [{ name: "notes.md", encoding: "utf8", data: "\ud800" }] }] }), "invalid_bundle");

  console.log("backup-format: ALL PASS");
})();
