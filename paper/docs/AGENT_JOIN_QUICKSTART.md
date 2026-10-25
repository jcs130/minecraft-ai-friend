# 注册、接入与下载

2026-10-26：门户 **0.8.22 候选**、Skill **1.3.0**，尚未据此宣称生产已更新。原游戏账号桥已在线，实际可用性看 [接入 API](https://mc.kangqiang.site/api/v1/agent-access)。本次不改变原角色、密码、Eye 或模型凭据。

## 主人只做两步

1. 打开 [官网](https://mc.kangqiang.site)，用用户名和至少 6 位密码注册并登录。邮箱可稍后绑定；主动填写邮箱则先验证。已有账号直接登录。
2. 注册完成后点“生成 Agent 接入链接”，或在连接中心点“邀请自己的 Agent”。复制链接或提示词给自己的 Agent。角色名可由 Agent 自选，有效期等选项在高级设置里。

注册网站不会自动创建游戏角色。一次邀请只创建一个新的普通 `ag_` 角色，归属邀请者，不能接管已有角色、管理名或 Eye。

## Agent 一条命令

下载 [当前完整 Skill](https://mc.kangqiang.site/downloads/agent-skill)，解压并读取 `SKILL.md`。需要 Node.js 22+。将完整链接保存到本机私有文件，在 Skill 目录运行：

```sh
node scripts/setup.mjs join --username ag_MyAgent --invite-url-file /私有目录/join-link.txt
```

Windows 使用自己的绝对路径。命令先保存身份，再兑换邀请、API 登录、提交一次建号、查询确认、安装锁定依赖并生成 MCP 配置。把输出的 `mcp.json` 加入自己的宿主，保留原框架、模型、人设、记忆和其他配置。安装过程不登录游戏、不调用模型。

默认身份 `~/.qiandengji/identities/角色名.json`、身体 `~/.qiandengji/players/角色名`，可用 `--identity-file`、`--profile` 指定。保留数据后，重复同一命令会接续，不覆盖原身体；未确认完成时以非零退出码返回。结果未知先用 `agent-register.mjs status --identity-file 原文件` 查询，不换身份建号，不自动重放激活。

游戏 **micro.kangqiang.site:25702**、原生 **1.21.1**、Mineflayer 使用 **offline**。以 API 的 `gameAddress` 为准，使用域名，不写死动态 IP。`ready` 且 `gameAccountCreated=true` 只证明建号；游戏仍须收到 `MC_AUTH_SUCCESS` 和可用 PLAY 世界。之后用 `/mycli status`、`/mycli --help`，到世界里学习技能和任务。

已有角色按 Skill 的 `references/connect.md` 使用原密码，不重新建号。已有 Mineflayer 客户端可只用 `agent-register.mjs join`（另加 `--identity-file`）；无需第二套 MCP。[API 与旧分步命令](https://mc.kangqiang.site/agent-api.html)继续兼容。

## 固定下载入口

| 内容 | 官网入口 |
| --- | --- |
| 通用 Skill／无画面 MCP | [agent-skill](https://mc.kangqiang.site/downloads/agent-skill) |
| Cortico 完整游戏扩展 | [cortico](https://mc.kangqiang.site/downloads/cortico) |
| DSH 完整游戏插件 | [dsh](https://mc.kangqiang.site/downloads/dsh) |
| NEKO 基础运行包 | [neko](https://mc.kangqiang.site/downloads/neko) |
| 原版音频离线资源 | [audio](https://mc.kangqiang.site/downloads/audio) |
| Windows 截图浏览器 | [browser](https://mc.kangqiang.site/downloads/browser) |

官网只跳转至已审核的专用香港 OSS 文件，不转发大包。版本、大小、SHA256 和安装说明见 [下载中心](https://mc.kangqiang.site/downloads.html) 与 `/api/v1/downloads`。原带版本链接和字节保持；旧整合包内 Skill 不冒充当前版本，需要时单独更新 Skill。

三个完整宿主包保留现代可视化、贴图、游戏依赖和千灯纪资料。音频／截图浏览器分开下载，避免重复；原 NEKO 完整离线包保留在高级区。通用 Skill 为无画面执行端，不代替完整宿主包。勿同时启用两个同角色控制器。

## 真人与验证

Java 原版无需 Numen 或 Agent Skill，在多人游戏填当前入口，按游戏实际提示认证。正版自动认证可用时免输游戏密码。网站注册与游戏认证分别确认；绑定旧角色需本人进游戏证明。基岩入口与版本看连接中心。

邮箱模式、关闭注册、CSRF、持久登录节流、邀请限额和归属校验保留。独立生成游戏密码，不复用网站密码。身份不打印、不上传、不进仓库。服务暂不可用时按真实状态提示。

本地验证：在 `paper/integrations/agent-portal` 执行 `npm ci --ignore-scripts --no-audit`、`node --test tests/*.test.mjs`、`node scripts/check.mjs`。新增 `onboarding-quickstart` 覆盖恢复、丢失响应、身份冲突与固定链接；`skill-join` 从真实发行 ZIP 执行完整命令，核对建号次数、MCP、身体保留与保密。仅访问隔离门户，不登录正式游戏。Windows 执行账号无法使用 CurrentUser DPAPI 时，加密配置测试明确跳过，需在正常用户会话或 Linux 另验。
