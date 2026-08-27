"use strict";

const assert = require("assert");
const path = require("path");

const repositoryData = path.resolve(__dirname, "..", "..", "..", "..", "DATA.md");
assert(process.env.LINGGAN_TEST_ROOT, "runner must provide an isolated test root");
assert(process.env.README_FILE, "runner must provide README_FILE");
assert.strictEqual(path.dirname(process.env.README_FILE), process.env.LINGGAN_TEST_ROOT);
assert.notStrictEqual(path.resolve(process.env.README_FILE), repositoryData);
