# 002 — 收紧动效体系并删除无效常驻动画

- **状态**：DONE
- **基准提交**：`407856b`
- **严重度**：HIGH
- **类别**：目的与频率、性能、动效令牌
- **预计范围**：`board.css`、`board.js`、`lib/ui.test.js`

## 问题

当前存在重复 easing、5 处 `transition: all`、全屏环境层 36/52 秒循环、健康状态持续 pulse、进度光泽循环，以及最长约 800ms 的页面级联入场。它们会让高频工具显得拖沓并长期占用合成资源。

```css
/* board.css:31-43 — 当前 */
--ease: cubic-bezier(0.2, 0.8, 0.3, 1);
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in: cubic-bezier(0.7, 0, 0.84, 0);
```

```css
/* board.css:177-178 — 当前 */
.ambient { animation: drift1 36s ease-in-out infinite alternate; }
.ambient2 { animation: drift2 52s ease-in-out infinite alternate; }
```

## 目标

- 统一为：`--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`、`--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`、`--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`。
- 删除 `transition: all` 和未使用的 `--ease-in`。
- 环境纹理、健康成功状态和进度条保持静态；仅加载/错误状态允许有限状态动画。
- 产品视图切换控制在 180ms、4px 内；首次页面编排不超过 240ms，不阻塞操作。
- 收藏粒子只在每 5 个条目的里程碑出现，不再每次保存都播放。

## 项目约定

沿用现有 CSS 变量和纯原生实现；预定动效用 CSS，拖拽保持 Pointer Events。

## 步骤

1. 合并 easing/时长令牌，逐项替换 `transition: all`。
2. 移除无功能目的的无限循环和重复页面入场；缩短产品视图切换。
3. 把粒子庆祝移入现有里程碑条件。
4. 添加源码合同测试，禁止重新引入 `transition: all`、`ease-in` UI 令牌和全屏环境循环。

## 边界

- 不删除加载、错误、完成等必要状态提示。
- 不改变看板、关系图和头脑风暴业务逻辑。
- 不增加 React、Three.js 或 ThreeUI 依赖。

## 验证

- `npm run check`
- `npm run test:e2e`
- 页面保持 10 分钟，确认无新增持续 CPU/GPU 活动；切换标签时内容应快速稳定落位。
