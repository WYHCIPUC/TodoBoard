# 研究档案功能 设计

## Spec Changelog(版本纪律)
- `2026-08-05 · 初版 · 全文 · 首次立项`
- `2026-08-05 · Retrospective · 实现后追加回顾节`

## Retrospective(实现后回顾 · 2026-08-05)

### 预测准确度
- ✅ **round-trip 漂移是最高风险**:Pre-mortem 预判准。实测子代理识别并填了 4 个坑(空值字段正则失配、多行 experience 边界、星数未 clamp、$1/$& 注入)。浏览器实测 10 字段全一致、3行多行文本逐字保留,验证彻底。
- ✅ **目录穿越双层防护到位**:正则 + safePath 前缀断言,6 种攻击变体全拦截。
- ✅ **README 不污染约束守住**:研究档案全程只读,git diff 确认零改动。

### 漏判风险
- **multipart 解析复杂度低估**:spec 说"零依赖手写简易 parser",实际 boundary 分割需处理 part 内 header/body 分界、尾部 \r\n、文件与文本字段混合。子代理写了 ~40 行才稳定。→ 经验:零依赖约束下,任何"标准协议解析"都要预留更多篇幅,不能简单带过。
- **caption 与 screenshot 解耦存储**:spec 设计 caption 存 notes.md 引用行,文件名存 screenshots/。删除时需双向同步(删文件+删引用)。实现时 deleteScreenshot 要同时处理两处,正则转义文件名防注入——比 spec 设想复杂。

### Spec 缺口
- **store 依赖方式**:entries.js 写 `const { store } = require("./store")`,但 store.js 是扁平导出,解构会得 undefined。子代理改为 `const store = require("./store")`。→ 经验:跨模块依赖的导出形状要在 spec 里明确(或实现时先读目标模块 exports)。
- **escapeHtml vs escapeAttr**:见模块化 spec 同名缺口。
- **前端 closeEntry 对称恢复**:openEntry 隐藏了 toolrow/statsbar/banner,spec 没说 closeEntry 要恢复。子代理自行补了对称逻辑,否则返回后工具栏永久消失。→ 经验:任何"隐藏/显示"操作要成对出现在 spec 里。

## 背景与目标
- **一句话目标**:让用户点击"进行中(🔄)"条目进入【研究详情页】,结构化记录下载安装状态/路径、体验评分、界面截图、收藏判定,沉淀成每条目的实操档案。
- **触发场景**:当前看板每条目只有一行"研究要点",研究过程散落在各处(下载了什么、装哪了、界面长啥样、好不好用)无沉淀。需要一个"工单式"档案,从灵感库中筛出真正值得备用的实用工具。

## 范围外(YAGNI 边界)
- **永不**:不做多用户/协作;不做云端同步(本地单机);不做截图自动截取(手动上传)。
- **以后可能**:从"值得收藏"的条目一键导出成独立"实用工具库"视图——本期不实现,但收藏判定字段为其预留。

## 决策日志
1. **存储位置** → 选 每条目独立文件夹 `docs/entries/{id}/` → 理由:能存多张本地截图 + 结构化 notes.md,README 退回纯索引 → 否决:全塞 README(放不了本地截图)、JSON 数据文件(脱离 Markdown 可读性)。
2. **档案格式** → 选 `docs/entries/{id}/notes.md`(结构化 Markdown) + `screenshots/` 子目录放图 → 理由:人可直接读,git 友好,与现有 README 风格一致 → 否决:JSON(人读不友好)、SQLite(破坏零依赖)。
3. **进入方式** → 选 独立详情页(新视图) → 理由:多字段表单 + 多图上传在原卡片太拥挤,详情页体验完整 → 否决:原位展开(拥挤)、不加 UI(体验差)。
4. **截图上传** → 选 multipart/form-data 上传到 `screenshots/`,notes.md 用相对路径引用 → 理由:本地保存、离线可看 → 否决:外链图片 URL(易失效)、base64 内嵌(文件膨胀)。
5. **何时创建档案** → 选 进入详情页时按需创建(首访自动建 notes.md 空模板) → 理由:不为未研究的条目预生成空目录 → 否决:新增条目即建(产生大量空目录)。
6. **条目编号与文件夹映射** → 选 `{分类号}.{子号}` 直接作文件夹名如 `1.1` → 理由:与现有编号体系一致,无需新映射 → 否决:用 UUID(丢失可读性)。

