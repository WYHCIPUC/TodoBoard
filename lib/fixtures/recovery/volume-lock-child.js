"use strict";

const { VolumeLockSession } = require("../../volume-lock");

const resource = process.argv[2];
const controlDir = process.argv[3];
const hold = Number(process.argv[4] || 250);
const nativeBinding = {
  getVolumeId: () => "fixture-volume",
  isRemote: () => false,
  acquire: () => ({}),
  release: () => true,
};

let session;
try {
  session = new VolumeLockSession([resource, controlDir], { controlDir, nativeBinding }).acquire();
  process.stdout.write("acquired\n");
  setTimeout(() => {
    session.release();
    process.exit(0);
  }, hold);
} catch (error) {
  process.stderr.write((error.code || "error") + "\n");
  process.exit(error.code === "data_in_use" ? 5 : 6);
}
