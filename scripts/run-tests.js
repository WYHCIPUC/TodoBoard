// 跨平台测试聚合：提供确定性选择、隔离数据路径并传播子进程失败。
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const EXIT_OK = 0;
const EXIT_TEST_FAILURE = 1;
const EXIT_USAGE = 2;
const MINIMUM_NODE_MAJOR = 22;

class UsageError extends Error {}

function comparePaths(left, right) {
  const a = left.split(path.sep).join("/");
  const b = right.split(path.sep).join("/");
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseNodeMajor(version) {
  const match = /^(\d+)\./.exec(version || "");
  if (!match) throw new UsageError("无法确定 Node.js 版本");
  return Number(match[1]);
}

function ensureSupportedNodeVersion(version) {
  const major = parseNodeMajor(version);
  if (major < MINIMUM_NODE_MAJOR) {
    throw new UsageError("需要 Node.js 22 或更高版本，当前为 " + version);
  }
  return major;
}

function resolveInsideRoot(value, label) {
  const resolved = path.resolve(ROOT_DIR, value);
  const relative = path.relative(ROOT_DIR, resolved);
  if (relative === "" || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new UsageError(label + " 必须位于仓库内: " + value);
  }
  return resolved;
}

function parseArgs(argv) {
  const options = { tests: [], testDirs: [], allowEmpty: false, list: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--test" || arg === "--test-dir") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new UsageError(arg + " 需要路径参数");
      const target = resolveInsideRoot(value, arg);
      const collection = arg === "--test" ? options.tests : options.testDirs;
      if (collection.includes(target)) throw new UsageError("重复测试选择: " + value);
      collection.push(target);
    } else if (arg === "--allow-empty") {
      options.allowEmpty = true;
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new UsageError("未知参数: " + arg);
    }
  }
  return options;
}

function discoverDirectory(directory, recursive) {
  if (!fs.existsSync(directory)) return [];
  if (!fs.statSync(directory).isDirectory()) throw new UsageError("测试目录无效: " + path.relative(ROOT_DIR, directory));
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const current = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith(".test.js")) files.push(current);
    if (recursive && entry.isDirectory()) files.push(...discoverDirectory(current, true));
  }
  return files;
}

function selectTests(options) {
  const selected = [];
  if (!options.tests.length && !options.testDirs.length) {
    selected.push(...discoverDirectory(path.join(ROOT_DIR, "lib"), false));
    selected.push(...discoverDirectory(path.join(ROOT_DIR, "scripts"), false));
  } else {
    for (const file of options.tests) {
      if (!file.endsWith(".test.js") || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        throw new UsageError("测试文件无效: " + path.relative(ROOT_DIR, file));
      }
      selected.push(file);
    }
    for (const directory of options.testDirs) selected.push(...discoverDirectory(directory, true));
  }
  const unique = [...new Set(selected)].sort(comparePaths);
  if (unique.length !== selected.length) throw new UsageError("测试选择包含重复文件");
  if (!unique.length && !options.allowEmpty) throw new UsageError("未找到测试文件");
  return unique;
}

function createTestEnvironment(baseEnvironment = process.env) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-tests-"));
  const environment = {
    ...baseEnvironment,
    LINGGAN_TEST_ROOT: tempRoot,
    README_FILE: path.join(tempRoot, "DATA.md")
  };
  return { environment, tempRoot };
}

function runTestFiles(files, io = console) {
  let failed = 0;
  for (const file of files) {
    const relative = path.relative(ROOT_DIR, file);
    const { environment, tempRoot } = createTestEnvironment();
    try {
      const result = spawnSync(process.execPath, [file], { env: environment, stdio: "inherit" });
      if (result.error || result.status !== 0 || result.signal) {
        failed++;
        io.error("✗ " + relative + " 失败");
      }
    } finally {
      fs.rmSync(tempRoot, { force: true, recursive: true });
    }
  }
  if (failed) {
    io.error("\n" + failed + " 个测试文件失败");
    return EXIT_TEST_FAILURE;
  }
  io.log("\n✓ 全部 " + files.length + " 个测试文件通过");
  return EXIT_OK;
}

function printHelp(io) {
  io.log("用法: node scripts/run-tests.js [--test <file>]... [--test-dir <dir>]... [--allow-empty] [--list]");
}

function main(argv, runtime = {}) {
  const io = runtime.io || console;
  try {
    ensureSupportedNodeVersion(runtime.nodeVersion === undefined ? process.versions.node : runtime.nodeVersion);
    const options = parseArgs(argv);
    if (options.help) {
      printHelp(io);
      return EXIT_OK;
    }
    const files = selectTests(options);
    if (options.list) {
      for (const file of files) io.log(path.relative(ROOT_DIR, file).split(path.sep).join("/"));
      return EXIT_OK;
    }
    return runTestFiles(files, io);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.error(error.message);
    return EXIT_USAGE;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  EXIT_OK,
  EXIT_TEST_FAILURE,
  EXIT_USAGE,
  MINIMUM_NODE_MAJOR,
  ROOT_DIR,
  UsageError,
  comparePaths,
  createTestEnvironment,
  discoverDirectory,
  ensureSupportedNodeVersion,
  main,
  parseArgs,
  parseNodeMajor,
  resolveInsideRoot,
  runTestFiles,
  selectTests
};
