# 🚀 发布检查清单（GitHub 发布前逐项确认）

> 代码层面的发布准备已完成（数据分离 / LICENSE / 安全 / CI / 文档）。以下是**仓库操作**层面的清单，按顺序执行。

## 1. 代码提交前确认

- [ ] `git status` 无 `DATA.md`、`docs/entries/`、`docs/fetch-log.md`（已在 .gitignore，若出现说明配置异常）
- [ ] `npm test` 全绿
- [ ] `README.md` 徽章链接已替换 `YOUR_NAME/linggankanban` 为真实仓库地址
- [ ] `README.md` 中已补充界面截图
- [ ] 删除本地备份文件：`server.js.refactor-backup.js`、`lib/fetcher.js.backup.js`、`README.backup-*.md`（均不入库，本地可留）

## 2. 创建 GitHub 仓库

- [ ] 新建仓库 `linggankanban`（Public）
- [ ] **不要**勾选 "Add a README"（本地已有）
- [ ] 添加远程并推送：

```bash
git remote add origin https://github.com/<你的用户名>/linggankanban.git
git push -u origin main
```

## 3. 仓库设置（Settings）

- [ ] General → Description：`本地优先的灵感/项目收集看板：粘贴链接自动解析并分类，数据就是一份 Markdown`
- [ ] General → Topics：`kanban` `markdown` `local-first` `bookmark-manager` `nodejs`
- [ ] General → Default branch → 启用 `Require pull request reviews`（可选，单人可跳过）
- [ ] Pages → Source 选 `Deploy from a branch` → `main` / root → Save（在线试用入口：`https://<用户名>.github.io/linggankanban/board.html`，纯前端可用「选择文件」加载本地数据）
- [ ] 确认 Actions → CI workflow 首次运行通过（Node 20/22 矩阵）

## 4. 发布 Release（v1.0.0）

```bash
git tag v1.0.0
git push origin v1.0.0
```

在 GitHub → Releases → Draft：标题 `v1.0.0`，内容可从 `CHANGELOG.md` 的 1.0.0 章节复制。

## 5. 发布后检查

- [ ] 徽章正常显示（CI / License / Node）
- [ ] 在线 demo 可打开
- [ ] 截图上传到 README 中引用的位置（仓库内 `docs/screenshot.png` 或图床）

## 可选后续

- [ ] 推送到 Hacker News / V2EX / 小众软件等社区
- [ ] 上 npm（需移除 `private: true`，加 `bin`/`files` 字段，另发 `@yourname/linggankanban`）
- [ ] 英文版 README（`README.en.md`）
