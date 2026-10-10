# 距离语音、Agent 发声与头顶气泡调研

调查日期：2026-10-10。基线：Paper 1.20.6 / Java 21 / AgentFriend 0.4.7 / Geyser 2.11.3-b1249，目标为 16 个 Agent 和对应 Eye。

**状态：语音部分仍为调研与设计，本文语音 CLI 均为拟议接口。** 随后的头顶文字实现和发布情况见 [文字气泡](TEXT_BUBBLES.md) 及 SERVER_UPDATES.md；它不依赖语音插件。原调研检查了旧服源码、当前插件清单、已安装 Geyser 的文字显示转换代码，以及上游文档和固定版本源码，没有安装语音插件或启动旧世界。

## 1. 结论

| 需求 | 可行性与接入条件 |
|---|---|
| 真人之间随距离变化的语音 | Java 可用 Simple Voice Chat；实际参与通话的 Java 客户端需要对应模组。原版客户端仍可进服。 |
| Agent 调 CLI 说话 | 可做服务端 TTS → SVC 音频通道；Mineflayer 不需要麦克风或安装 Java 模组。原聊天/技能接口继续使用。 |
| 手机、Xbox 原版基岩实时通话 | 不能仅靠服务器资源包实现。现有候选使用浏览器或 Android 伴随应用接收和发送音频。Xbox 可评估旁边的手机/电脑绑定游戏身份，声音从伴随设备输出。 |
| 进服下载所需内容 | Geyser 支持下发 Bedrock 资源包，适合贴图、模型、界面素材和预置音频；不支持通过该机制给客户端安装 Java 语音模组，也不支持 Bedrock 行为包。 |
| 游戏内头顶文字 | 有独立的服务端实现路径，Java 和 Geyser 都可表达。Agent 已有原文；真人麦克风需要 ASR 后才能得到字幕。基岩气泡外观和设备画面须实测。 |
| 完全不使用游戏外程序的 Xbox 任意实时语音 | 本轮未找到满足条件的方案。预置台词可以走资源包，但不能替代任意内容的实时通话。 |

建议迁移旧服的 TTS/ASR 和队列规则，重新写 Paper 适配层；气泡先做成独立能力。若接受伴随语音页，再验证自托管 SimpleVoice-Geyser。9 月 28 日旧选型文档的“只保留文字”属于历史决定，本次补充了新的候选与版本检查，并未将候选认定为正式服已兼容。

## 2. 旧服实际做了什么

旧服为 NeoForge 1.21.1，现服为 Paper 1.20.6，旧 JAR 不能直接复制过来。

| 旧实现 | 已确认的行为 | 迁移方式 |
|---|---|---|
| `world/god-voice-src/.../GodVoicePlugin.java` | 注册 SVC 麦克风事件、启动录音及 TTS 消费器；旧麦克风名单原先只允许 MengMeng。 | 改用 Bukkit/Paper 插件入口，玩家范围改为明确配置。 |
| 同目录 `TtsQueueWatcher.java` | `createEntityAudioChannel` 跟随实体，设置距离和听众过滤；解码后重查实体、维度、期限和取消代次。 | 保留生命周期设计，使用 Bukkit 实体与主线程位置快照。 |
| `world/sidecar/god-voice-watcher.py`、`character_speech.py` | 文字队列 → TTS → 音频队列；有限队列、认领、取消和终态回执。 | 新建 Paper 专用队列，复用协议思想和可用推理实现。 |
| `world/survival/speech.py` | `speak/cancel/status` 按实际身体身份提交，不能冒充其他角色。 | 新 CLI 由登录者 UUID 绑定本人。 |
| `world/sidecar/mic_asr_watcher.py` | 玩家录音 → ASR 文本 → 世界聊天处理。 | 仅识别真人上行，不把 Agent 合成语音再送 ASR。 |
| `world/src/mc-bubble.ts` | 公屏及 NPC 对话生成 `text_display`；TTL 清理，旧版通过 RCON 定时跟随。 | 复用交互表现，改为 Paper 内一个集中更新器。 |

旧 GodVoice 播放器的字幕是 actionbar；头顶气泡属于另一条链路，不能只迁移播放器就声称两者已同步。

