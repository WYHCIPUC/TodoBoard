# P1:爬虫基础设施 + 正文抓取 设计

## Spec Changelog(版本纪律)
- `2026-08-05 · 初版 · 全文 · P1 立项(基于 master plan 细化)`

## 背景与目标
- **一句话目标**:为研究档案增加"抓取正文"能力——点条目「📥抓取正文」,把链接里的实质内容(B站字幕/GitHub README/公众号全文/掘金知乎正文)抓回来存进 `docs/entries/{id}/content.md`,供研究时直接看全文而非只看简介。
- **触发场景**:当前研究档案只有用户手填的字段,原文要另开浏览器看。抓取后正文沉淀进档案,研究时一站式。

## 范围外(YAGNI 边界)
- **永不**:不做动态渲染(P2 范围);不做资源发现(P2);不做定时自动爬;不做批量抓取。
- **以后可能**:puppeteer-core 动态渲染——P1 只做静态(cheerio/readability/API),动态留给 P2。

## 决策日志
1. **依赖引入** → 选 package.json + 少量依赖(cheerio, @mozilla/readability, turndown)→ 理由:正文提取必须用成熟库,手写正则不可靠 → 否决:纯手写(质量差)。注意:核心看板零依赖启动不破坏——依赖仅在 scraper 模块用,未安装时降级提示。
2. **平台顺序** → 选 GitHub→B站→通用网页→公众号 → 理由:风险从低到高,早期验证基础设施 → 否决:并行做(冲突难定位)。
3. **GitHub README** → 选 走 raw.githubusercontent.com / API → 理由:无需 cheerio,直接拿 .md 原文 → 否决:渲染页面爬(多此一举)。
4. **B站字幕** → 选 走 player API(bilibili-API-collect 文档) → 理由:复用现有 fetchBilibili 的 API 基础 → 否决:OCR/语音识别(过度)。
5. **正文格式** → 选 Markdown(turndown 转) → 理由:与 notes.md 一致,可读 + 可编辑 → 否决:HTML(冗余)、纯文本(丢结构)。
6. **降级策略** → 选 多策略链(readability→selector 兜底)+ 保留原始 HTML 链接 → 理由:readability 对某些站不准 → 否决:单策略(失败即无内容)。

## 假设清单
1. **假设**:npm 依赖安装后 node_modules 不进 git(.gitignore 已配)→ 验证:.gitignore 有 node_modules → 若破裂:补 .gitignore。
2. **假设**:B站字幕 API 无需登录(部分视频有公开字幕) → 验证:bilibili-API-collect 文档 → 若破裂:无字幕时返回"该视频无公开字幕"提示,不报错。
3. **假设**:公众号文章 og:description 足够(全文需登录,本期不强求) → 验证:公众号反爬强 → 若破裂:P1 只抓 og 元数据增强,P2 用 puppeteer 再攻全文。
4. **假设**:readability 对掘金/知乎正文提取成功率 > 70% → 验证:这两个站正文结构标准 → 若破裂:加站点专属 selector。
5. **假设**:抓取触发是低频手动(用户点按钮)→ 验证:研究场景 → 若破裂:加节流(本期不做)。

## 架构与组件

### 新增依赖(package.json)
```json
{
  "name": "linggankanban",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "cheerio": "^1.0.0",
    "@mozilla/readability": "^0.5.0",
    "turndown": "^7.2.0"
  }
}
```

### 新增模块
```
lib/
├─ scraper/                    # 爬虫子系统(新)
│  ├─ index.js                 # 统一入口  [public]
│  ├─ readability.js           # 通用正文(readability+turndown→MD)  [public]
│  ├─ github.js                # GitHub README(raw API)  [public]
│  ├─ bilibili.js              # B站字幕扩展  [public]
│  └─ deps.js                  # 依赖可用性检测  [internal]
└─ ...(现有模块不变)
```

### 接口契约
- `lib/scraper/index.js` `[public]`
  - `scrapeContent(url, {mode})` → `{ok, title, content(markdown), source, warning?}` 统一入口,按 URL 自动路由到 github/bilibili/readability
  - 路由逻辑:github.com → github.scrape;bilibili.com → bilibili.scrapeSubtitle;其他 → readability.extract