## 假设清单
1. **假设**:条目数量在百级以内,`docs/entries/` 扁平结构无性能问题 → 验证:当前 12 条,增长缓慢 → 若破裂:改两级目录 `docs/entries/{分类号}/{子号}/`。
2. **假设**:单条目截图 < 10 张,单图 < 5MB → 验证:研究记录场景合理 → 若破裂:加图片压缩/限制上传(本期不做,先观察)。
3. **假设**:notes.md 的结构化字段用约定 Markdown 标题解析即可,无需复杂 schema → 验证:字段固定(下载/安装/评分/收藏),变化小 → 若破裂:引入 JSON front-matter。
4. **假设**:用户研究一个工具的周期是单机单次,无并发编辑 → 验证:本地单用户 → 若破裂:沿用 store.js 写队列串行化。
5. **假设**:条目编号(id)不会频繁变更 → 验证:删除条目会让后续编号移位,但已研究档案按 id 绑定 → 若破裂:**本期策略:删除条目时保留对应 entries 文件夹不自动清理**(防误删珍贵研究记录;用户手动清)。文档需明确此行为。

## 架构与组件

### 数据布局
```
待办任务汇总/
├─ README.md                      # 索引(不变,仍由现有 add/status/note 管理)
└─ docs/entries/
   └─ {id}/                       # 如 1.1,按需创建
      ├─ notes.md                 # 结构化研究档案
      └─ screenshots/
         ├─ 20260805-153012.png   # 截图按时间戳命名
         └─ ...
```

### notes.md 模板(首访自动生成)
```markdown
# {条目标题} 研究档案

> 本条目来自 README.md,编号 {id}

## 下载安装
- **下载状态**:未下载 / 已下载
- **安装包**:（文件名/来源）
- **安装状态**:未安装 / 已安装
- **安装路径**:（如 C:\Program Files\xxx）

## 体验评价
- **评分**:⭐ (1-5)
- **是否达预期**:是 / 否 / 部分
- **使用感受**:（多行）

## 界面截图
（自动按上传顺序列出,每张配说明）
<!-- screenshot: 20260805-153012.png | 说明文字 -->

## 收藏判定
- **值得收藏备用**:否 / 是
- **推荐指数**:⭐ (1-5)
- **备注**:（为什么收/不收）
```

### 后端模块(在模块化重构基础上扩展)
```
lib/
├─ store.js            # 已有:README 管理(不变)
├─ entries.js          # 新增:研究档案子系统 [public]
│   ├─ getEntry(id) → { id, title, notes, screenshots:[] }
│   ├─ saveNotes(id, fields) → 更新 notes.md 各字段
│   └─ uploadScreenshot(id, fileBuffer, caption) → 存图 + 写引用
└─ ... (fetcher/classifier/constants 不变)
```

**接口契约:**
- `lib/entries.js` `[public]`
  - `getEntry(id)` → `{ id, title(从README解析), notesPath, notesContent, screenshots:[{file, caption}] }`。档案不存在时返回空模板(不报错)。
  - `saveNotes(id, { downloadStatus, installerName, installStatus, installPath, rating, metExpectation, experience, keep, recommendLevel, keepNote })` → 渲染 notes.md 并原子写。
  - `uploadScreenshot(id, buffer, caption)` → `{ file }`,存到 `screenshots/{timestamp}.png`,在 notes.md 追加 `<!-- screenshot: ... -->` 引用行。
  - `deleteScreenshot(id, filename)` → 删图 + 删引用行。
  - `[internal]` parseNotes(content) — 把 notes.md 解析回字段对象(前端表单回填用)。**关键约束:saveNotes 渲染的字段必须能被 parseNotes 完整还原**(渲染/解析双向一致),否则保存后再次进入表单会丢失编辑。两者基于同一套标题正则,不可漂移。
  - `[internal]` ensureEntryDir(id) — 首访建目录 + 空模板。

### server.js 新增路由
```
GET    /api/entry?id=1.1                 读取档案(不存在返回空模板)
POST   /api/entry/notes  {id, fields}    保存字段
POST   /api/entry/screenshot  multipart  上传截图(id + caption + file)
POST   /api/entry/screenshot/delete       删除截图
```

### 前端新增
- `board.js` 新增视图:从卡片点击"📝研究"按钮 → 切换到详情视图(`#entryView`,与 listView/boardView 平级)
- 详情视图:表单(四字段块)+ 截图上传区(拖拽/选择)+ 截图网格(带说明可删)
- 返回按钮回到看板

