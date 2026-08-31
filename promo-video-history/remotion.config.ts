import { Config } from "@remotion/cli/config";
import { existsSync } from "node:fs";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setChromiumOpenGlRenderer("angle");
Config.setConcurrency(4);

const localBrowser = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);

if (localBrowser) Config.setBrowserExecutable(localBrowser);