- `lib/scraper/github.js` `[public]`
  - `scrape(url)` → `{title, content}` 走 `https://raw.githubusercontent.com/{owner}/{repo}/HEAD/README.md`(或 main/master 回退)
- `lib/scraper/bilibili.js` `[public]`
  - `scrapeSubtitle(bvid)` → `{title, content}` 走 player.so.ijgvd.com 或官方字幕 API
- `lib/scraper/readability.js` `[public]`
  - `extract(url)` → `{title, content}` 用 fetcher.httpGet 拿 HTML → cheerio 加载 → readability 解析 → turndown 转 MD
- `lib/scraper/deps.js` `[internal]`
  - `ensureDeps()` → 检测 cheerio/readability 是否可 require,未装抛清晰错误

### server.js 新增路由
```
POST /api/entry/scrape   {id}   抓取该条目 URL 的正文 → 写 docs/entries/{id}/content.md
GET  /api/entry/content?id=1.1   读取已抓正文
```
复用 entries.js 的 safePath/ensureEntryDir。

### content.md vs notes.md 边界(防混淆)
- `notes.md` —— **用户的研究记录**(手填,可编辑):下载安装/体验/截图/收藏。这是档案主体。
- `content.md` —— **抓来的原文**(只读参考):自动生成的正文 Markdown。每次抓取覆盖,不混入用户记录。
- 前端分区:详情页分两个 tab 或上下两区,"我的研究"(notes)在上,"抓取原文"(content)在下/折叠。两者物理隔离,各管各的。

### 前端(board.js)
- 详情页加「📥 抓取正文」按钮 + content 预览区(markdown 渲染或源码)
- 详情页加载时若有 content.md,显示预览

## 数据流
- **抓取**:点按钮 → POST /api/entry/scrape {id} → entries 读 README 取 url → scraper.scrapeContent(url) → 写 docs/entries/{id}/content.md → 返回 content
- **读取**:详情页加载 → GET /api/entry/content?id → 读 content.md(无则空)

## 错误处理(按维度枚举)
- **输入异常**:id 不合法 → 400;条目无 url → 422 "该条目无链接";url 非 http(s) → 400。
- **依赖故障**:cheerio/readability 未装 → 500 "请先运行 npm install(爬虫功能需要依赖)";指引清晰。
- **网络故障**:抓取超时/404/反爬 → 返回 ok:false + warning,不写空 content.md;沿用 fetcher 的代理/重试。
- **解析失败**:readability 提不出正文 → 降级返回 og:description + warning "正文提取失败,仅返回摘要"。
- **B站无字幕**:API 返回无字幕 → 返回 title + warning "该视频无公开字幕"。
- **资源耗尽**:正文 > 100KB → 截断 + 标注 "[正文过长,已截断]"。

## 非功能性约束 (NFR)
- **性能 [硬约束]**:静态抓取 < 8s(含网络);GitHub raw < 3s。
- **安全 [硬约束]**:目标 url 校验(同现有);正文写入前长度截断;不执行抓回的 HTML/JS。
- **降级 [硬约束]**:依赖缺失时看板核心功能不受影响(只爬虫按钮报错)。
- **可维护性 [硬约束]**:scraper/ 独立,fetcher.js 不改(元数据抓取 vs 正文抓取职责分离)。

## Success Criteria(含验证方法与时机)
1. **依赖可装** → 验证:`npm install` 成功,node_modules 生成 → 时机:前置。
2. **GitHub README 抓取** → 验证:roboflow/supervision → content.md 含 README 全文 → 时机:同步。
3. **B站字幕抓取** → 验证:某有字幕视频 → content 含字幕文本(或无字幕 warning)→ 时机:同步。
4. **通用网页正文** → 验证:掘金/知乎文章 → content 含正文 MD → 时机:同步。
5. **降级-依赖缺失** → 验证:删 node_modules 后点抓取 → 友好错误提示,看板其他功能正常 → 时机:前置。
6. **降级-抓取失败** → 验证:无效 URL → ok:false + warning,不写空文件 → 时机:同步。
7. **职责分离** → 验证:fetcher.js 无新 require(cheerio/readability)→ 时机:同步。
8. **详情页接入** → 验证:点抓取 → 正文预览显示 → 重新进入仍显示 → 时机:后置。
```
