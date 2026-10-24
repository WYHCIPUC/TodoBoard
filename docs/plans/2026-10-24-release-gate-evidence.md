# 发布门禁执行证据

**日期**：2026-10-24<br>
**候选**：`main` 当前提交，版本 `2.3.0`<br>
**运行时**：Node.js 24.16.0（`scripts/runtime-node.json` 固定）<br>
**环境**：Windows 11 Home 10.0.26200，VS 2022 Build Tools，.NET SDK 8.0.416，Windows SDK 10

## 已通过

| 门禁 | 证据 |
| --- | --- |
| Node.js 22 门禁 | `npm test` 58/58；`npm run coverage` 逐文件 90% 通过 |
| Node.js 24 门禁 | 固定 Node 24.16.0 `npm run check` 58/58 |
| T5 合同 | release allowlist、确定性归档、portable runtime、executable smoke、recovery/release drill 合同测试通过 |
| 真实恢复演练 | `e2e/trusted-recovery-playwright.py`：桌面/恢复/重启/390px/reduced-motion/离线通过 |
| 两次确定性构建 | 两个独立输出目录的全资产 SHA-256 完全一致：`b6e7d126…`（base manifest）、`4ef2bfc6…`（base zip）、`058134b2…`（portable manifest）、`23011097…`（portable zip）、`84f5daea…`（EXE） |
| EXE smoke | `smoke-executable.ps1` 通过：离线启动、HTTP 读写、health、二次启动复用 |
| fresh extraction / SHA | `release-drill.ps1` 通过：allowlist、manifest、SHA-256、解压清单、固定 node.exe 哈希、离线启动与写入 |
| 发布 dry-run | `build-release.ps1 -DryRun`：93 个 allowlisted 文件通过 |
| 仓库数据保护 | release drill 报告 `repositoryDataUnchanged: true` |

构建产物位于 `Y:\tmp\linggan-build-exe2` 与 `Y:\tmp\linggan-build-exe3`（本地临时目录，不提交）。证据文件：`Y:\tmp\linggan-release-evidence.json`。

## 尚未通过

| 门禁 | 状态 |
| --- | --- |
| Windows 10 干净账户人工验证 | 当前只有 Windows 11 环境，未执行 Windows 10 实机/VM 验证 |
| Windows 11 人工验证 | 已由 EXE smoke、fresh extraction 与浏览器 E2E 覆盖关键路径；仍需按发布清单做一次人工桌面窗口/卸载检查 |
| 远端 tag / Release | `v2.3.0` tag 已存在于旧提交，不能复用；需确定新版本（建议 `2.3.1`）后重新构建、打 tag 并创建 GitHub Release |
| 代码签名 | 已评估，当前阶段暂不购买；发布说明需继续标注未签名并给出 SHA-256 校验 |

## 结论

本地可自动化的发布门禁已全部通过；当前不能宣称整份发布清单完成，原因是 Windows 10 验证环境缺失、Windows 11 人工步骤未执行、以及远端版本/tag 尚未确定。下一步必须先决定 `2.3.1` 版本与 tag 目标，再执行最终发布。
