# 企业微信「转发即记录」配置指南

把链接转发给企业微信里的一个自建应用 → 自动抓取并入库到看板。**零封号风险**（企业微信官方接口）。

## 整体架构

```
你在微信/浏览器看到好内容
        ↓ 转发链接到企业微信自建应用
企业微信服务器 ──回调──→ 你的公网地址（内网穿透）
        ↓                     ↓
   回复"已记录"        看板服务 /api/wecom/callback
                              ↓
                        抓取元数据 + 写入 DATA.md
```

## 第一步：注册企业微信（个人免费）

1. 手机下载「**企业微信**」App，用个人微信注册一个企业（个人也可注册，选"其他组织"，随便填）
2. 用电脑打开 https://work.weixin.qq.com/ 登录管理后台

## 第二步：创建自建应用

1. 「**应用管理**」→「**自建**」→「**创建应用**」
   - 应用名：随便（如「灵感收集」）
   - 应用 logo：随便传个图
   - 可见范围：选你自己
2. 创建后进入应用详情页，记下：
   - **AgentId**（应用 ID）
   - **Secret**（应用密钥，点"查看"获取）

3. 「**我的企业**」页记下：
   - **企业 ID**（CorpID）

## 第三步：配置「接收消息」（回调地址）

1. 应用详情页 →「**接收消息**」→「**设置 API 接收**」
2. 「**API 接收**」→ 启用
3. **URL**：填你的公网回调地址（下一步内网穿透拿到后再填），形如：
   `https://你的穿透域名/api/wecom/callback`
4. **Token** 和 **EncodingAESKey**：点「**随机生成**」，记下这两个值
5. 先**不要点保存**（保存时企业微信会立刻发验证请求，需要服务先跑起来）

## 第四步：内网穿透（让企业微信能访问你的本地服务）

任选一个工具（都有免费额度）：

### 方案 A：cpolar（推荐，国内速度快）

1. 下载 https://www.cpolar.com/ 客户端
2. 终端运行：
   ```bash
   cpolar http 3865
   ```
3. 它会给你一个公网地址，形如 `https://abc123.r6.cpolar.top`
4. 你的回调 URL 就是：`https://abc123.r6.cpolar.top/api/wecom/callback`

### 方案 B：ngrok（国际通用）

1. 下载 https://ngrok.com/
2. 终端运行：
   ```bash
   ngrok http 3865
   ```
3. 给出的 `https://xxxx.ngrok-free.app` 即公网地址

> ⚠️ 免费版域名每次重启会变，每次都要回企业微信后台更新 URL。付费版可固定域名。

## 第五步：启动看板（带企业微信配置）

在项目目录创建一个启动脚本 `start-wecom.bat`（Windows）：

```bat
@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"

set WECOM_CORP_ID=你的企业ID
set WECOM_AGENT_ID=你的AgentId
set WECOM_SECRET=你的Secret
set WECOM_TOKEN=第三步生成的Token
set WECOM_ENCODING_AES=第三步生成的EncodingAESKey

node server.js
pause
```

或 Linux/Mac 用环境变量：
```bash
export WECOM_CORP_ID=...
export WECOM_AGENT_ID=...
export WECOM_SECRET=...
export WECOM_TOKEN=...
export WECOM_ENCODING_AES=...
node server.js
```

启动后控制台会显示：
```
企业微信转发入库: 已启用 (/api/wecom/callback)
```

## 第六步：回到企业微信保存配置

1. 确保看板服务 + 内网穿透都在运行
2. 回到企业微信后台「接收消息」配置页
3. 填好 URL（第四步的地址）→ 点「**保存**」
4. 企业微信会发验证请求，看板自动应答 → 保存成功 ✅

## 第七步：测试

1. 在企业微信 App 里找到你创建的应用（通讯录 → 我的团队 / 或搜索应用名）
2. 给它发一条消息，比如：
   ```
   看看这个 https://github.com/mozilla/readability
   ```
3. 几秒后会收到回复：
   ```
   ✅ 已记录
   1.4 mozilla/readability
   分类：开源项目 & 开发
   作者：mozilla
   ```
4. 打开看板 `http://127.0.0.1:3865` 即可看到新条目

## 常见问题

**Q: 保存配置时报"验证 URL 失败"？**
- 确认看板服务在跑、内网穿透在跑、URL 路径正确（`/api/wecom/callback`）
- 检查 Token / EncodingAESKey 是否复制完整
- 看看板控制台有没有收到请求（企业微信的 GET 验证）

**Q: 发消息没反应？**
- 企业微信回调要求服务在 5 秒内响应，抓取慢可能超时
- 检查内网穿透是否还活着（免费版可能掉线）
- 看 `docs/server-error.log` 有无错误

**Q: 想固定公网域名？**
- cpolar/ngrok 付费版可固定；或部署到云服务器（公网 IP 直接可达，无需穿透）

**Q: 别人也能给我的应用发消息吗？**
- 默认只有"可见范围"内的人能发。你在第二步把可见范围设成了自己，所以只有你能用。

## 安全说明

- 所有 5 个参数（CorpID/AgentId/Secret/Token/AESKey）都是**敏感信息**，**切勿提交到 git**
- `start-wecom.bat` 已被 `.gitignore` 忽略（如未忽略请手动加）
- 服务仅在你本地运行，数据不经过任何第三方（企业微信只做消息中转）
