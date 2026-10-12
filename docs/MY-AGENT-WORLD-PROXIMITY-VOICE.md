# My Agent World：Java 距离语音

2026-10-12；Minecraft 1.21.1 / NeoForge 21.1.248；分支 `experiment/agent-society-1.21.1`。

采用 Max Henkel 的 **Simple Voice Chat 2.6.22**，与旧项目已有的语音接口一致。普通说话范围 32 格，悄悄话 8 格，客户端按距离和方向播放。关闭跨距离小组通话。此次只开放家庭局域网 Java 实时语音；用户决定基岩实时语音暂缓。

服务端已正式安装并恢复运行，局域网防火墙已放行，语音健康与冒烟检查均通过。Java 客户端仍需按下方步骤安装和完成设备引导；真人麦克风、耳机听感尚未验收。

## 玩家使用

1. Java 客户端安装 [NeoForge 1.21.1 的 Simple Voice Chat 2.6.22](https://modrinth.com/plugin/simple-voice-chat/version/2s7zUspF)，随现有整合包一起启动。下载文件为 `voicechat-neoforge-1.21.1-2.6.22.jar`。
2. 通过现有 Java 地址 `192.168.3.163:28976` 入服。
3. 按 **V** 打开语音菜单，完成首次引导，选好麦克风和扬声器，解除静音；在游戏按键设置中配置按键说话或悄悄话。
4. 两位玩家靠近测试说话，再逐渐走远。先检查菜单中的语音连接状态和设备音量，避免把未完成引导误判为服务器故障。

不装这个模组仍可通过现有兼容入口游戏，但听不到、也不能发送此模组的实时语音。无需 Discord、网页伴侣或模型 Key。Java 直播观察客户端也需要安装它并完成引导。旁观者与玩家相互说话的特殊开关保持关闭，不把旁观者当隐形麦克风。[官方客户端兼容与安装说明](https://modrepo.de/minecraft/voicechat/faq)

基岩原有女仆录音包仍按实体位置播放，见 [女仆原生语音](MY-AGENT-WORLD-BEDROCK-MAID-VOICES.md)。那是预录游戏音效，与玩家麦克风通话是两条功能。

## 选择依据与旧项目复用

检查了旧仓库的 `docs/VOICE-INTEGRATION.md`、`docs/VOICE-CASTING-AUDIT.md`，以及 `world/god-voice-src` 中的 GodVoice、MicCapture、TtsQueueWatcher。旧方案也是 Simple Voice Chat：原生距离语音负责传输和播放，自有扩展负责实体音源、录音和外部模型队列。

旧报告出现过 `no_voicechat_listeners`，有些客户端还处于 `disabled=true`；因此这次增加协议认证、静音、范围和跨维度验证，并明确保留真人听感验收。此次没有安装 GodVoice 录音扩展或启用旧队列。

| 方案 | 核对结果 | 本轮决定 |
| --- | --- | --- |
| [Simple Voice Chat](https://github.com/henkelmax/simple-voice-chat) | NeoForge 原生；已有旧项目实体音源经验；允许语音客户端可选 | 使用 |
| [Plasmo Voice](https://plasmovoice.com/) | 同类距离语音，客户端也需安装；更换会重做旧语音集成 | 保留为备选 |
| [SimpleVoice-Geyser](https://github.com/TheodoreMeyer/SimpleVoice-Geyser) | 浏览器桥，当前项目不是现成的 NeoForge 1.21.1 安装包 | 暂缓 |
| [svcgeyser](https://github.com/sirilerklab/svcgeyser) | Paper/Floodgate 配合伴侣 App；不直接适配当前原生服 | 暂缓 |
| [Bedrock Voice Chat](https://www.bedrockvoicechat.com/wiki/start/faq/) | 另一套伴侣程序；不能仅靠资源包获得麦克风 | 暂缓 |

核对 Modrinth 版本元数据后锁定最新稳定版 2.6.22；当日 2.6.24 标记为 beta，没有为了版本号替换成测试版。使用官方原始 JAR，不在 Git 中重新发布第三方二进制。作者许可整合包包含此模组并要求署名，保留上方作者与项目链接。

## 服务配置与维护

配置文件：`E:\QiandengJiSocietyLab\server\config\voicechat\voicechat-server.properties`。

| 项目 | 正式值 |
| --- | --- |
| UDP 监听 / 广告地址 | `192.168.3.163:28989` |
| `max_voice_distance` / `whisper_distance` | `32.0` / `8.0` |
| `force_voice_chat` | `false` |
| `enable_groups` | `false` |
| `spectator_interaction` / `spectator_player_possession` | `false` / `false` |
| `allow_pings` | `true`，原协议随机挑战回显用于健康检查 |
| `allow_recording` | `true`，原生玩家录音许可；不代表服务器自动录音 |

音频走独立 UDP，配置含义见 [官方服务端配置](https://modrepo.de/minecraft/voicechat/wiki/server_config)。端口与基岩 UDP 28988 分开；原 Numen 私有 HTTP 仍是回环 TCP 28989，与本次 LAN UDP 28989 属于不同协议。仅在 Windows 添加 `MyAgentWorld.VoiceLAN.AllowIPv4` 与 `MyAgentWorld.VoiceLAN.DenyOtherIPv4` 两条规则；允许家庭网段 `192.168.3.0/24`，其他来源阻止。没有路由器转发或公网开放。

`services/service.json` 增加顶层声明：

```json
{"voiceChat":{"host":"192.168.3.163","port":28989}}
```

只挂到已有 Java 子进程，声音服务没有独立守护进程。Java 就绪条件同时检查游戏状态和 SVC UDP 随机挑战回显；已就绪游戏连续三次语音探测失败才进入原有依赖暂停、优雅停止和有界重启流程，单次丢包只标记语音健康退化。启动校验 JAR SHA256；运行时校验关键配置，避免漂移到强制安装、全局小组或其他端口。维护重启守护进程以载入这些新探针，不能只重启 Java 子进程。

原生服务端锁 `manifests/society-lab-1.21.1.lock.json` 包含语音 JAR 和 SHA256/SHA512。新建私有实验服的 `prepare` 首次生成回环 UDP 28980 配置，防止原模组默认端口意外监听；正式局域网激活须按本说明设置配置、顶层声明和防火墙。

在仓库根目录运行，Python 使用已有 Python 3 环境：

```powershell
python tools/maw_voice.py plan
powershell -NoProfile -File tools/maw_lan_firewall.ps1 -Voice -Mode Plan
python tools/maw_voice.py health
python world/ops/health/health_mon.py --society-voice
python world/ops/health/health_mon.py --society-voice-smoke
```

`Apply` / `Rollback` 防火墙操作需要 Windows 管理员令牌；`Status` 只读。改配置先正常停服并冷备，保留账号、Numen 身份、世界、动作账本和原 Agent 暂停状态。回滚时在停服期间恢复备份的 `service.json`、语音配置和模组清单，移出这一个语音 JAR；只回滚 `-Voice` 规则，不动 Java/基岩规则。

## Agent 与协议边界

Mineflayer 和 Numen 原有身体接入保留。**能登录不等于已经会听和说**：SDK 没有自动增加 ASR、TTS 或模型调用。以后可复用官方 [实体音源 API 示例](https://modrepo.de/minecraft/voicechat/api/examples)，把语音绑定到真实身体 UUID 与实体，继续按位置衰减；接收语音、转写、角色推理和合成属于另一次功能集成。

网关显式协商 14 个 `voicechat:*` 原生频道，测试端在自己的游戏连接注册状态和认证频道；密钥仅经本人连接获取并留在内存，退出清零。音频仍走原模组 UDP/AES-GCM 协议。没有把语音 Base64、密钥或周期状态写入聊天栏。

## 验证范围

隔离服新增原版 SVC JAR，其余 34 个 JAR 保持。普通 Mineflayer 连接先正常登录，再由测试适配器走原始密钥交换、UDP 认证及保活；11 项实测通过，包含本人身份、近处接收、超范围不接收、8 格悄悄话、静音/恢复和跨维度不接收。测试帧为编码后的 Opus 静音，不采集麦克风；QA 无模型调用，正常退出，端口关闭。

解码/GCM 篡改测试 4 项、语音探针 6 项、主守护 34 项、基岩守护 8 项、健康逻辑 11 项通过。失败的首轮缺状态频道记录保留在私有研究目录，没有把失败改写为通过。

正式普通账号完成本人语音认证；9 项健康/冒烟断言全部通过。原生 SDK 9 项、统一身体适配器 8 项、Numen 服务端/基岩表单 15 项只读健康通过，额外 MCP 查询原账号离线身体成功，未领取控制权或唤醒它。原 34 个 JAR、11 份 SDK 分发、原凭据/模型配置和旧 Paper 保持；Agent 自主暂停不解除，原动作账本前缀与 `7927420b` unknown 保留，仅追加连接退出、工作进程启动和出生事件。

冷备为 `E:\QiandengJiSocietyLab\backups\proximity-voice-20261012-attempt2`，1,413 文件 / 415,928,441 字节，CRC 和逐文件 SHA256 校验通过。首轮备份碰到仍运行但已暂停的基岩守护 OS 锁，保留失败归档；第二轮排除不可恢复也不应复制的 `instance.lock`，不排除世界、身份、账户或账本数据。主守护新 runId 为 `1ad3c77229be4a92890e17940c75562e`；基岩守护因原生配置文件戳变化也正常重载，新 runId 为 `518ac9e8aafd416dbd5385397e081e18`。正常 Java 存档重写了 properties 注释，逐键确认配置值保持。

检查记录在私有 `research/proximity-voice-20261012`；凭据、原始账本、录音、第三方 JAR 和研究大文件不进入 Git。网络协议通过不代表已经由真人麦克风/耳机或手机听感验收；`actualMicrophoneTested`、`actualAudiblePlaybackTested` 保持 `false`。此次维护已结束，不要重放停止、安装或测试夹具。
