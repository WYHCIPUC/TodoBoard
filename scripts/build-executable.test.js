"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const project = read("launcher/LingganLauncher.csproj");
const program = read("launcher/Program.cs");
const build = read("scripts/build-executable.ps1");
const smoke = read("scripts/smoke-executable.ps1");
const gitignore = read(".gitignore");

assert.match(project, /<OutputType>WinExe<\/OutputType>/);
assert.match(project, /<SelfContained>true<\/SelfContained>/);
assert.match(project, /<PublishSingleFile>true<\/PublishSingleFile>/);
assert.match(project, /<EnableCompressionInSingleFile>true<\/EnableCompressionInSingleFile>/);
assert.match(project, /EmbeddedResource Include="Payload\.zip"/);

for (const marker of [
  "LINGGAN_INSTALL_DIR",
  "LINGGAN_DATA_DIR",
  "LINGGAN_NO_OPEN",
  "README_FILE",
  "ENTRIES_DIR",
  "AUDIT_LOG_FILE",
  "Environment.SpecialFolder.MyDocuments",
  "RunDoctorAsync",
  "WaitForServerAsync",
  ".ready",
]) {
  assert.ok(program.includes(marker), `启动器缺少关键机制：${marker}`);
}

assert.match(build, /build-portable\.ps1/);
assert.match(build, /dotnet publish/);
assert.match(build, /windows-x64\.exe/);
assert.match(build, /SHA256SUMS\.txt/);
assert.match(smoke, /LINGGAN_NO_OPEN/);
assert.match(smoke, /Invoke-WebRequest/);
assert.match(smoke, /Second launch replaced or duplicated/);
assert.match(gitignore, /launcher\/Payload\.zip/);
assert.match(gitignore, /launcher\/bin\//);
assert.match(gitignore, /launcher\/obj\//);

console.log("✓ Windows 单文件构建配置测试通过");
