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
const runtime = JSON.parse(read("scripts/runtime-node.json"));
const server = read("server.js");
const gitignore = read(".gitignore");

assert.match(project, /<OutputType>WinExe<\/OutputType>/);
assert.match(project, /<SelfContained>true<\/SelfContained>/);
assert.match(project, /<PublishSingleFile>true<\/PublishSingleFile>/);
assert.match(project, /<EnableCompressionInSingleFile>true<\/EnableCompressionInSingleFile>/);
assert.match(project, /<PayloadArchive Condition=.*>Payload\.zip<\/PayloadArchive>/);
assert.match(project, /EmbeddedResource Include="\$\(PayloadArchive\)"/);
assert.match(project, /DefaultItemExcludes.*bin\/\*\*;obj\/\*\*/);
assert.match(program, /ResolveDataDirectory\(\)/);
assert.doesNotMatch(program, /Directory\.CreateDirectory\(dataDirectory\)/);
assert.doesNotMatch(program, /File\.Copy\(Path\.Combine\(appDirectory, "DATA\.example\.md"\)/);
assert.match(program, /Directory\.Exists\(dataDirectory\)[\s\S]*RunDoctorAsync/);

for (const marker of [
  "LINGGAN_INSTALL_DIR",
  "info.Environment[\"HOST\"] = \"127.0.0.1\"",
  "LINGGAN_DATA_DIR",
  "LINGGAN_NO_OPEN",
  "README_FILE",
  "ENTRIES_DIR",
  "AUDIT_LOG_FILE",
  "Environment.SpecialFolder.MyDocuments",
  "RunDoctorAsync",
  "WaitForServerAsync",
  "--app=",
  "--user-data-dir=",
  "--disable-background-mode",
  "FindEdgeExecutable",
  "OpenDefaultBrowser",
  "LINGGAN_API_TOKEN",
  "api/control/shutdown",
  ".ready",
]) {
  assert.ok(program.includes(marker), `启动器缺少关键机制：${marker}`);
}

assert.match(build, /build-portable\.ps1/);
assert.match(build, /OutputDirectory/);
assert.match(build, /dotnet publish/);
assert.match(build, /windows-x64\.exe/);
assert.match(build, /SHA256SUMS\.txt/);
assert.match(build, /baseArchive/);
assert.match(build, /baseManifest/);
assert.match(build, /portableManifest/);
assert.match(build, /PayloadArchive/);
assert.match(build, /BaseIntermediateOutputPath/);
assert.match(build, /MSBuildProjectExtensionsPath/);
assert.match(build, /BaseOutputPath/);
assert.match(build, /Deterministic=true/);
assert.match(build, /ContinuousIntegrationBuild=true/);
assert.match(build, /PathMap/);
assert.doesNotMatch(build, /\$projectRoot=\/_\/src;\$buildRoot/);
assert.match(build, /runtime-node\.json|build-portable\.ps1/);
assert.strictEqual(runtime.version.split(".")[0], "24");
assert.match(runtime.sha256, /^[a-f0-9]{64}$/);
assert.match(runtime.nodeExecutableSha256, /^[a-f0-9]{64}$/);
assert.doesNotMatch(build, /launcher[\\/]Payload\.zip/i);
assert.match(server, /api\/control\/shutdown/);
assert.match(server, /authKind !== "token"/);
assert.match(server, /isLoopbackRequest/);
assert.match(read("scripts/build-release.ps1"), /docs\/video/);
assert.match(read("scripts/build-release.ps1"), /release-allowlist\.txt/);
assert.match(read("scripts/build-portable.ps1"), /node_modules/);
assert.match(read("scripts/build-portable.ps1"), /cookies\?/);
assert.match(smoke, /LINGGAN_NO_OPEN/);
assert.match(smoke, /Invoke-WebRequest/);
assert.match(smoke, /Second launch replaced or duplicated/);
assert.match(gitignore, /launcher\/Payload\.zip/);
assert.match(gitignore, /launcher\/bin\//);
assert.match(gitignore, /launcher\/obj\//);

console.log("✓ Windows 单文件构建配置测试通过");
