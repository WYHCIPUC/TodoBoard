# 集中需求规划:遗留修复 + 爬虫能力

## Spec Changelog(版本纪律)
- `2026-08-05 · 初版 · 全文 · 需求全景汇总(4历史来源+2会话遗留+1新爬虫需求)`

## 背景

本文档是**全项目需求的集中规划**,整合所有来源:
- 诞生窗口(sess_55959022):看板工具核心
- 抓取窗口(sess_39186850):代理/兜底/日志
- 本窗口:模块化重构 + 研究档案
- 会话遗留:窄视口遮挡、超长标题溢出
- 新需求:爬虫能力(正文抓取+动态渲染+资源发现)

已实现的部分见各模块 spec,不在此重复。本文聚焦**待实现**需求。

## 决策日志
1. **依赖政策转向** → 选 放开零依赖限制 → 理由:爬虫(尤其动态渲染)必须用 puppeteer-core,纯手写不现实 → 否决:严格零依赖(能力太弱)、纯外部服务(脱离本地工具定位)。缓解:核心看板仍可零依赖跑,爬虫作为可选增强(有 package.json 但不强求安装才启动)。
2. **headless 方案** → 选 puppeteer-core + 本机 Chrome → 理由:不下载 Chromium(省 300MB),复用用户已装浏览器 → 否决:完整 puppeteer(重)、playwright(多此一举,puppeteer 够用)。
3. **复用策略** → 选 混合(readability/bilibili-api-ts 复用 + 公众号/掘金自研) → 理由:成熟库省力,但公众号/掘金无可靠库 → 否决:全复用(公众号无好库)、全自研(重复造轮子)。
4. **调度层** → 选 crawlee → 理由:资源发现是批量场景,队列/重试/去重开箱即用 → 否决:手写调度(P2 才需要,P1 不引入)。
5. **批次顺序** → 选 P0→P1→P2 → 理由:遗留快且无依赖,爬虫核心价值在 P1,P2 是增强 → 否决:跳过遗留(已知痛点不该留)。
6. **爬虫产物存储** → 选 存进 docs/entries/{id}/(复用研究档案目录) → 理由:研究档案已是条目级资料载体,正文/资源是其自然延伸 → 否决:独立 docs/scrape/(割裂)。

## 假设清单
1. **假设**:用户本机已装 Chrome/Edge(puppeteer-core 需要) → 验证:Windows 默认有 Edge → 若破裂:引导用户指定浏览器路径或装 Chrome。
2. **假设**:抓取目标站点无强反爬(B站/公众号/掘金/知乎对本机单次抓取容忍) → 验证:低频手动触发,非批量 → 若破裂:加请求间隔/UA 轮换/失败降级。
3. **假设**:正文抓取结果体量可控(单篇 < 50KB 文本) → 验证:文章正文一般 < 10KB → 若破裂:截断 + 标注。
4. **假设**:相关资源发现用站内搜索(非通用搜索 API,避免 Google API key) → 验证:B站/掘金/知乎有站内搜索页 → 若破裂:接 DuckDuckGo HTML 版兜底。
5. **假设**:puppeteer-core 启动 Chrome 耗时 1-3s 可接受(研究场景非实时) → 验证:用户主动触发 → 若破裂:常驻浏览器实例(复杂度上升,P2 再议)。

## 架构与组件

### 新增模块结构
```
lib/
├─ constants.js / classifier.js / fetcher.js / store.js / entries.js  # 已有,不变
├─ scraper/                    # 新增:爬虫子系统
│  ├─ index.js                 # 统一入口 scrape(id, type, opts)  [public]
│  ├─ readability.js           # 通用正文提取(readability+cheerio) [public]
│  ├─ bilibili.js              # B站字幕/简介扩展(走 API) [public]
│  ├─ dynamic.js               # 动态渲染(puppeteer-core) [public]
│  ├─ search.js                # 资源发现(站内搜索→提摘要) [public]
│  └─ chrome.js                # Chrome 路径探测 + browser 复用 [internal]
└─ ...
```

### 接口契约
- `lib/scraper/index.js` `[public]`
  - `scrapeContent(id, url, {mode})` → `{title, content, source}` 正文抓取(mode: auto/static/dynamic)
  - `discoverResources(id, keyword, {platforms})` → `[{title, url, snippet, platform}]` 资源发现
  - 产物写入 `docs/entries/{id}/content.md`(正文)和 `docs/entries/{id}/resources.md`(资源清单)
- `lib/scraper/readability.js` `[public]`
  - `extract(html, url)` → `{title, content(markdown), byline}`
- `lib/scraper/bilibili.js` `[public]`
  - `fetchSubtitle(bvid)` → 字幕文本(复用现有 fetchBilibili 的 API 基础)
