"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const doctor = require("./doctor");

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(server.address().port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function test() {
  assert.strictEqual(doctor.nodeMajor("v20.12.0"), 20);
  assert.strictEqual(doctor.nodeMajor("invalid"), 0);
  assert.strictEqual(doctor.checkNode("20.0.0").ok, true);
  assert.strictEqual(doctor.checkNode("18.20.0").ok, false);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-doctor-"));
  try {
    assert.strictEqual(doctor.checkDataPath(temp, "DATA.md").ok, true);
    assert.strictEqual(doctor.checkDataPath(temp, path.join("missing", "DATA.md")).ok, false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  await withServer((req, res) => res.end("<title>" + doctor.APP_MARKER + "</title>"), async port => {
    assert.strictEqual(await doctor.probeExistingApp(port), true);
    const result = await doctor.checkPort(port);
    assert.strictEqual(result.status, "app");
    assert.strictEqual(result.ok, true);
  });

  await withServer((req, res) => {
    if (req.url === "/api/diagnostics") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, appVersion: "2.0.0" }));
      return;
    }
    res.setHeader("Set-Cookie", "linggan_session=test; Path=/; HttpOnly");
    res.end("<title>" + doctor.APP_MARKER + "</title>");
  }, async port => {
    assert.strictEqual(await doctor.probeAppVersion(port), "2.0.0");
    const current = await doctor.checkPort(port, "127.0.0.1", "2.0.0");
    assert.strictEqual(current.status, "app");
    assert.strictEqual(current.ok, true);
    const stale = await doctor.checkPort(port, "127.0.0.1", "2.1.0");
    assert.strictEqual(stale.status, "stale");
    assert.strictEqual(stale.ok, false);
  });

  await withServer((req, res) => res.end("another service"), async port => {
    const result = await doctor.checkPort(port);
    assert.strictEqual(result.status, "occupied");
    assert.strictEqual(result.ok, false);
  });

  const available = await doctor.checkPort(0);
  assert.strictEqual(available.status, "available");
  assert.strictEqual(available.ok, true);

  console.log("doctor tests passed");
}

test().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
