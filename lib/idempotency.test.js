"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  IdempotencyStore,
  atomicJson,
  canonicalRequest,
  canonicalRequestHash,
  readReceipt,
  syncDirectory,
  writeFileDurable,
} = require("./idempotency");

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
];

(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "idempotency-"));
  const directory = path.join(root, "wal");
  let time = new Date("2026-08-14T00:00:00.000Z");
  const store = new IdempotencyStore(directory, { now: () => time });
  try {
    const canonical = canonicalRequest("lifecycle.update", { entryRef: "e\u0301", lifecycleAction: "complete" });
    assert.strictEqual(canonical, '{"action":"lifecycle.update","entryRef":"é","lifecycleAction":"complete","nextReviewAt":null}');
    assert.strictEqual(canonicalRequestHash("backup.commit", { transactionId: IDS[0] }).length, 64);
    assert.throws(() => canonicalRequest("unknown", {}), error => error.code === "invalid_request");
    assert.throws(() => canonicalRequest("backup.commit", { transactionId: 1 }), error => error.code === "invalid_request");
    assert.throws(() => canonicalRequest("lifecycle.update", { nextReviewAt: "bad" }), error => error.code === "invalid_timestamp");

    const begun = store.begin({
      requestId: IDS[0], action: "backup.commit", values: { transactionId: IDS[1] },
      beforeFingerprint: "before", afterFingerprint: "after", domainRef: IDS[1],
    });
    assert.strictEqual(begun.created, true);
    assert.strictEqual(begun.receipt.state, "pending");
    assert.strictEqual(store.get(IDS[4]), null);
    const duplicate = store.begin({ requestId: IDS[0], action: "backup.commit", values: { transactionId: IDS[1] } });
    assert.strictEqual(duplicate.created, false);
    assert.strictEqual(duplicate.replay, false);
    assert.throws(() => store.begin({ requestId: IDS[0], action: "backup.commit", values: { transactionId: IDS[2] } }), error => error.code === "idempotency_conflict");
    const committed = store.commit(IDS[0], 200, { ok: true, transactionId: IDS[1] }, new Date("2026-08-14T00:01:00.000Z"));
    assert.strictEqual(committed.state, "committed");
    assert.deepStrictEqual(store.commit(IDS[0], 500, { ok: false }), committed);
    assert.strictEqual(store.begin({ requestId: IDS[0], action: "backup.commit", values: { transactionId: IDS[1] } }).replay, true);
    assert.throws(() => store.commit(IDS[0], 200, { confirmationToken: "secret" }), error => error.code === "invalid_request");
    const cyclic = {}; cyclic.self = cyclic;
    assert.throws(() => store.commit(IDS[0], 200, cyclic), error => error.code === "invalid_request");

    store.begin({ requestId: IDS[1], action: "backup.cancel", values: { transactionId: IDS[2] }, beforeFingerprint: "a", afterFingerprint: "b" });
    store.begin({ requestId: IDS[2], action: "backup.cancel", values: { transactionId: IDS[3] }, beforeFingerprint: "c", afterFingerprint: "d" });
    const reconciled = store.reconcile(receipt => receipt.requestId === IDS[1]
      ? { fingerprint: "b", httpStatus: 200, response: { ok: true } }
      : { fingerprint: "c" });
    assert.deepStrictEqual(reconciled, { committed: 1, retryable: 1, blocked: [] });
    assert.strictEqual(store.get(IDS[1]).state, "committed");
    assert.strictEqual(store.get(IDS[2]).state, "pending");
    assert.throws(() => store.reconcile(() => ({ fingerprint: "unknown" })), error => error.code === "idempotency_recovery_required");
    const absent = new IdempotencyStore(path.join(root, "absent"));
    assert.deepStrictEqual(absent.reconcile(() => ({})), { committed: 0, retryable: 0, blocked: [] });
    assert.deepStrictEqual(absent.prune(), []);
    const nullable = store.begin({ requestId: IDS[5], action: "backup.cancel", values: { transactionId: IDS[0] } });
    assert.strictEqual(nullable.created, true);
    assert.strictEqual(store.commit(IDS[5], 200, null).response, null);

    time = new Date("2026-08-22T00:00:00.000Z");
    const removed = store.prune({ max: 1, now: time.getTime(), ageMs: 1 });
    assert.ok(removed.includes(IDS[0]) || removed.includes(IDS[1]));
    assert.strictEqual(store.get(IDS[2]).state, "pending");

    assert.throws(() => store.fileFor("bad"), error => error.code === "invalid_request");
    const custom = path.join(root, "custom.json");
    atomicJson(custom, { ok: true }, { exclusive: true });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(custom, "utf8")), { ok: true });
    assert.throws(() => atomicJson(custom, { ok: false }, { exclusive: true }), error => ["EEXIST", "EPERM"].includes(error.code));
    fs.writeFileSync(path.join(directory, IDS[4] + ".json"), "{}");
    assert.throws(() => readReceipt(path.join(directory, IDS[4] + ".json")), error => error.code === "idempotency_recovery_required");
    const invalidTimeId = "77777777-7777-4777-8777-777777777777";
    assert.throws(() => store.begin({ requestId: invalidTimeId, action: "backup.commit", values: { transactionId: IDS[1] }, fixedNow: { toISOString: () => "bad" } }), error => error.code === "invalid_timestamp");

    const api = overrides => ({
      openSync: fs.openSync.bind(fs),
      writeSync: fs.writeSync.bind(fs),
      fsyncSync: fs.fsyncSync.bind(fs),
      closeSync: fs.closeSync.bind(fs),
      ...overrides,
    });
    const shortFile = path.join(root, "short-write.bin");
    assert.throws(() => writeFileDurable(shortFile, Buffer.from("payload"), { fs: api({ writeSync: () => 0 }) }), /short write/);
    const fullFile = path.join(root, "disk-full.bin");
    assert.throws(() => writeFileDurable(fullFile, Buffer.from("payload"), { fs: api({
      writeSync: () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); },
    }) }), error => error.code === "ENOSPC");
    const fsyncFile = path.join(root, "fsync-failure.bin");
    assert.throws(() => writeFileDurable(fsyncFile, Buffer.from("payload"), { fs: api({
      fsyncSync: () => { throw Object.assign(new Error("fsync failed"), { code: "EIO" }); },
    }) }), error => error.code === "EIO");
    const directoryApi = api({ fsyncSync: () => { throw Object.assign(new Error("directory fsync unsupported"), { code: "EPERM" }); } });
    assert.throws(() => syncDirectory(root, { fs: directoryApi, requireSupported: true }), error => error.code === "EPERM");
    if (process.platform === "win32") assert.strictEqual(syncDirectory(root, { fs: directoryApi }), false);

    const corruptCommitted = path.join(root, "corrupt-committed.json");
    const validReceipt = store.get(IDS[5]);
    fs.writeFileSync(corruptCommitted, JSON.stringify({ ...validReceipt, completedAt: null }));
    assert.throws(() => readReceipt(corruptCommitted), error => error.code === "idempotency_recovery_required");

    const futureDirectory = path.join(root, "future");
    const futureStore = new IdempotencyStore(futureDirectory, { now: () => new Date("2026-08-14T00:00:00.000Z") });
    futureStore.begin({ requestId: IDS[4], action: "backup.cancel", values: { transactionId: IDS[0] } });
    futureStore.commit(IDS[4], 200, { ok: true }, new Date("2030-01-01T00:00:00.000Z"));
    assert.deepStrictEqual(futureStore.prune({ now: Date.parse("2026-08-14T00:00:00.000Z"), ageMs: 0 }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("idempotency: ALL PASS");
})();
