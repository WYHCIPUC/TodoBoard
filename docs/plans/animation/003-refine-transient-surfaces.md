# 003 — 精修弹层、Toast 与移动抽屉

- **状态**：DONE
- **基准提交**：`407856b`
- **严重度**：MEDIUM
- **类别**：空间一致性、中断性、物理来源
- **预计范围**：`board.css`、`board.js`、`e2e/browser-smoke.js`

## 问题

弹层内容逐项入场最长超过 500ms；Toast 进出共用 300ms；移动关系详情使用普通曲线。视觉上已有动画，但系统响应不够利落，且同类暂态表面的节奏不统一。

```css
/* board.css:1206-1210 — 当前 */
.modal-overlay.open .modal > * { animation: modalChildIn 0.35s var(--ease) both; }
.modal-overlay.open .modal > *:nth-child(n+4) { animation-delay: 0.20s; }
```

```css
/* board.css:2661 — 当前 */
transition: transform 220ms var(--ease);
```

## 目标

- 模态表面以 220ms `--ease-out` 从 `translateY(8px) scale(0.985)` 到稳定态，内容不再重复级联。
- Toast 进入 220ms、退出 160ms，沿同一垂直路径，中途重复触发能够从当前状态继续。
- 关系详情抽屉使用 240ms `--ease-drawer`，从右侧进入并回到右侧；不添加背景视差。
- 减少动态效果下改为 120ms 透明度反馈，无位移。

## 项目约定

保持现有焦点闭环、`inert` 背景隔离、Toast `aria-live` 和关系画布返回上下文。

## 步骤

1. 删除模态子元素 keyframe 级联，统一表面节奏。
2. 用可中断 transition 统一 Toast 进出，并保持计时器逻辑。
3. 调整移动详情抽屉曲线和减少动态效果替代。
4. 在真实浏览器测试弹层焦点、Toast 重触发和 390px 详情入口。

## 边界

- 不延迟关闭和失败反馈。
- 不改变恢复确认、导入、删除等安全流程。
- 不修改弹层 DOM 层级或数据行为。

## 验证

- `npm run check`
- `npm run test:e2e`
- 连续触发 Toast 和快速开关弹层，确认无跳回起点、无焦点丢失。
- DevTools 10% 播放速度检查进入/退出方向和曲线一致性。
