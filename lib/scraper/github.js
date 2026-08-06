"use strict";
const { httpGet } = require("../fetcher");

/**
 * 抓取 GitHub 仓库 README
 * @param {string} repo - "owner/repo" 格式
 * @returns {Promise<{ok, title, content, source, warning?}>}
 */
async function scrape(repo) {
  // raw 端点尝试顺序:HEAD 引用 → main → master
  // raw.githubusercontent.com 不支持 HEAD 引用,改用 main/master 回退
  const branches = ["main", "master"];
  const files = ["README.md", "readme.md", "README.MD", "README.rst", "README"];
  let lastErr = "";
  for (const br of branches) {
    for (const file of files) {
      try {
        const url = `https://raw.githubusercontent.com/${repo}/${br}/${file}`;
        const r = await httpGet(url, 10000, { "User-Agent": "linggankanban/1.0" });
        if (r.status === 200 && r.body && r.body.trim()) {
          return {
            ok: true,
            title: `${repo} README (${br})`,
            content: r.body.slice(0, 100 * 1024), // 截断 100KB
            source: `GitHub raw (${br}/${file})`,
          };
        }
        lastErr = `HTTP ${r.status}`;
      } catch (e) {
        lastErr = e.message;
      }
    }
  }
  return {
    ok: false,
    title: repo,
    content: "",
    source: "GitHub",
    warning: `未能获取 ${repo} 的 README(${lastErr})。可能仓库无 README 或网络受限。`,
  };
}

module.exports = { scrape };
