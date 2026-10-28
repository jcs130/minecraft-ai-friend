# 附近语音与 Agent 听说接入

2026-10-29 调研状态：正式 Paper 尚未安装 Simple Voice Chat；本文是接入方案，不是上线说明。NVMe 迁移不夹带语音插件或端口变更。

## 选用现成语音传输，复用旧天音／天耳

[Simple Voice Chat](https://github.com/henkelmax/simple-voice-chat) 已有 Paper 插件、原生三维距离衰减、Opus 传输及服务端 API。核对 Modrinth 官方项目后，取得声明支持 1.21.1 的 `voicechat-bukkit-2.6.27.jar`（2026-10-28 发布，940342 字节），文件 SHA512 与上游一致；JAR 确实包含 Bukkit 注册服务、实体音轨、AudioSender 和麦克风事件 API。这里只证明下载、声明及接口存在，还没有隔离启动或真人听音验收。产物留在私有候选目录，不提交第三方 JAR。

复用原 `SpeechAudioPlayerContractTest` 和 `SpeechFrames`，已直接对这份真实 Bukkit 2.6.27 JAR 编译运行，8 个断言通过：960 样本帧、尾帧补齐、自然耗尽与取消回调的区别。测试使用假编码器／音轨，不发网络包或声音，不代表已经有人在游戏听见。

仓库已有 `world/god-voice-src` 和 `world/sidecar`：

| 已有内容 | Paper 接入方式 |
| --- | --- |
| `SpeechJob/Lane/Frames/Receipts/Health` | 复用队列、代次、960 样本帧及真实终态语义 |
| `GodVoicePlugin/TtsQueueWatcher` | 替换 NeoForge 生命周期与实体访问为 Bukkit；仍调用 SVC 官方实体音轨 |
| `MicCapture/CaptureInterval/CaptureFence` | 保留首末音包时间、停止包与去重；录音槽和 Opus decoder 改为每位说话者独立 |
| `mic_asr_watcher.py` | 复用音频归一化、原子任务及收据；当前仅萌萌白名单、只给女神的旧路由不满足多人附近听觉 |

旧模块不能直接放进 Paper。历史 `docs/VOICE-INTEGRATION.md` 是旧 NeoForge 环境的部署记录，不能据此启动退役服务、宣称当前 ASR 已就绪，或重新消费旧语音队列。本次确认局域网现役 TTS 1.6.0 的健康接口可读；这不代表本轮已做真实合成或游戏听音。当前 ASR 的正式接口仍需定位和真实转写验证。

## 两条实际链路

Agent：本机 TTS 或远端生成的 WAV/MP3 → 本人身份验证的上传入口 → 后台解码／重采样 → SVC 实体音轨 → 附近玩家。发声跟随角色移动，离开维度、掉线或代次取消即停止。SVC 有直接替无模组玩家发声的 AudioSender，但一人只能注册一个，且不能用于正在使用客户端语音模组的玩家；默认 TTS 更适合独立实体音轨，避免抢真人麦克风。

真人：SVC 麦克风 → 每位玩家独立分段 → 本机 ASR 每段识别一次 → 私有文本事件送给符合听觉范围的 Agent。识别完成时才找附近玩家会把旧话给迟到者；必须记录采音期间的维度、听众和连接代次。初版可采用整段持续在范围内的听众交集，识别结束再剔除已离线／换会话者。队伍／私有语音组必须独立建模，不能当成附近语音广播。

TTS 播放和 ASR 输入分开标记，防止 Agent 听到自己的合成又回复、再合成。转写是游戏发言，不是执行命令或授予管理权限。默认文本格式短且固定，例如 `[附近语音] 小鱼：入口在这边。`，不向公屏发送内部 JSON 或重复回执。

## 远端 Agent 与开销

远端上传应复用官网现有 Agent 会话或单角色凭据，服务端确定发声角色，不能接受正文里的任意 UUID 冒充他人。不把内部 TTS 或 ASR 的管理入口、服务密钥公开给玩家。外部框架只需上传本人音频，不必在服务器再跑一套 Agent 大脑。

采用有界音频长度、每角色串行队列、全局背压和稳定请求 ID。上传／入队、开始播放、自然播完、取消和失败分别返回；网络超时后先查原请求，不自动重复说话。只有原帧供应器自然耗尽、原播放线程停止才记完成；停止回调本身不足以证明听完。WAV、WebM/Opus、Ogg/Opus 和裸 Opus 帧不是同一种传输格式，必须显式解码，不能按字节直接互换。

解码、网络请求、ASR、持久化放后台；主线程只解析实体、采样位置与发布不可变听众快照。每段语音只做一次 ASR，按合格听众分发短文本，不对每个 Agent 重跑识别，也不将音频嵌入命令行或聊天。

## 客户端与网络

Java 玩家原生听说需要匹配 MC 版本的 Simple Voice Chat 客户端模组。未装模组的原版、Mineflayer 和基岩玩家仍应能正常进入服务器，保持可选语音，不强制语音握手。

基岩／不装模组者可评估自托管浏览器桥：[Simple Web Voice Chat](https://github.com/muzaaqi/simple-web-voice-chat) 已公开 Paper ↔ 官网后端 ↔ 浏览器的 SVC 桥接协议；[Bedrock Simple Voice](https://modrinth.com/plugin/bedrock-simple-voice) 提供浏览器配对与自托管模式。后者较新，仍须审查实际源码、版本和手机后台表现。候选不等于已经采用；共用服务器的密钥必须留在后端，不能下发到浏览器。

SVC 通常额外使用 UDP 24454，不能复用 Geyser 的同一 UDP 监听。现有 Velocity/YSM 登录链路仍须实测握手和公网 UDP 路由；本次没有打开新防火墙或路由器端口。浏览器麦克风走官网 HTTPS 和配对身份；手机切到游戏后可能被系统挂起，不能承诺所有手机都能后台持续通话。

## 验收与上线边界

先在独立 Paper 端口验证双向 Opus、实体移动、近远距离与跨维度；再验证多人同时说话、断线重连、重复包、取消／积压、迟到 ASR 不泄露给新听众，以及不把语音或数据刷到公屏。必须包含原版无模组入服、真实 Java 麦克风／耳听、Mineflayer 接收、Numen 身体及网页／基岩浏览器，不能用健康接口或单元测试代替。

官方资料：[API 示例](https://dev.modrepo.de/minecraft/voicechat/api/examples)、[麦克风事件](https://voicechat.modrepo.de/de/maxhenkel/voicechat/api/events/MicrophonePacketEvent.html)、[服务端配置](https://dev.modrepo.de/minecraft/voicechat/wiki/server_config)。安装新 Paper JAR 仍需原维护授权、预告、身份／副本检查及双盘冷备。现阶段没有将语音功能写成官网已支持或给 Agent 虚构可用命令。
