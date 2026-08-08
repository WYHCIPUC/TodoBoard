# 2.0.0 稳定版发布检查清单

## 1. 自动化门禁

- [ ] `npm ci` 使用锁文件完成安装。
- [ ] `npm run doctor` 通过或仅提示当前看板已运行。
- [ ] `npm run check` 全部通过。
- [ ] `npm run test:integration` 全部通过。
- [ ] `git diff --check` 无空白错误。
- [ ] CI 在 Node.js 20 和 22 上通过。

## 2. 数据与安全

- [ ] 使用 v1 样本演练迁移，确认 `.linggan/migration-backups/` 生成且源数据未丢失。
- [ ] 演练完整导出与恢复，核对条目、笔记、正文和截图数量。
- [ ] 验证重复 URL 不会创建第二条记录。
- [ ] 验证重复冲突面板可以打开已有条目、合并标签与收藏原因，并在明确选择时保留副本。
- [ ] 验证删除进入回收站且可以恢复。
- [ ] 验证未认证 API、超大 JSON/文件和私网抓取请求被拒绝。
- [ ] 发布包中不存在 `DATA.md`、`docs/entries/`、`docs/fetch-log.md`、`.linggan/`、日志、密钥或代理凭据。

## 3. Windows 验收

- [ ] 在干净 Windows 10 环境安装 Node.js 20 LTS，解压发布包并双击 `start.bat`。
- [ ] 在干净 Windows 11 环境重复上述流程。
- [ ] 验证首次依赖安装、自动打开浏览器、停止后重启和已运行时再次双击。
- [ ] 用其他程序占用 3865，确认启动器给出清晰错误；换端口后可以启动。
- [ ] 验证中文路径、带空格路径和普通用户写权限场景。
- [ ] 按 `docs/WINDOWS-GUIDE.md` 完成升级和卸载演练。

## 4. 浏览器主流程

- [ ] 空数据首次收藏。
- [ ] 预览并保存链接，填写标签与收藏原因。
- [ ] 切换五种研究模板并保存研究结论。
- [ ] 全文搜索命中元数据、笔记和正文。
- [ ] 删除、回收站查看与恢复。
- [ ] 完整备份导出、导入预检摘要、恢复前确认和诊断信息展示。
- [ ] 导入包含文件夹、有效、重复和非法链接的浏览器书签 HTML，确认目录转换为标签、预检数量正确且只写入一次。
- [ ] 清除浏览器中的 `linggan_onboarding_v2_seen` 后刷新，确认首次引导可展示、关闭并通过帮助入口重开。
- [ ] 在数据管理中确认健康状态、读写权限、最近备份和异常问题摘要均正确。
- [ ] 在 390px 视口确认无横向溢出、首条内容无需经过超长头图区，并可横向浏览统计与分类。
- [ ] 搜索后使用清除按钮和 Esc 恢复全部结果；用 Tab + Enter 展开条目，折叠时详情按钮不可获得焦点。
- [ ] 仅 1/14 条完成时完成进度应为 7%，点击每日推荐“开始研究”后状态应变为进行中。
- [ ] 在常见桌面宽度及 390px 窄屏检查布局。

## 5. 构建发布包

```powershell
npm run package:windows
npm run package:portable
npm run package:exe
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-executable.ps1
```

- [ ] 在干净 Windows 10/11 x64 环境直接双击 `dist/linggankanban-2.0.0-windows-x64.exe`，确认无需安装 Node.js 或解压。
- [ ] 验证 EXE 首次启动有进度反馈、二次启动复用缓存，已有服务运行时不会重复启动。
- [ ] 替换 EXE 后重新启动，确认“文档\LingganKanban”中的条目、档案和备份仍然存在。
- [ ] 占用默认端口后启动 EXE，确认显示清晰错误；释放端口或设置新端口后可恢复。
- [ ] 解压 `dist/linggankanban-2.0.0-windows.zip` 并从该目录完成一次验收。
- [ ] 解压 `dist/linggankanban-2.0.0-windows-portable-x64.zip`，在未安装 Node.js 的环境双击 `start-portable.bat`。
- [ ] 便携包内置版本为 Node.js 22.23.2，包含 `NODE-LICENSE.txt` 与 `RUNTIME-NOTICE.txt`。
- [ ] 计算并发布 SHA-256：`Get-FileHash dist\linggankanban-2.0.0-windows.zip -Algorithm SHA256`。
- [ ] 同时计算并发布便携包 SHA-256。
- [ ] 计算并发布单文件 EXE 的 SHA-256，并与 EXE、便携包一起上传到 GitHub Release。
- [ ] Git 标签与 `package.json` 一致：`v2.0.0`。
- [ ] GitHub Release 标记为稳定版，并使用 `docs/release-notes-v2.0.0.md` 作为发行说明。

## 6. 推广前准备

- [ ] README 使用真实仓库地址、界面截图和明确的稳定版下载入口。
- [ ] 配置 Bug、功能建议和数据恢复三类 Issue 模板。
- [ ] 按 `docs/BETA-USER-TEST.md` 完成目标用户首次使用测试。
- [ ] 发布已知限制：Windows 优先、本地单机、无云同步/多人协作、外部网页解析受网络影响。
- [ ] 准备 5 分钟首次使用测试脚本，至少邀请 5 名目标用户试用。
- [ ] 记录激活率、首次收藏耗时、解析成功率和数据恢复问题；不默认开启遥测。
