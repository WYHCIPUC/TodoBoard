"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT_DIR = path.join(__dirname, "..");
const FIXTURE_DIR = path.join(__dirname, "fixtures", "v2.2");
const RUNNER_PATH = path.join(ROOT_DIR, "scripts", "run-tests.js");
const INDEX_SHA256 = "a3f8513ab908d3d18eac40563a39437a93f87e6a2102d4621b933de04bd64186";
const contractTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-contracts-"));
const originalReadmeFile = process.env.README_FILE;
process.env.README_FILE = path.join(contractTempRoot, "DATA.md");

const runner = require("../scripts/run-tests");
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readFixture(relative) {
  return fs.readFileSync(path.join(FIXTURE_DIR, ...relative.split("/")));
}

function readJsonFixture(relative) {
  return JSON.parse(readFixture(relative).toString("utf8"));
}

function copyFixtureTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyFixtureTree(sourcePath, destinationPath);
    else if (entry.isFile()) fs.copyFileSync(sourcePath, destinationPath);
  }
}

function detectBundleBytes(bytes) {
  let bundle;
  try {
    bundle = JSON.parse(bytes.toString("utf8"));
  } catch (_) {
    return { valid: false, errorCode: "invalid_bundle" };
  }
  if (!bundle || bundle.format !== "linggan-backup" || !Number.isInteger(bundle.version)) {
    return { valid: false, errorCode: "invalid_bundle" };
  }
  if (bundle.version !== 1 && bundle.version !== 2) {
    return { valid: false, version: bundle.version, errorCode: "unsupported_version" };
  }
  if (bundle.version === 1) {
    const valid = typeof bundle.data === "string" && Array.isArray(bundle.entries);
    return valid ? { valid: true, format: bundle.format, version: 1 } : { valid: false, version: 1, errorCode: "invalid_bundle" };
  }
  const structurallyValid = bundle.source && bundle.source.dataVersion === 2 &&
    bundle.manifest && bundle.manifest.algorithm === "sha256" && Array.isArray(bundle.files);
  if (!structurallyValid) return { valid: false, version: 2, errorCode: "invalid_bundle" };
  const normalizedPaths = bundle.files.map(file => typeof file.path === "string" ? file.path.normalize("NFC").toLowerCase() : "");
  if (new Set(normalizedPaths).size !== normalizedPaths.length) {
    return { valid: false, version: 2, errorCode: "invalid_bundle", reason: "duplicate_path" };
  }
  return { valid: true, format: bundle.format, version: 2 };
}

function detectBundle(relative) {
  return detectBundleBytes(readFixture(relative));
}

function silentIo() {
  return { log() {}, error() {} };
}

function spawnRunner(args, readmeFile) {
  return spawnSync(process.execPath, [RUNNER_PATH, ...args], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    env: { ...process.env, README_FILE: readmeFile }
  });
}

test("contract fixture index and every listed fixture have stable immutable bytes", () => {
  assert.strictEqual(sha256(readFixture("fixtures.json")), INDEX_SHA256);
  const index = readJsonFixture("fixtures.json");
  assert.strictEqual(index.version, 1);
  assert.strictEqual(index.immutable, true);
  assert(index.fixtures.length >= 18);
  for (const fixture of index.fixtures) {
    assert(fixture.contract.length > 20, fixture.path + " must document its contract");
    assert.strictEqual(sha256(readFixture(fixture.path)), fixture.sha256, fixture.path);
  }
});

test("exact-byte fixtures disable Git line-ending conversion", () => {
  const attributes = fs.readFileSync(path.join(ROOT_DIR, ".gitattributes"), "utf8");
  assert.match(attributes, /^lib\/fixtures\/v2\.2\/\*\* -text$/m);
});

test("fixture mutation is detected only in a copied temporary directory", () => {
  const copyRoot = path.join(contractTempRoot, "fixture copy 路径 with spaces");
  copyFixtureTree(FIXTURE_DIR, copyRoot);
  const copiedBundle = path.join(copyRoot, "bundles", "valid-v2.json");
  fs.appendFileSync(copiedBundle, "mutated", "utf8");
  const expected = readJsonFixture("fixtures.json").fixtures.find(item => item.path === "bundles/valid-v2.json");
  assert.notStrictEqual(sha256(fs.readFileSync(copiedBundle)), expected.sha256);
  assert.strictEqual(sha256(readFixture(expected.path)), expected.sha256);
});

test("valid v2 fixture defines canonical format and version detection", () => {
  assert.deepStrictEqual(detectBundle("bundles/valid-v2.json"), { valid: true, format: "linggan-backup", version: 2 });
});