## 数据流
- **进入档案**:点卡片 → GET /api/entry?id → entries.getEntry(解析README取标题,读 notes.md;不存在建空模板)→ 渲染详情页表单。
- **保存字段**:改表单 → POST /api/entry/notes → entries.saveNotes(渲染 notes.md → 原子写)→ 返回 ok。
- **上传截图**:选图 → POST /api/entry/screenshot(multipart)→ server 接 buffer → entries.uploadScreenshot(写 screenshots/ → 追加 notes.md 引用)→ 前端刷新截图网格。
- **删除截图**:点删除 → POST delete → entries.deleteScreenshot(删文件 + 删引用)→ 刷新。
- **返回**:不自动存,提示未保存改动(若有)。

## 错误处理(按维度枚举)
- **输入异常**:id 不匹配 `/^\d+\.\d+$/` → 400(防目录穿越的核心);上传非图片(magic number 非 PNG/JPG)→ 400;caption 过长(>200)→ 截断不报错。
- **multipart 解析(零依赖难点)**:Node 内置无 multipart parser,server.js 需手写简易 boundary 分割(只支持单文件 + caption 字段,不追求 RFC 全覆盖)。失败 → 400 + 可读错误。测试用真实 png buffer 覆盖。
- **依赖故障(文件)**:notes.md 读取失败 → 返回空模板(降级,不阻断);写入失败 → 500 + 原子写保证 README/既有档案不损。
- **依赖故障(READEM)**:条目 id 在 README 中已不存在(被删)→ getEntry 返回 404 + 提示,saveNotes 拒绝写入孤儿档案。
- **状态冲突**:并发上传同 id 截图 → 沿用 store.js 写队列模式,entries.js 内部也串行化文件写。
- **资源耗尽**:截图超大(>5MB)→ 拒绝 413;docs/entries 写满磁盘 → 500。
- **超时与部分失败**:上传中断 → multipart 未完整则 400;写 notes.md 中断 → 原子写(tmp+rename)兜底。

## 非功能性约束 (NFR)
- **性能 [硬约束]**:详情页加载 < 500ms(读 README 解析标题 + 读单个 notes.md,本地 IO);截图上传 < 2s(本地写盘)。
- **安全 [硬约束]**:id 校验防目录穿越(`/^\d+\.\d+$/` 才允许,防 `../`);**路径二次校验**——path.join 拼出路径后,再断言 `resolve(p).startsWith(entriesRoot)`,双重防御;截图类型校验(magic number 验 png/jpg,非扩展名);上传大小限制 5MB;notes.md 不渲染为可执行 HTML(前端展示时转义,截图 caption 也转义)。
- **可维护性 [硬约束]**:entries.js 单一职责(只管档案子系统);不污染 store.js(READEM 管理职责分离)。
- **可访问性 [非约束]**:本期先功能实现,交互优化属另一迭代。
- **数据合规 [非约束]**:本地数据。
- **可观测性 [硬约束]**:上传/保存成功有 toast 反馈;错误带可读 message。

## Success Criteria(含验证方法与时机)
1. **进入详情页** → 验证:点 🔄 条目卡片"研究"按钮,详情视图加载,表单四块齐 → 时机:**后置**。
2. **首访建模板** → 验证:从未研究的条目进入,`docs/entries/{id}/notes.md` 自动创建含空模板 → 时机:**同步**(entries.js 实现完即测)。
3. **字段保存** → 验证:填字段保存,重新进入详情页字段回显一致 → 时机:**同步**。
4. **截图上传** → 验证:选 png 上传,`screenshots/` 出现文件,notes.md 有引用行,详情页显示缩略图 → 时机:**同步**。
5. **截图删除** → 验证:删图后文件消失、引用行消失、网格刷新 → 时机:**同步**。
6. **目录穿越防护** → 验证:`id=../../etc/passwd` 被正则拒 400 → 时机:**前置**(先写校验测试)。
7. **条目删除联动** → 验证:README 删除条目 1.1 后,`docs/entries/1.1/` 仍保留(不自动删,防误操作;用户可手动清)→ 时机:**后置**(文档说明此行为)。
8. **README 不被污染** → 验证:研究档案功能全程不改 README.md(只读解析标题)→ 时机:**同步**。
```
