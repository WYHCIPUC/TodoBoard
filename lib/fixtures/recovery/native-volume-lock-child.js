"use strict";

const { VolumeLockSession } = require("../../volume-lock");

const resource = process.argv[2];
const controlDir = process.argv[3];
const hold = Number(process.argv[4] || 250);
let session;
try {
  session = new VolumeLockSession([resource, controlDir], { controlDir }).acquire();
  process.stdout.write("native-acquired\n");
  setTimeout(() => {
    session.release();
    process.exit(0);
  }, hold);
} catch (error) {
  process.stderr.write((error.code || "error") + ":" + error.message + "\n");
  process.exit(error.code === "data_in_use" ? 5 : 6);
}
