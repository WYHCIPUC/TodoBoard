import fs from "fs";
import path from "path";

export function findBrowser() {
  if (process.env.BROWSER_EXECUTABLE && fs.existsSync(process.env.BROWSER_EXECUTABLE)) {
    return process.env.BROWSER_EXECUTABLE;
  }
  const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    candidates.push(path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
    candidates.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
  }
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("未找到 Microsoft Edge 或 Google Chrome");
  return found;
}

export async function settle(page, extra = 600) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await new Promise((resolve) => setTimeout(resolve, extra));
}