test("legacy v1 fixture defines supported compatibility detection", () => {
  assert.deepStrictEqual(detectBundle("bundles/legacy-v1.json"), { valid: true, format: "linggan-backup", version: 1 });
});

test("truncated write fixture is rejected as invalid_bundle", () => {
  assert.deepStrictEqual(detectBundle("bundles/truncated-v2.json"), { valid: false, errorCode: "invalid_bundle" });
});

test("malformed v2 fixture is rejected after JSON parsing", () => {
  assert.deepStrictEqual(detectBundle("bundles/malformed-v2.json"), { valid: false, version: 2, errorCode: "invalid_bundle" });
});

test("duplicate v2 path fixture is rejected deterministically", () => {
  assert.deepStrictEqual(detectBundle("bundles/duplicate-v2.json"), {
    valid: false,
    version: 2,
    errorCode: "invalid_bundle",
    reason: "duplicate_path"
  });
});

test("unknown backup version is rejected as unsupported_version", () => {
  const original = readFixture("bundles/valid-v2.json").toString("utf8");
  assert.deepStrictEqual(detectBundleBytes(Buffer.from(original.replace('"version":2', '"version":99'))), {
    valid: false,
    version: 99,
    errorCode: "unsupported_version"
  });
});

test("file and directory target manifests keep their disjoint field unions", () => {
  const file = readJsonFixture("transactions/file-target-manifest.json");
  const directory = readJsonFixture("transactions/directory-target-manifest.json");
  assert.deepStrictEqual(Object.keys(file), ["version", "transactionId", "scope", "rootType", "existed", "bytes", "sha256"]);
  assert.deepStrictEqual(Object.keys(directory), ["version", "transactionId", "scope", "rootType", "existed", "fileCount", "totalBytes", "files"]);
  assert.strictEqual(file.rootType, "file");
  assert.strictEqual(directory.rootType, "directory");
  assert.strictEqual(directory.fileCount, directory.files.length);
  assert.strictEqual(directory.totalBytes, directory.files.reduce((sum, item) => sum + item.bytes, 0));
});

test("interrupted write fixture defines a recoverable committing state", () => {
  const journal = readJsonFixture("transactions/interrupted-write.json");
  assert.strictEqual(journal.state, "committing");
  assert.strictEqual(journal.targets[0].state, "old_ready");
  assert.strictEqual(journal.terminalResult, null);
  assert(/^[a-f0-9]{64}$/.test(journal.targets[0].oldManifestSha256));
});

test("recovery candidate fixture never auto-selects a destructive action", () => {
  const fixture = readJsonFixture("transactions/recovery-candidates.json");
  const valid = fixture.candidates.filter(candidate => candidate.valid && candidate.manifestEvidence);
  assert.strictEqual(valid.length, 1);
  assert.strictEqual(fixture.expected.candidate, valid[0].name);
  assert.strictEqual(fixture.expected.automatic, false);
  assert.strictEqual(fixture.expected.requiresConfirmation, true);
});

test("lifecycle fixture freezes UTC thresholds and all attention priorities", () => {
  const fixture = readJsonFixture("lifecycle/attention-cases.json");
  assert.strictEqual(fixture.dayMilliseconds, 86400000);
  assert.deepStrictEqual(fixture.thresholdDays, { unresearched: 7, stalled: 14, defaultReview: 30 });
  assert.deepStrictEqual(Object.values(fixture.reasonPriorities), [1, 2, 3, 4, 5, 6]);
  const now = Date.parse(fixture.now);
  assert.strictEqual(now - Date.parse(fixture.entries[0].createdAt), 7 * fixture.dayMilliseconds);
  assert.strictEqual(now - Date.parse(fixture.entries[1].lastStudiedAt), 14 * fixture.dayMilliseconds);
});

test("capacity fixture freezes inclusive MiB boundaries", () => {
  const fixture = readJsonFixture("limits/capacity.json");
  assert.strictEqual(fixture.mebibyte, 1024 * 1024);
  assert.strictEqual(fixture.httpBody, 80 * fixture.mebibyte);
  assert.strictEqual(fixture.decodedBundle, 50 * fixture.mebibyte);
  assert.strictEqual(fixture.maxFiles, 5000);
  assert.strictEqual(fixture.boundaryRule, "equal_allowed_plus_one_rejected");
});

