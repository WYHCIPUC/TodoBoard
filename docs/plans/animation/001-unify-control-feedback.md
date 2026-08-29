# 001 — 统一控件按压与忙碌反馈

- **状态**：DONE
- **基准提交**：`407856b`
- **严重度**：HIGH
- **类别**：反馈、状态指示、可访问性
- **预计范围**：`board.css`、`board.js`、`lib/ui.test.js`、`e2e/browser-smoke.js`

## 问题

按钮反馈分散在多个选择器中，仍有大量动态按钮只有 hover、没有按下反馈；异步操作多数只设置 `disabled`，没有统一 `aria-busy`、等待文案与可见进度。

```css
/* board.css:339 — 当前 */
transition: border-color 0.2s ease, background 0.2s ease, transform 0.12s ease, box-shadow 0.2s ease;
```

```js
/* board.js:1658 — 当前 */
document.getElementById("fetchBtn").disabled = true;
```

## 目标

- 所有真实 `button` 使用独立 `scale` 属性获得即时按下反馈：按下 `scale: 0.97`，按下 100ms、释放 160ms，曲线 `cubic-bezier(0.23, 1, 0.32, 1)`。
- 不覆盖关系节点、画布和平移组件已有的 `transform`。
- 异步按钮统一设置 `disabled`、`aria-busy="true"`、等待文案，并在结束时恢复原文案和语义状态。
- `prefers-reduced-motion: reduce` 下取消位移和缩放，只保留 120ms 的颜色、边框、透明度反馈。

## 项目约定

- 保持原生 HTML/CSS/CommonJS，不添加依赖或构建步骤。
- 异步状态仍由现有请求结果和 Toast 负责，不改变数据写入顺序。

## 步骤

1. 在 `board.css` 添加统一控件反馈层与忙碌指示器，移除重复缩放和 `transition: all`。
2. 在 `board.js` 增加窄职责 `setButtonBusy`，应用到识别、保存、分析、备份、研究和档案操作。
3. 为忙碌语义、文案恢复和减少动态效果添加静态与浏览器回归断言。

## 边界

- 不修改 API、数据格式或 `DATA.md`。
- 不给键盘快捷指令增加开合动画。
- 不引入声音、振动、Ripple 或 WebGL 按钮。

## 验证

- `npm run check`
- `npm run test:e2e`
- 在 1280px 与 390px 下连续点击、快速取消和重复触发，确认按钮无双重缩放、忙碌状态会恢复。
- DevTools 开启减少动态效果，确认不发生位移，仍能看见状态颜色变化。
