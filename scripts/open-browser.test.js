"use strict";

const assert = require("assert");
const { browserCommand, openBrowser, validateLocalUrl } = require("./open-browser");

assert.strictEqual(validateLocalUrl("http://127.0.0.1:3865/"), "http://127.0.0.1:3865/");
assert.strictEqual(validateLocalUrl("http://localhost:3866"), "http://localhost:3866/");
assert.throws(() => validateLocalUrl("https://example.com"), /Only a local/);
assert.throws(() => validateLocalUrl("file:///tmp/board.html"), /Only a local/);
assert.deepStrictEqual(browserCommand("win32", "http://127.0.0.1:3865/"), {
  command: "explorer.exe",
  args: ["http://127.0.0.1:3865/"],
});

let call;
let unrefCalled = false;
const result = openBrowser("http://127.0.0.1:3865/", {
  platform: "win32",
  spawn: (command, args, options) => {
    call = { command, args, options };
    return { unref: () => { unrefCalled = true; } };
  },
});
assert.strictEqual(result.ok, true);
assert.strictEqual(call.command, "explorer.exe");
assert.deepStrictEqual(call.args, ["http://127.0.0.1:3865/"]);
assert.strictEqual(call.options.detached, true);
assert.strictEqual(unrefCalled, true);

console.log("open-browser: ALL PASS");