test("archive manifest hashes exact content and metadata fixture bytes", () => {
  const manifest = readJsonFixture("archive/manifest.json");
  const metadata = readJsonFixture("archive/metadata.json");
  assert.strictEqual(manifest.snapshotId, metadata.snapshotId);
  assert.strictEqual(manifest.createdAt, metadata.capture.capturedAt);
  assert.strictEqual(manifest.quality.authority, metadata.capture.authority);
  assert.strictEqual(manifest.quality.manual, metadata.capture.manual);
  for (const file of manifest.files) {
    const bytes = readFixture("archive/" + file.path);
    assert.strictEqual(bytes.length, file.bytes);
    assert.strictEqual(sha256(bytes), file.sha256);
  }
  assert.strictEqual(manifest.quality.normalizedChars, 55);
});

test("reason-code fixture freezes complete non-overloaded namespaces", () => {
  const reasons = readJsonFixture("reason-codes.json");
  assert.deepStrictEqual(reasons.attention, ["archive_blocked", "review_due", "open_action", "stalled", "unresearched", "lifecycle_missing"]);
  assert.strictEqual(new Set(reasons.archiveDamaged).size, reasons.archiveDamaged.length);
  assert(reasons.http.includes("manual_recovery_required"));
  assert(reasons.orphan.includes("downgrade_candidate"));
});

test("per-file coverage fixture fails one file while aggregate exceeds 90 percent", () => {
  const fixture = readJsonFixture("coverage-contract.json");
  const covered = fixture.files.reduce((sum, file) => sum + file.covered, 0);
  const total = fixture.files.reduce((sum, file) => sum + file.total, 0);
  const aggregate = covered / total * 100;
  assert.strictEqual(aggregate, fixture.expected.aggregatePercent);
  assert.strictEqual(aggregate >= fixture.thresholds.lines, fixture.expected.aggregatePasses);
  assert.strictEqual(fixture.files.every(file => file.covered / file.total * 100 >= fixture.thresholds.lines), fixture.expected.perFilePasses);
});

test("Node 22 and 24 are supported while missing and Node 20 are usage errors", () => {
  assert.strictEqual(runner.ensureSupportedNodeVersion("22.0.0"), 22);
  assert.strictEqual(runner.ensureSupportedNodeVersion("24.1.0"), 24);
  assert.throws(() => runner.ensureSupportedNodeVersion("20.19.0"), runner.UsageError);
  assert.throws(() => runner.ensureSupportedNodeVersion(""), runner.UsageError);
  assert.strictEqual(runner.main([], { nodeVersion: "", io: silentIo() }), runner.EXIT_USAGE);
  assert.strictEqual(runner.main([], { nodeVersion: "20.19.0", io: silentIo() }), runner.EXIT_USAGE);
});

test("runner argument parser supports repeatable explicit test selection", () => {
  const options = runner.parseArgs([
    "--test", "lib/contracts-v2.2.test.js",
    "--test-dir", "lib/scraper",
    "--allow-empty",
    "--list"
  ]);
  assert.strictEqual(options.tests.length, 1);
  assert.strictEqual(options.testDirs.length, 1);
  assert.strictEqual(options.allowEmpty, true);
  assert.strictEqual(options.list, true);
  assert.throws(() => runner.parseArgs(["--unknown"]), runner.UsageError);
  assert.throws(() => runner.parseArgs(["--test"]), runner.UsageError);
  assert.throws(() => runner.parseArgs(["--test", "../outside.test.js"]), runner.UsageError);
});

test("runner rejects duplicate and missing selections with exit code 2", () => {
  const unicodeTest = "lib/fixtures/v2.2/runner/路径 空格.test.js";
  const duplicate = spawnRunner(["--test", unicodeTest, "--test", unicodeTest], path.join(ROOT_DIR, "DATA.md"));
  const missing = spawnRunner(["--test", "lib/fixtures/v2.2/runner/missing.test.js"], "");
  assert.strictEqual(duplicate.status, runner.EXIT_USAGE, duplicate.stderr);
  assert.strictEqual(missing.status, runner.EXIT_USAGE, missing.stderr);
  assert.match(duplicate.stderr, /重复测试选择/);
  assert.match(missing.stderr, /测试文件无效/);
});

test("runner overwrites inherited or empty README_FILE for Unicode and spaced paths", () => {
  const selected = ["--test", "lib/fixtures/v2.2/runner/路径 空格.test.js"];
  const inherited = spawnRunner(selected, path.join(ROOT_DIR, "DATA.md"));
  const empty = spawnRunner(selected, "");
  assert.strictEqual(inherited.status, runner.EXIT_OK, inherited.stderr);
  assert.strictEqual(empty.status, runner.EXIT_OK, empty.stderr);
});

test("runner propagates a child crash as deterministic exit code 1", () => {
  const result = spawnRunner(["--test", "lib/fixtures/v2.2/runner/child-crash.test.js"], path.join(ROOT_DIR, "DATA.md"));
  assert.strictEqual(result.status, runner.EXIT_TEST_FAILURE, result.stderr);
  assert.match(result.stderr, /1 个测试文件失败/);
});

