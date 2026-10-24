# 1000 条规模验收

**日期**：2026-10-24<br>
**基线**：`88b1655`（含批量归档状态、搜索缓存、待处理中心与队列压缩）<br>
**数据**：隔离临时目录中生成 1000 条条目，每条含 `notes.md` 与 2 KB 级归档正文；不接触仓库 `DATA.md`。

## 方法

```powershell
npm run benchmark:scale
```

`scripts/benchmark-scale.js` 启动真实本地服务，以显式 API 令牌依次请求：

- `GET /api/data`
- `GET /api/archive/statuses`（一次批量请求覆盖全部 1000 条）
- `GET /api/attention`
- `GET /api/search?q=benchmarkscale&limit=100`（3 次，含缓存预热）
- `GET /api/brainstorm?mode=panorama`

## 结果

| 指标 | 响应时间 | 说明 |
| --- | --- | --- |
| 首屏数据 `/api/data` | 11.6 ms | 252,783 bytes |
| 批量归档状态 `/api/archive/statuses` | 108.0 ms | 单次请求，272,958 bytes；无逐条请求 |
| 待处理中心 `/api/attention` | 189.6 ms | 1000 条聚合，294,248 bytes |
| 深度搜索（3 次） | 20.2 / 11.7 / 10.8 ms | 首次读盘，后续缓存命中 |
| 头脑风暴 `/api/brainstorm` | 289.6 ms | 1000 条全量关系分析 |

所有请求均返回 HTTP 200；服务在 `API_RATE_LIMIT=1000` 的隔离验收配置下运行。

## 结论与边界

- 1000 条数据下没有出现逐条归档状态请求或请求风暴；首屏、搜索、待处理与头脑风暴均在可交互范围内。
- 该验收使用本机临时目录与固定脚本，不代表远端网络抓取成功率、低配设备或超大归档正文的绝对性能。
- 浏览器端真实首屏还受渲染、字体和本地磁盘影响；本表只测服务端读取路径。
- 后续若继续扩大资料库，应把待处理中心与头脑风暴的响应时间纳入同一脚本的趋势记录。