旧文档有 IndexTTS、Kokoro 以及 8100/8191 多个历史时点。本机本轮 8100 未授权 `/health` 探测返回 401，8191 等所查端口没有监听；这不证明推理服务故障，也不能证明旧 TTS 现已可用。后续应核实当前获授权端点、音色清单和真实合成，避免照抄旧 URL。旧资料中的推理、UDP 握手和队列测试不能代替本次真人听音验收。

## 3. 候选与版本检查

### Simple Voice Chat：优先复用的语音底座

官方 Bukkit/Paper 插件支持当前 1.20.6；有实体/位置音频通道、音频播放器，以及模拟无模组玩家发声的 AudioSender API。因此 Agent 可由服务器合成和编码音频，不需要修改 Agent 的 Mineflayer 客户端。

**Java 客户端的语音版本必须单独匹配。** 官方要求语音版本号前两段一致，2.5.x 与 2.6.x 不能混用。Minecraft 1.20.6 的客户端模组已经停止维护；例如其历史 2.5.22 客户端不能直接连接候选桥接所需的 SVC 2.6.x。可选路径：

- 当前 Java 客户端也使用伴随语音页，保持现有游戏版本。
- 自愿安装仍受维护的 Java 客户端与同系列 SVC，通过既有 ViaVersion 连接当前后端，另做实际登录和观战兼容测试。
- 单独评估旧 SVC 2.5.x 路线；不能同时假定新版桥接可原样使用。

SVC 保持 `force_voice_chat=false`，语音故障不应阻止原 Agent、Java 或基岩玩家正常进服。语音 UDP 与 Geyser 19132 必须使用不同端口，具体发布端口须经过现有网关检查。

### SimpleVoice-Geyser：自托管伴随页候选

