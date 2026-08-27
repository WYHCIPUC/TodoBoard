"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const content = require("./archive-content");

const UID = "11111111-1111-4111-8111-111111111111";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "archive-content-"));
const entriesDir = path.join(root, "entries");
const runtimeDir = path.join(root, ".linggan");
fs.mkdirSync(path.join(entriesDir, UID, "archive"), { recursive: true });
fs.writeFileSync(path.join(entriesDir, UID, "archive", "content.md"), "canonical", "utf8");
fs.writeFileSync(path.join(entriesDir, UID, "content.md"), "legacy root", "utf8");
assert.strictEqual(content.readCanonicalContent(entriesDir, UID), "canonical", "reader must never fall back to root content.md");
assert.strictEqual(content.readCanonicalContent(entriesDir, "missing"), null);
assert.throws(() => content.contentPath(entriesDir, "../escape"));

const requestId = crypto.randomUUID();
const first = content.writeManualDraft({ entriesDir, runtimeDir, uid: UID, content: "manual one", requestId, now: () => new Date("2026-08-14T00:00:00.000Z") });
assert.strictEqual(first.accepted, true);
assert.strictEqual(first.operationId, requestId);
assert.strictEqual(content.writeManualDraft({ entriesDir, runtimeDir, uid: UID, content: "manual one", requestId }).draftHash, first.draftHash, "same operation replays");
assert.strictEqual(content.writeManualDraft({ entriesDir, runtimeDir, uid: UID, content: "manual one", requestId: crypto.randomUUID() }).draftHash, first.draftHash, "same content is immutable and reusable");
assert.throws(() => content.writeManualDraft({ entriesDir, runtimeDir, uid: UID, content: "different", requestId }), error => error.code === "idempotency_conflict");
const second = content.writeManualDraft({ entriesDir, runtimeDir, uid: UID, content: "manual two", requestId: crypto.randomUUID() });
assert.notStrictEqual(second.draftHash, first.draftHash);
const drafts = fs.readdirSync(path.join(entriesDir, UID, "drafts"));
assert.strictEqual(drafts.filter(name => name.endsWith(".md")).length, 2, "different content must coexist");
assert.throws(() => content.writeManualDraft({ entriesDir, runtimeDir, uid: UID, content: "", requestId: crypto.randomUUID() }));
assert.throws(() => content.writeManualDraft({ entriesDir, runtimeDir, uid: UID, content: "x", requestId: "bad" }));
const brokenBody = "broken metadata body";
const brokenHash = require("./backup-format").sha256(Buffer.from(brokenBody));
const brokenDir = path.join(entriesDir, UID, "drafts");
fs.writeFileSync(path.join(brokenDir, "manual-" + brokenHash + ".md"), brokenBody);
fs.writeFileSync(path.join(brokenDir, "manual-" + brokenHash + ".json"), JSON.stringify({ uid: "wrong", sha256: brokenHash }));
assert.throws(() => content.writeManualDraft({
  entriesDir, runtimeDir, uid: UID, content: brokenBody, requestId: crypto.randomUUID(),
  idempotency: { begin: () => ({ replay: false, receipt: { fixedNow: "2026-08-14T00:00:00.000Z" } }), commit: () => {} },
}), /写后验证失败/);

const badUid = "directory-content";
fs.mkdirSync(content.contentPath(entriesDir, badUid), { recursive: true });
assert.throws(() => content.readCanonicalContent(entriesDir, badUid), error => error.code === "unsupported_file_type");
const largeUid = "large-content";
fs.mkdirSync(path.dirname(content.contentPath(entriesDir, largeUid)), { recursive: true });
fs.writeFileSync(content.contentPath(entriesDir, largeUid), Buffer.alloc(content.MAX_CONTENT_BYTES + 1));
assert.throws(() => content.readCanonicalContent(entriesDir, largeUid), error => error.code === "bundle_too_large");

console.log("archive-content: ALL PASS");
