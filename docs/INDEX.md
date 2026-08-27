# 灵感工作台文档

这里收录产品原则、使用指南、设计计划与发布资料。第一次接触项目时，先阅读根目录 [README](../README.md)；参与产品或代码决策前，先阅读 [项目原则](PROJECT-PRINCIPLES.md)。

## 普通用户

- [Windows 使用指南](WINDOWS-GUIDE.md)：单文件 EXE、便携包、数据位置、升级与卸载。
- [便携运行时](PORTABLE-RUNTIME.md)：内置 Node.js 的来源、校验与更新策略。

核心使用不要求配置消息平台。需要从手机转发链接时，再选择以下高级入口：

## 可选手机采集（部署者）

- [企业微信接入](WECOM-GUIDE.md)：需要企业微信自建应用和可访问的 HTTPS 回调。
- [钉钉接入](DINGTALK-GUIDE.md)：需要钉钉内部应用，Stream 模式无需公网域名。

## 贡献者：产品与决策

- [项目原则](PROJECT-PRINCIPLES.md)：长期产品边界、决策优先级与质量底线。
- [原则对照与补强计划](plans/2026-08-14-principles-gap-analysis.md)：从 2.1.0 基线出发的优势、缺口和补强顺序。
- [v2.2.0 可信恢复与回顾升级计划](plans/2026-08-14-v2.2-trusted-recovery-review-plan.md)：v2.2 的范围、合同、实施依赖、回滚和发布门禁。
- [公开 Beta PRD](product-upgrade-prd.md)：2.0 阶段的历史定位、目标与验收依据。
- [头脑风暴知识图谱设计](plans/2026-08-06-brainstorm-knowledge-graph.md)：本地关联、证据与验证路径。

## 维护者：可靠性与发布

- [可靠链接归档](plans/reliable-link-archive.md)：save-first、重试、人工补录和备份边界。
- [下一稳定版发布清单](RELEASE-CHECKLIST.md)：自动化、数据、安全、浏览器和 Windows 门禁。
- [Beta 用户测试](BETA-USER-TEST.md)：首次使用任务与观察指标。
- [v2.2.0 发布说明](releases/v2.2.0.md)：兼容性、升级、恢复、回滚、验证证据和远端 Pending。
- [v2.2 介绍视频](video/linggan-promo-design.md)：成片叙事、镜头映射、数据边界、节拍与交付规格。
- [2.1.0 历史发行说明](release-notes-v2.1.0.md) 与根目录 [更新日志](../CHANGELOG.md)。

## 设计与实施记录

`docs/plans/` 中带日期的文件是特定阶段记录，不自动代表当前状态。实现新功能前应新增或更新相应计划，并说明：

1. 对应哪条项目原则和工作流阶段。
2. 用户数据、网络访问、失败降级与恢复边界。
3. 范围外内容和可回滚路径。
4. 单元、集成、浏览器或分发验证方式。

## 数据边界

- `DATA.md`、`docs/entries/`、`.linggan/`、备份、日志和消息平台凭据都是本地用户数据，不应提交或放入发布包。
- 源码/便携模式与单文件 EXE 的数据目录不同，具体位置以 [Windows 使用指南](WINDOWS-GUIDE.md) 为准。
- 本地优先不等于完全离线：抓取网页和可选消息入口会访问第三方网络；核心数据和头脑风暴分析默认留在本机。
