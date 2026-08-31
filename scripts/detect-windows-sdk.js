"use strict";

const fs = require("fs");
const path = require("path");

const VERSION_RE = /^10\.\d+\.\d+\.\d+$/;

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function defaultRoots(environment = process.env) {
  const programFiles = environment["ProgramFiles(x86)"] || environment.ProgramFiles;
  const roots = [];
  if (environment.WindowsSdkDir) roots.push(path.join(environment.WindowsSdkDir, "Lib"));
  if (programFiles) roots.push(path.join(programFiles, "Windows Kits", "10", "Lib"));
  return [...new Set(roots.map(root => path.resolve(root)))];
}

function isCompleteSdk(libRoot, version, fileSystem = fs) {
  const kitsRoot = path.dirname(libRoot);
  return fileSystem.existsSync(path.join(libRoot, version, "um", "x64", "AdvAPI32.Lib")) &&
    fileSystem.existsSync(path.join(kitsRoot, "Include", version, "um", "Windows.h"));
}

function findWindowsSdkVersion(options = {}) {
  const fileSystem = options.fileSystem || fs;
  const roots = options.roots || defaultRoots(options.environment);
  const requested = String(options.requested || "").replace(/[\\/]$/, "");
  const candidates = [];

  for (const root of roots) {
    if (!fileSystem.existsSync(root)) continue;
    for (const entry of fileSystem.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && VERSION_RE.test(entry.name) && isCompleteSdk(root, entry.name, fileSystem)) {
        candidates.push(entry.name);
      }
    }
  }

  const versions = [...new Set(candidates)].sort(compareVersions).reverse();
  if (requested) {
    if (!VERSION_RE.test(requested) || !versions.includes(requested)) {
      throw new Error("Requested Windows SDK is not installed: " + requested);
    }
    return requested;
  }
  if (!versions.length) throw new Error("No complete Windows 10 SDK installation was found");
  return versions[0];
}

if (require.main === module) {
  try {
    const requested = process.env.LINGGAN_WINDOWS_SDK_VERSION || process.env.WindowsSDKVersion;
    process.stdout.write(findWindowsSdkVersion({ requested }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { VERSION_RE, compareVersions, defaultRoots, findWindowsSdkVersion, isCompleteSdk };
