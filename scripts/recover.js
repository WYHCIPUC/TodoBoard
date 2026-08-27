#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const readline = require("readline");
const { createManager, defaultPaths } = require("../lib/backup");
const { RecoveryService } = require("../lib/recovery");
const { acquireVolumeLocks } = require("../lib/volume-lock");

const EXIT = Object.freeze({ OK: 0, USAGE: 2, NO_CANDIDATE: 3, AMBIGUOUS: 4, LOCKED: 5, FAILED: 6, CANCELLED: 10 });

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { json: false, apply: false, interactive: false };
  const values = new Set(["--control-dir", "--data", "--entries", "--brainstorms", "--trash", "--orphans", "--transaction", "--candidate"]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (values.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new UsageError(arg + " 需要参数");
      options[{
        "--control-dir": "controlDir", "--data": "dataFile", "--entries": "entriesDir", "--brainstorms": "brainstormDir",
        "--trash": "trashDir", "--orphans": "orphansDir", "--transaction": "transactionId", "--candidate": "candidate",
      }[arg]] = value;
    } else if (arg === "--json") options.json = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--interactive") options.interactive = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new UsageError("未知参数: " + arg);
  }
  if (options.apply && !options.interactive) throw new UsageError("写入恢复必须同时使用 --interactive");
  if (options.apply && (!options.transactionId || !options.candidate)) throw new UsageError("写入恢复必须显式指定 --transaction 和 --candidate");
  return options;
}

function help() {
  return [
    "用法: node scripts/recover.js [路径选项] [--transaction UUID] [--json]",
    "      node scripts/recover.js [路径选项] --transaction UUID --candidate verified-old --apply --interactive",
    "",
    "默认只读 dry-run；写入没有 --force 或跨进程确认 token。",
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

function writeResult(value, options, io) {
  if (options.json) io.stdout.write(JSON.stringify(value) + "\n");
  else io.stdout.write((typeof value === "string" ? value : JSON.stringify(value, null, 2)) + "\n");
}

async function run(argv, runtime = {}) {
  const io = runtime.io || { stdout: process.stdout, stderr: process.stderr };
  let options;
  try { options = parseArgs(argv); } catch (error) {
    io.stderr.write(error.message + "\n");
    return EXIT.USAGE;
  }
  if (options.help) {
    io.stdout.write(help() + "\n");
    return EXIT.OK;
  }
  const paths = defaultPaths(options);
  const manager = createManager({ ...options, ...paths, now: runtime.now, coordinator: runtime.coordinator });
  const service = new RecoveryService(manager, { now: runtime.now });
  let inspection;
  try {
    inspection = options.transactionId ? service.inspect(options.transactionId) : service.status();
  } catch (error) {
    writeResult({ ok: false, code: error.code || "recovery_failed", message: error.message }, options, io);
    return EXIT.FAILED;
  }
  if (!options.apply) {
    writeResult({ ok: true, dryRun: true, modified: false, inspection }, options, io);
    if (inspection.selection === "none") return EXIT.NO_CANDIDATE;
    if (inspection.selection === "ambiguous") return EXIT.AMBIGUOUS;
    return EXIT.OK;
  }
  const candidate = inspection.candidates.find(item => item.name === options.candidate);
  if (!candidate) {
    writeResult({ ok: false, code: "candidate_not_found", modified: false }, options, io);
    return EXIT.NO_CANDIDATE;
  }
  if (inspection.selection === "ambiguous") {
    writeResult({ ok: false, code: "ambiguous_recovery", modified: false }, options, io);
    return EXIT.AMBIGUOUS;
  }
  let lock;
  try {
    const resources = [...manager.targets().map(target => target.live), manager.controlDir];
    lock = acquireVolumeLocks(resources, { controlDir: manager.controlDir, nativeBinding: runtime.nativeBinding });
    return await manager.withExternalVolumeLock(lock, async () => {
      const current = service.inspect(options.transactionId);
      const currentCandidate = current.candidates.find(item => item.name === options.candidate);
      if (!currentCandidate || currentCandidate.fingerprint !== candidate.fingerprint) throw Object.assign(new Error("候选状态已变化"), { code: "state_changed" });
      const challenge = crypto.randomBytes(4).toString("hex");
      io.stderr.write("将恢复事务 " + options.transactionId + " 的 " + options.candidate + "。\n");
      const answer = await (runtime.ask || ask)("输入本轮挑战码 " + challenge + " 以继续，其他输入取消: ", runtime.input, runtime.output);
      if (answer !== challenge) {
        writeResult({ ok: false, code: "cancelled", modified: false }, options, io);
        return EXIT.CANCELLED;
      }
      const issued = service.issueRestoreToken(options.transactionId, options.candidate);
      const result = await service.restoreOld(options.transactionId, options.candidate, issued.token);
      const verified = service.inspect(options.transactionId);
      writeResult({ ok: true, dryRun: false, modified: result.modified, result, verified }, options, io);
      return EXIT.OK;
    });
  } catch (error) {
    const code = error.code || "recovery_failed";
    const modified = ["manual_recovery_required", "recovery_failed"].includes(code) ? null : false;
    writeResult({ ok: false, code, message: error.message, modified }, options, io);
    return ["data_in_use", "invalid_storage_topology"].includes(code) ? EXIT.LOCKED : EXIT.FAILED;
  } finally {
    if (lock) lock.release();
  }
}

if (require.main === module) run(process.argv.slice(2)).then(code => { process.exitCode = code; });

module.exports = { EXIT, UsageError, ask, help, parseArgs, run };