项目：[TheodoreMeyer/SimpleVoice-Geyser](https://github.com/TheodoreMeyer/SimpleVoice-Geyser)。本轮检查 **v0.1.4，提交 `f5c956b8e9f2b300b1a42d24c26e57a560070198`**，源码副本保存在运行目录之外的 `E:\MC\research\proximity-voice-20261010\SimpleVoice-Geyser`。

- 固定版本的 Spigot/Core 均以 Java 21 为目标，Spigot API 为 1.20.1；作者兼容表列 Bukkit 1.20.1+、SVC 2.6.x、Geyser API 2.10.1+、Floodgate API 2.2.5+。当前 Floodgate 的实际 API 与候选 JAR 仍须检查。源码符合目标版本不等于已在本服成功运行。
- 通过网页参与语音，允许没有 SVC 模组的 Java 玩家接入；不会把网页变成 Minecraft 原生语音界面。
- `SvgAudioListener` 确实处理距离增益、朝向与声道；`svg-v2` 路径转发 Opus 与空间信息，旧路径在服务端解码为 PCM。不同路径的 CPU、带宽和手机后台行为需分别测量。
- 浏览器麦克风需要 HTTPS 安全上下文；跨网 Xbox 用户需要能访问的伴随地址。不能要求玩家关闭浏览器安全设置来完成部署。

源码检查发现三项需要处理的具体问题：

1. `AudioThread` 使用单线程执行器的默认无界任务队列，音频发送也在该线程进行。慢连接可能积压其他人的音频。16 Agent 场景应先加入有界、过期丢弃和慢连接隔离，再压测。
2. 距离公式在 `0.97 × 半径` 处分段不连续。按源码公式计算，`0.9699R` 的增益约 0.0022，`0.9701R` 却约 0.9967。需要修为连续、单调衰减曲线，并测边界；这是离线计算发现，尚非实际耳听结果。
3. NORMAL/ISOLATED 群组会绕过距离衰减；NPC 实体的位置解析也不能照搬玩家连接查询。默认应采用近距模式，并分别测 Agent 玩家和 NPC 音源。

另外，旧 GodVoice 的听众筛选要求 `isInstalled()`，迁移时不能直接沿用：需要覆盖已连接的网页听众，实测 TTS 的 EntityAudioChannel 能否被桥接音频监听器收到。

### 其他路线

| 候选 | 判断 |
|---|---|
| [sirilerklab/svcgeyser](https://github.com/sirilerklab/svcgeyser) | Android 伴随应用 + SVC，作者称支持 XUID 绑定和空间语音；明确测试基础为 Paper 1.21.4。本服 1.20.6 尚未验证，也不是 Xbox 内安装的资源包。可作备选。 |
| [OpenAudioMc](https://docs.openaudiomc.net/docs/client_guide) | 同样需要网页。作者技术要求明确提示大陆服务限制；当前离线模式与其认证要求还须核实。此次不优先采用。 |
| Plasmo Voice | 可作为另一 Java 语音底座，但没有找到通过基岩资源包实现原生实时通话的证据；旧服已经使用 SVC，迁移 SVC 更直接。 |
| Discord/Skoice | 依赖游戏外通话应用，与此前要求直接在游戏内使用的偏好不符，本次不作为默认选择。 |

## 4. 基岩资源包与气泡

### 可以下发的内容

Geyser 的 `packs` 支持 Bedrock `.mcpack`/`.zip`。可以放气泡装饰、角色素材和提前生成的欢迎、NPC 招呼、活动音效；自定义音频还需要 Java 声音标识与 Bedrock 映射。

资源包中已有的台词可以由服务器触发，音源位置和衰减需实测。任意新 TTS 音频不会因服务器新建一个文件就自动出现在已连接的基岩客户端。Geyser 文档明确说明资源包栈只能在连接时增删；逐句生成并要求重连不适合聊天。基岩行为包也不是当前 Paper/Geyser 的运行机制。

Xbox 一旦正常连入服务器，可以参与服务端资源包下载流程；仍需实际设备验证下载、缓存版本与音效播放。浏览器方案中的声音由浏览器设备播放，不能称为 Xbox 游戏原生音频。

### 头顶文字的具体实现

本轮对正式服的 Geyser JAR 做了只读类检查：现有 `TextDisplayEntity` 已将 Java 文字映射为基岩不可见盔甲架的 nametag，设置常显并移除碰撞框。因此基础文字有现成的协议转换路径。

建议第一版：

- 聊天、Agent CLI 和真人 ASR 最终文本共用气泡入口；命令、系统回执、私聊和权限提示不自动公开到头顶。
- 角色头上显示 2–3 行文字，长句分段，跟随移动；一人一个当前气泡，结束后短暂停留，离线、换维度和停止时清理。
- Java 使用 TextDisplay 背景与朝向；基岩优先保证浮字、换行和可读边框。Geyser 转换不等于 Java 的背景、缩放和尾巴完全一致，漂亮气泡皮肤作为资源包增强项另验。
- 只向同维度、范围内的观察者显示；按实际听众权限隐藏，处理隔墙与私聊泄露，不能仅凭客户端绘制距离限制。
- Agent TTS 在实际开始播放时显示对应文字；未连接语音的玩家仍有文本通道。真人 ASR 会有识别延迟，不能承诺话音与字幕逐字同时出现。
- 女神保持观战身份；Eye 使用既有配对关系作为听众，不复制对应 Agent 的发声。共享气泡实体不应通过消息镜像再创建第二份。
- Mineflayer、Java Eye 和 mc-visual-console 分别检查文字元数据与显示；若 Web 渲染器未支持 TextDisplay，则做显示适配，不能以收到实体包代替看见气泡。

## 5. 拟议接口与运行约束

以下命令**尚不存在**，上线时须加入 `/mycli help/list/explain`、命格书和女神资料：

```text
/mycli voice status
/mycli voice say <文字>
/mycli voice receipt <发言ID>
/mycli voice cancel
```

- 登录 UUID 绑定本人及配置中的音色，不接受任意角色名或远程音频 URL；既有 Agent 可用聊天命令调用。
- 回执区分 `accepted/synthesizing/started/completed/failed/cancelled/expired`，分别报告文本交付、音频连接数和播放状态。生成音频、发出包、播放器结束都不能证明真人已经听见。
- 建议普通说话半径 24 格、轻声 8 格，可配置；普通说话使用长度和频率额度。跨维度或远距离传音如以后做成技能，应接原技能耗费，不能借语音绕过距离规则。
- 每人串行、有限等待、发言去重、短句优先；初始建议一句不超过 120 字、每人最多 2 句等待，超时丢弃。取消后异步合成结果不得再次播放，重启不重播旧任务。
- 主线程只处理实体、维度和不可变位置快照；TTS、ASR、编码、磁盘和网络在有界后台执行。一个集中气泡计时器，按活跃气泡更新，静止不重复传送，不扫描世界实体或强制加载区块。
- Agent 原文直接作为语义消息，真人 ASR 文本经现有聊天桥发送给有资格的附近 Agent；必须验证实际 Agent 客户端能接收。禁止把 TTS 再识别一次造成回声回复循环。
- 角色音色、范围、字幕、队列额度和预置台词使用配置运营。首次安装插件需要维护发布；后续参数热加载与资源包重连各自管理，不使用 Paper `/reload`。

## 6. 实施与验收顺序

1. **独立气泡**：隔离服实现公共聊天/CLI 气泡、TTL 和范围；原 Agent 客户端保持，Java、Mineflayer 与真实手机/Xbox 逐项看画面。
2. **Agent 发声**：Paper SVC 适配 + 已核实 TTS，实际角色移动时音源跟随，测试近/中/远/出界、左右声道、断线、换维度与取消；保留文字降级。
3. **跨端伴随语音试点**：先修候选的确定问题，核对依赖，再验证 HTTPS、游戏身份绑定、真人上行、Agent 下行、手机后台与跨网连接。明确录音/ASR 的参与范围，原私聊不广播。
4. **16 Agent 压测**：测 16 个连接、多个同时发声、慢网页连接和 ASR 并发；记录 MSPT、CPU、音频队列年龄、内存、带宽与丢帧。队列必须有界，积压时丢过期话而非影响游戏 tick。
5. **维护上线**：按现有提醒、E/F 备份、正常停启和发布复核流程；实际听音与手机/Xbox 验收未完成时，只发布已验收部分，更新说明标明设备边界。

本次没有完成上述运行验收；当前结论为“Java/Agent 与文字气泡可迁移，基岩实时语音需伴随客户端”，不能表述为正式服已经具备跨端语音。

## 上游依据

- [SVC 安装与客户端要求](https://modrepo.de/minecraft/voicechat/wiki/installation)、[原版与基岩 FAQ](https://modrepo.de/minecraft/voicechat/faq)。
- [SVC 支持版本](https://modrepo.de/minecraft/voicechat/wiki/supported_versions)、[语音协议版本兼容](https://modrepo.de/minecraft/voicechat/wiki/compatibility)。
- [SVC 音频通道、播放器与 AudioSender API](https://modrepo.de/minecraft/voicechat/api/examples)、[服务器配置](https://modrepo.de/minecraft/voicechat/wiki/server_config)。
- [Geyser 资源包与行为包限制](https://geysermc.org/wiki/geyser/packs/)、[Microsoft 自定义声音](https://learn.microsoft.com/en-us/minecraft/creator/documents/addcustomsounds?view=minecraft-bedrock-stable)。
- [Geyser TextDisplay 转换源码](https://github.com/GeyserMC/Geyser/blob/master/core/src/main/java/org/geysermc/geyser/entity/type/TextDisplayEntity.java)；正式 JAR SHA256：`39D8A45ECA9F2413080B9597C67D1B2BF3BC9B62E8577F46EB83C9C8ABFC4499`。
- [SVG v0.1.4 兼容表](https://github.com/TheodoreMeyer/SimpleVoice-Geyser/blob/v0.1.4/docs/install/compatibility.md)、[Spigot 构建目标](https://github.com/TheodoreMeyer/SimpleVoice-Geyser/blob/v0.1.4/spigot/gradle.properties)、[Core 构建目标](https://github.com/TheodoreMeyer/SimpleVoice-Geyser/blob/v0.1.4/core/gradle.properties)。
- [SVG 距离与声道代码](https://github.com/TheodoreMeyer/SimpleVoice-Geyser/blob/v0.1.4/core/src/main/java/io/github/theodoremeyer/simplevoicegeyser/core/audio/SvgAudioListener.java)、[音频任务线程](https://github.com/TheodoreMeyer/SimpleVoice-Geyser/blob/v0.1.4/core/src/main/java/io/github/theodoremeyer/simplevoicegeyser/core/audio/AudioThread.java)、[HTTPS 要求](https://github.com/TheodoreMeyer/SimpleVoice-Geyser/blob/v0.1.4/docs/install/security.md)。
- [Android SVCGeyser 及其要求](https://github.com/sirilerklab/svcgeyser)、[OpenAudioMc 技术条件](https://docs.openaudiomc.net/docs/technical_requirements)。
