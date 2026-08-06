# 贡献指南

欢迎贡献！在提 PR 之前，请先阅读以下约定。

## 开发环境

- Node.js ≥ 20（`.nvmrc` 锁定 20）
- 零构建工具：不引入打包器/编译器，纯 Node + 原生 JS
- 依赖保持克制：仅引入确有必要的运行时依赖

## 常用命令

```bash
npm install        # 安装依赖
npm start          # 启动看板服务（默认 http://127.0.0.1:3865）
npm test           # 运行 lib/ 下全部单元测试
npm run check      # 语法检查 + 全部测试
```

## 项目结构

```
├─ server.js           # HTTP 路由编排（不含业务逻辑）
├─ lib/                # 业务模块
│  ├─ fetcher.js       # 链接元数据抓取 + 兜底解析 + 代理
│  ├─ scraper/         # 正文/字幕/README 抓取
│  ├─ store.js         # 数据读写（原子写 + 备份）
│  ├─ entries.js       # 研究档案
│  ├─ classifier.js    # 分类
│  └─ safeurl.js       # 出站请求 SSRF 校验
├─ board.html/css/js   # 前端（无框架）
├─ DATA.example.md     # 示例数据（首次运行初始化模板）
└─ docs/plans/         # 需求/设计文档（改功能前先写文档）
```

## 提交规范

提交信息使用 `类型(范围): 描述` 格式：

- `feat(P1-S2): ...` 新功能（可带计划编号）
- `fix(...): ...` 修复
- `docs: ...` 文档
- `chore: ...` 杂项

## 工作流程

1. 新功能先更新 `docs/plans/` 下的设计/计划文档（本项目是文档驱动）
2. 写代码 + 测试（`lib/*.test.js`，无框架，`node lib/xxx.test.js` 即可跑）
3. `npm test` 全绿后提交
4. 不修改 `DATA.md`（用户数据，已 gitignore）和 `docs/entries/`

## 行为准则

请遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。