- `lib/scraper/dynamic.js` `[public]`
  - `render(url, {waitUntil})` → 渲染后 HTML(用 puppeteer-core)
- `lib/scraper/chrome.js` `[internal]`
  - `findChrome()` → 本机 Chrome/Edge 可执行路径(探测注册表/常见路径)

### server.js 新增路由
```
POST /api/entry/scrape         {id, mode}        抓取正文 → content.md
POST /api/entry/discover       {id, keyword}     发现资源 → resources.md
GET  /api/entry/content?id=1.1                   读取已抓正文
```

### 前端(board.js)
- 详情页加"📥 抓取正文"按钮 + 正文预览区
- 详情页加"🔍 发现相关资源"按钮 + 资源清单区

## 三批次规划

### P0:遗留修复(纯 CSS,无依赖)
- B1 窄视口(400-500px)列表行遮挡 → 加专用断点,列隐藏/换行策略
- B2 超长标题溢出 → 确认方案(允许横向滚动 vs 省略号 vs 换行)

### P1:爬虫基础设施 + 正文抓取(核心价值)
- 引入 package.json + 依赖(@mozilla/readability, cheerio)
- scraper/readability.js 通用正文(静态页)
- scraper/bilibili.js B站字幕扩展
- 公众号/掘金/知乎/GitHub README 正文抓取
- 研究档案详情页接入"抓取正文"
- 写入 docs/entries/{id}/content.md

### P2:动态渲染 + 资源发现(增强)
- puppeteer-core + 本机 Chrome 探测
- scraper/dynamic.js 动态页渲染
- scraper/search.js 资源发现(站内搜索)
- crawlee 调度层(队列/重试)
- 研究档案详情页接入"发现相关资源"

## 非功能性约束 (NFR)
- **性能 [硬约束]**:静态正文抓取 < 5s;动态渲染 < 15s(含 Chrome 启动);资源发现 < 20s。
- **安全 [硬约束]**:爬虫目标 URL 校验(同现有);puppeteer 沙箱;不执行页面内 JS 注入回本地;正文长度上限截断。
- **可维护性 [硬约束]**:scraper/ 子系统独立,不污染 fetcher.js(元数据抓取与正文抓取职责分离)。
- **降级 [硬约束]**:Chrome 未装时正文抓取退回静态(cheerio),不报错;反爬失败时记 warning 不阻断。
- **成本 [约束]**:本机执行无运行成本;但不做高频自动爬(仅用户手动触发)。
- **可观测性 [硬约束]**:抓取日志沿用 docs/fetch-log.md 机制扩展。

## Success Criteria(含验证方法与时机)
1. **P0-B1 窄视口无遮挡** → 验证:内置浏览器 450px 宽度下列表行不重叠 → 时机:后置(浏览器实测)。
2. **P0-B2 标题不溢出破坏布局** → 验证:超长标题在窄屏下方案生效(滚动/省略) → 时机:后置。
3. **P1 正文抓取-静态** → 验证:掘金/知乎文章 URL → content.md 含正文 Markdown → 时机:同步(scraper 实现完即测)。
4. **P1 正文抓取-B站字幕** → 验证:B站视频 → 字幕文本入库 → 时机:同步。
5. **P1 正文抓取-GitHub** → 验证:仓库 → README 全文 → 时机:同步。
6. **P1 Chrome 缺失降级** → 验证:无 Chrome 时静态抓取仍工作,动态模式提示安装 → 时机:前置。
7. **P2 动态渲染** → 验证:JS 重页面 → 正文提取成功 → 时机:后置。
8. **P2 资源发现** → 验证:关键词 → 返回 ≥3 条相关资源 → 时机:后置。
9. **职责分离** → 验证:fetcher.js 行数不因爬虫膨胀(grep 无 puppeteer require) → 时机:同步。

## 范围外(YAGNI 边界)
- **永不**:不做定时自动爬取(仅手动触发);不做分布式爬虫;不做付费 API 代理。
- **以后可能**:浏览器常驻实例(优化启动耗时)——P2 观察后再议;多关键词批量发现——P2 单关键词跑通后再扩。

## 风险提示(Pre-mortem 预判)
- **最高风险:反爬封禁** → 缓解:低频手动触发 + 失败降级 + UA 正常化,不做对抗性绕过。
- **Chrome 路径探测失败** → 缓解:多路径探测 + 用户可配置环境变量 CHROME_PATH。
- **正文提取质量差**(readability 对某些站点不准)→ 缓解:多策略(readability→article-extractor→selector 兜底)+ 保留原始 HTML 供人工修正。
- **puppeteer-core 与本机 Chrome 版本不兼容** → 缓解:锁版本 + 探测时验证启动。
```
