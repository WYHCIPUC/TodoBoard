"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const {
  WINDOWS_CLEANUP_MAX_ATTEMPTS,
  removeTemporaryRoot,
  stopChrome,
} = require("../e2e/browser-smoke");

async function main() {
  const waits = [];
  let attempts = 0;
  await removeTemporaryRoot("unused", {
    platform: "win32",
    remove() {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error("profile busy"), { code: "EBUSY" });
    },
    wait(milliseconds) { waits.push(milliseconds); },
  });
  assert.strictEqual(attempts, 3);
  assert.deepStrictEqual(waits, [100, 200]);

  attempts = 0;
  await assert.rejects(
    removeTemporaryRoot("unused", {
      platform: "win32",
      remove() {
        attempts++;
        throw Object.assign(new Error("profile busy"), { code: "EBUSY" });
      },
      wait() {},
    }),
    error => error.code === "EBUSY"
  );
  assert.strictEqual(attempts, WINDOWS_CLEANUP_MAX_ATTEMPTS);

  attempts = 0;
  await assert.rejects(
    removeTemporaryRoot("unused", {
      platform: "linux",
      remove() {
        attempts++;
        throw Object.assign(new Error("profile busy"), { code: "EBUSY" });
      },
      wait() { throw new Error("非 Windows 不应重试"); },
    }),
    error => error.code === "EBUSY"
  );
  assert.strictEqual(attempts, 1);

  const chrome = new EventEmitter();
  chrome.exitCode = null;
  chrome.signalCode = null;
  chrome.pid = 1234;
  chrome.kill = () => { throw new Error("Browser.close 成功后不应发送进程信号"); };
  const methods = [];
  let cdpClosed = false;
  const cdp = {
    async send(method) {
      methods.push(method);
      chrome.exitCode = 0;
      chrome.emit("exit", 0, null);
    },
    close() { cdpClosed = true; },
  };
  await stopChrome(cdp, chrome);
  assert.deepStrictEqual(methods, ["Browser.close"]);
  assert.strictEqual(cdpClosed, true);

  console.log("browser smoke cleanup tests PASS");
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
