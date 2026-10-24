#!/usr/bin/env node
"use strict";

/**
 * 升级快照操作器：默认只读列出快照；恢复必须显式指定名称、manifest SHA-256、
 * --apply 与交互挑战码。恢复前会创建 rescue 快照，运行队列与 marker 一并回退。
 */

const crypto = require("crypto");
const readline = require("readline");
const { inspectInstanceLock } = require("../lib/instance-lock");
const { acquireVolumeLocks } = require("../lib/volume-lock");
const upgrade = require("../lib/upgrade");

const EXIT = Object.freeze({ OK: 0, USAGE: 2, NOT_FOUND: 3, LOCKED: 5, FAILED: 6, CANCELLED: 10 });

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { list: false, apply: false, interactive: false, restore: "", hash: "" };
  const values = new Set(["--data", "--entries", "--brainstorms", "--trash", "--orphans", "--control-dir", "--restore", "--hash"]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (values.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new UsageError(arg + " 需要参数");
      options[{
        "--data": "dataFile", "--entries": "entriesDir", "--brainstorms": "brainstormsDir",
        "--trash": "trashDir", "--orphans": "orphansDir", "--control-dir": "controlDir",
        "--restore": "restore", "--hash": "hash",
      }[arg]] = value;
    } else if (arg === "--list") options.list = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--interactive") options.interactive = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new UsageError("未知参数: " + arg);
  }
  if (options.apply && !options.interactive) throw new UsageError("恢复必须同时使用 --apply 与 --interactive");
  if (options.apply && (!options.restore || !options.hash)) throw new UsageError("恢复必须显式指定 --restore 与 --hash");
  if (options.restore && !/^[0-9a-f]{64}$/.test(options.hash || "")) throw new UsageError("--hash 必须是 64 位小写 SHA-256");
  return options;
}

function help() {
  return [
    "用法: node scripts/upgrade-snapshot.js [路径选项] --list",
    "      node scripts/upgrade-snapshot.js [路径选项] --restore <名称> --hash <SHA-256> --apply --interactive",
    "",
    "默认只读列出升级快照；恢复前请停止服务并复制整个数据目录。",
    "路径选项: --data --entries --brainstorms --trash --orphans --control-dir",
  ].join("\n");
}

function ask(question, input = process.stdin, output = process.stderr) {
  const terminal = Boolean(input.isTTY && output.isTTY);
  const interface_ = readline.createInterface({ input, output, terminal });
  return new Promise(resolve => interface_.question(question, answer => {
    interface_.close();
    resolve(answer.trim());
  }));
}

function write(value, options, io) {
  io.stdout.write(options.json ? JSON.stringify(value) + "\n" : JSON.stringify(value, null, 2) + "\n");
}

async function run(argv, runtime = {}) {
  const io = runtime.io || { stdout: process.stdout, stderr: process.stderr };
  let options;
  try { options = parseArgs(argv); } catch (error) { io.stderr.write(error.message + "\n"); return EXIT.USAGE; }
  if (options.help) { io.stdout.write(help() + "\n"); return EXIT.OK; }

  let paths;
  try { paths = upgrade.resolvePaths(options); } catch (error) { io.stderr.write(error.message + "\n"); return EXIT.USAGE; }

  if (!options.restore) {
    const snapshots = upgrade.listUpgradeSnapshots(paths);
    write({ ok: true, dryRun: true, modified: false, snapshots }, options, io);
    return EXIT.OK;
  }

  const instance = inspectInstanceLock(paths.controlDir);
  if (instance.locked) {
    write({ ok: false, code: "data_in_use", modified: false, message: "检测到运行中的实例锁，请先关闭服务" }, options, io);
    return EXIT.LOCKED;
  }
  const target = upgrade.listUpgradeSnapshots(paths).find(item => item.name === options.restore);
  if (!target) {
    write({ ok: false, code: "snapshot_not_found", modified: false }, options, io);
    return EXIT.NOT_FOUND;
  }
  if (!target.restorable || target.manifestSha256 !== options.hash) {
    write({ ok: false, code: "snapshot_not_restorable", modified: false, snapshot: target }, options, io);
    return EXIT.NOT_FOUND;
  }
  if (!options.apply) {
    write({ ok: true, dryRun: true, modified: false, snapshot: target }, options, io);
    return EXIT.OK;
  }

  const challenge = crypto.randomBytes(4).toString("hex");
  io.stderr.write("将把当前数据恢复到升级快照 " + target.name + "，并先创建 rescue 快照。\n");
  const answer = await (runtime.ask || ask)("输入本轮挑战码 " + challenge + " 以继续，其他输入取消: ", runtime.input, runtime.output);
  if (answer !== challenge) {
    write({ ok: false, code: "cancelled", modified: false }, options, io);
    return EXIT.CANCELLED;
  }

  let lock = null;
  try {
    const resources = [paths.dataFile, paths.entriesDir, paths.brainstormsDir, paths.trashDir, paths.orphansDir, paths.controlDir];
    const acquire = runtime.acquireLocks || ((items, lockOptions) => acquireVolumeLocks(items, lockOptions));
    lock = acquire(resources, { controlDir: paths.controlDir, nativeBinding: runtime.nativeBinding });
    const result = await (runtime.restore || upgrade.restoreUpgradeSnapshot)(target.name, target.manifestSha256, { ...paths, ...options, lockFactory: () => ({ release() {} }) });
    write({ ok: true, dryRun: false, modified: true, result }, options, io);
    return EXIT.OK;
  } catch (error) {
    write({ ok: false, code: error.code || "upgrade_restore_failed", message: error.message, modified: null }, options, io);
    return EXIT.FAILED;
  } finally {
    if (lock && typeof lock.release === "function") lock.release();
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code; });
}

module.exports = { EXIT, UsageError, help, parseArgs, run };
