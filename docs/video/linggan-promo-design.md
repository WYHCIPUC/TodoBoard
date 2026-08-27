# 灵感工作台 v2.2 介绍视频

## 成片定位

这是一支 30 秒、1920×1080、30fps 的无旁白产品片，用于 GitHub Release 和产品介绍。受众是需要长期收藏、研究和整理链接的个人用户。核心叙事是：把容易失效的链接，沉淀成可恢复、可继续思考的本地知识资产。

必须展示的能力：链接收集、主动备份、搜索与研究档案、恢复可信状态、头脑风暴、Windows 桌面客户端和本地数据。

## 视觉方向

成片采用“暖纸档案馆”：纸底 `#f6f0e7` / `#fffaf3`，墨色 `#292621`，陶土橙 `#c86f43`，成功色 `#52755f`。标题使用衬线体，界面文字使用清晰无衬线体。暗场仅用于“链接失效”镜头；禁用随机抖动、手持 shake、群发 glint 和赛博霓虹。

## 镜头与节拍

| 帧区间 | 内容 | 动作配方 |
| --- | --- | --- |
| 0–90 | 品牌纸墨片头 | `brand-ink-open` |
| 91–179 | 链接失效与保存转折 | 暗场扫入、褪色、保存章 |
| 180–326 | 8 张真实项目卡入库 | `deck-deal-flyin` |
| 327–415 | 搜索 readability、双圈确认并进入研究详情 | `type-and-filter` |
| 416–533 | 主动归档证据链 | `ai-stream-response` |
| 534–592 | “收藏不是终点”字卡 | `paper-title-card` |
| 593–754 | 根→2 子→4 孙的头脑风暴 | `diagram-cascade` |
| 755–899 | 输入框→图元→品牌 | `input-morph-assemble` |

BGM 为 Mixkit `House Vibez`，约 123 BPM。主切点 f91 / f180 / f327 / f416 / f534 / f593 / f755 均在最近拍点 ±3f 内。收尾声音句式为 riser f773 → impact f833 → sparkle f859。

## 数据与交付

拍摄仅使用 `promo-video-v2.2/video-demo-data.md`，并将数据、控制目录、档案、头脑风暴、回收站全部重定向到 `promo-video-v2.2/out/capture-fixture/`。拍摄脚本不读取、不写入仓库真实 `DATA.md`。细节见 `promo-video-v2.2/CAPTURE-LOG.md`。

交付两版成片：

- `promo-video-v2.2/out/linggan-v2.2-promo.mp4`：BGM + SFX。
- `promo-video-v2.2/out/linggan-v2.2-promo-no-bgm.mp4`：仅 SFX，视频轨无损复用主版。

两版均为 900 帧、30.06 秒、H.264 + AAC。视频轨解码 SHA-256 一致：`2cc040e6333384a626a4b79b94b412a54a37f4f602842104c7afd71a2973f2bf`。主版音频 -23.1 LUFS / -4.6 dBTP；无 BGM 版 -24.3 LUFS / -6.8 dBTP，无削波。

文件 SHA-256：主版 `072bda9e6b094ca0683d7699cb87298ed73fe5e351d1682513fbffab2160543a`；无 BGM 版 `7a56be7b7554c1ba54c29f9e228f39aadefd40ca9f26d49185dfd2b4ba0a2e2b`。

独立终审已核对全部镜头边界、双版逐帧一致性、音频削波和 f534 标题切点，结论为放行。完整记录见 `promo-video-v2.2/FINAL-QA.md`。
