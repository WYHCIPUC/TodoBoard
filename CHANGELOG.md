# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-08-05

### 新增
- 链接解析增强：本地代理自动探测（Clash/v2rayN 等）、多 IP 回退（Happy Eyeballs）、被墙站点兜底解析（标题/作者/来源从 URL 生成）
- 解析记录日志（`docs/fetch-log.md`）：每次预览/入库自动记录结果与方式
- 爬虫子系统：GitHub 仓库 README 抓取、通用网页正文提取（readability + turndown）、B站字幕抓取（无字幕降级到简介）
- 研究档案：每条目独立笔记（自动写回 README 研究要点）、截图上传（PNG/JPG magic number 校验）
- 服务守护进程（`guard.js`）：端口空闲自动拉起、进程崩溃自动恢复

### 变更
- 模块化重构：`server.js` 拆分为 `lib/`（fetcher / classifier / store / entries / scraper / safeurl）
- 前端拆分：`board.html`（结构）/ `board.css` / `board.js`
- **数据文件分离**：个人数据由 `README.md` 迁移至 `DATA.md`，`README.md` 成为项目主页；首次运行自动从 `DATA.example.md` 初始化
- 数据写入安全：写前备份（保留 5 份）、原子写、写队列串行化

### 安全
- 服务默认仅监听 `127.0.0.1`（`HOST` 可覆盖）
- SSRF 防护：出站请求拒绝内网/回环/链路本地地址（含 DNS rebinding 防护），`ALLOW_PRIVATE_NETWORK=1` 逃生阀
- CSRF 防护：POST 写接口校验 `Origin`
- 崩溃兜底：未捕获异常/未处理 Promise 拒绝记录到 `docs/server-error.log`，服务不退出

### 修复
- Windows 下 TLS 请求 socket 超时误触发（改为数据驱动手动超时）
- 多 IP 域名只连第一个地址导致连接卡死（启用 `autoSelectFamily`）
- 响应事件注册时机错误导致请求无限挂起

## [0.1.0] - 2026-08-04（初始版本）

- 看板基础功能：条目列表/看板视图、分类、状态、难度、搜索、排序
- 粘贴链接自动抓取元数据（B站 / GitHub / 微信 / 通用 og 标签）并自动分类
- 本地零依赖服务：静态托管 + README 读写