test("runner list output is stable and does not execute the selected child", () => {
  const result = spawnRunner(["--list", "--test", "lib/fixtures/v2.2/runner/路径 空格.test.js"], path.join(ROOT_DIR, "DATA.md"));
  assert.strictEqual(result.status, runner.EXIT_OK, result.stderr);
  assert.strictEqual(result.stdout.trim(), "lib/fixtures/v2.2/runner/路径 空格.test.js");
});

test("runner selection deduplicates directory overlap and handles empty skeleton directories", () => {
  const runnerDir = path.join(ROOT_DIR, "lib", "fixtures", "v2.2", "runner");
  const selected = runner.selectTests({ tests: [], testDirs: [runnerDir], allowEmpty: false });
  assert.deepStrictEqual(selected.map(file => path.basename(file)), ["child-crash.test.js", "路径 空格.test.js"]);
  assert.throws(() => runner.selectTests({ tests: [selected[0]], testDirs: [runnerDir], allowEmpty: false }), runner.UsageError);
  assert.deepStrictEqual(runner.selectTests({ tests: [], testDirs: [path.join(ROOT_DIR, "e2e")], allowEmpty: true }), []);
  assert.throws(() => runner.selectTests({ tests: [], testDirs: [path.join(ROOT_DIR, "e2e")], allowEmpty: false }), runner.UsageError);
});

test("runner help and direct empty execution return success without touching user data", () => {
  const messages = [];
  const io = { log(message) { messages.push(message); }, error(message) { messages.push(message); } };
  assert.strictEqual(runner.main(["--help"], { nodeVersion: "22.0.0", io }), runner.EXIT_OK);
  assert.match(messages[0], /--test/);
  const created = runner.createTestEnvironment({ README_FILE: path.join(ROOT_DIR, "DATA.md") });
  try {
    assert.strictEqual(path.dirname(created.environment.README_FILE), created.tempRoot);
    assert.notStrictEqual(path.resolve(created.environment.README_FILE), path.join(ROOT_DIR, "DATA.md"));
  } finally {
    fs.rmSync(created.tempRoot, { recursive: true, force: true });
  }
  assert.strictEqual(runner.runTestFiles([], io), runner.EXIT_OK);
});

test("package and coverage configuration freeze the T1 validation baseline", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package-lock.json"), "utf8"));
  const c8 = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, ".c8rc.json"), "utf8"));
  assert.strictEqual(packageJson.engines.node, ">=22");
  assert.strictEqual(packageLock.packages[""].engines.node, ">=22");
  assert.strictEqual(fs.readFileSync(path.join(ROOT_DIR, ".nvmrc"), "utf8").trim(), "24");
  for (const script of ["test:scrapers:fixtures", "test:e2e", "test:launcher", "coverage"]) assert(packageJson.scripts[script]);
  assert.strictEqual(packageJson.scripts["test:e2e"], "node e2e/browser-smoke.js");
  assert(!packageJson.scripts["test:e2e"].includes("--allow-empty"));
  for (const metric of ["lines", "statements", "functions", "branches"]) assert.strictEqual(c8[metric], 90);
  assert.strictEqual(c8["per-file"], true);
  for (const core of ["lib/backup.js", "lib/backup-format.js", "lib/backup-transaction.js", "lib/maintenance.js", "lib/archive-content.js", "lib/archive-quality.js", "lib/archive-integrity.js", "lib/attention.js", "lib/schema.js", "lib/store.js", "lib/archive.js", "lib/archive-queue.js", "lib/capture.js", "lib/search.js", "lib/brainstorm.js"]) {
    assert(packageJson.scripts.coverage.includes("--include=" + core), core);
  }
});

let failures = 0;
try {
  assert.notStrictEqual(path.resolve(process.env.README_FILE), path.join(ROOT_DIR, "DATA.md"));
  for (const current of tests) {
    try {
      current.fn();
      console.log("✓ " + current.name);
    } catch (error) {
      failures++;
      console.error("✗ " + current.name);
      console.error(error.stack || error.message);
    }
  }
} finally {
  if (originalReadmeFile === undefined) delete process.env.README_FILE;
  else process.env.README_FILE = originalReadmeFile;
  fs.rmSync(contractTempRoot, { recursive: true, force: true });
}

if (failures) {
  console.error("\n" + failures + " 个 v2.2 合同测试失败");
  process.exitCode = 1;
} else {
  console.log("\n✓ 全部 " + tests.length + " 个 v2.2 合同测试通过");
}
