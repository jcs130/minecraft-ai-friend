# 附近语音与 Agent 听说接入

2026-10-29：QiandengVoice0.1.0、Simple Voice Chat2.6.27与LoginGuard0.1.9已在正式Paper1.21.1加载；原TTS/CPU ASR进程保留，有限权限开机自启已运行，Windows UDP24454规则已创建。客户端模组可选；真实公网UDP与真人麦克风/耳听仍待验收。玩家使用和构建见[proximity-voice/README](../integrations/proximity-voice/README.md)。

## 本轮实现和实际验收

- `QiandengVoice0.1.0` 复用旧帧供应器、串行队列及序号边界；`/voice` 选音色、显式发声、本人公屏自动配音、字幕开关和查询。普通客户端、Mineflayer 与基岩不强制安装语音模组。
- 内部媒体服务只监听127.0.0.1:8857，使用现役8017 TTS1.6.0；ASR 为官方 Paraformer 中文小模型 int8、CPU两线程。现有18音色和默认音色保持；音色创建仍走原 LAN TTS。
- 实际中文5.44秒音频：TTS约1.921秒、ASR约0.110秒。识别为“你好欢迎来到千灯记我们一起去冒险者公会”；同音专名未完全正确，未冒称语义百分百准确。
- 最终独立 Paper 正常冷启后，真实 Opus 编解码／服务端音轨监听与 Mineflayer 接收通过：3格外收到字幕和音频包，200格外均为0；麦克风夹具273包，显式TTS再273包，上传WAV再273包。重复原请求包数546→546；自动配音137包；断线停止并持久记 cancelled，客户端等待者为 unknown，不重播。这是程序声音夹具，不是真人麦克风或耳听验收。
- 语音边界19断言、回执／连接序号15断言、Python媒体11测试、Node客户端4测试、原认证及恢复／双通道门禁43断言、部署19边界通过。各种测试计量分别列示，不冒充真人全链路测试。
- LoginGuard0.1.9 从实际0.1.8逐条复现后只增语音通道实时授权门禁；原账号桥、密码、心跳行为及其他JAR保持，不编入未发布的整套账号桥候选。

### 代理路线的实际取舍

官方 Velocity 语音插件当前对应2.6.26，Bukkit为2.6.27。隔离对照中，加入该代理插件会使同一 Mineflayer1.21.1连接立即收到 internal error；移除后同配置成功出生并收到 `/voice`，随后 `voicechat:request_secret` 的兼容版本20握手也成功返回56字节。尚未确定代理插件内部的具体异常分支，不把它作为已确认的上游根因。

**候选不安装这份 Velocity 语音插件**。采用[官方文档支持的无语音代理插件路线](https://dev.modrepo.de/minecraft/voicechat/wiki/proxy_setup)：游戏仍沿原登录／YSM代理，声音直接连Paper的独立UDP端口。计划LAN24454/UDP；公网还须核对Windows防火墙和路由器映射。本轮未开新公网端口，也未验证真人公网UDP。不能把内部API实测当作公网听音验收。

本次准备的是 E/F 静态候选与登录代理JAR前像，不能称为发布前完整冷备。正式安装仍须当前维护确认、原身份／副本门禁、3分钟预告和完整双盘冷备；不使用 `/reload`。

最终跨维度实测：正在发声的同一角色从主世界进入下界，原请求返回 `cancelled / ACTOR_WORLD_CHANGED`，未续播。同请求同音频返回原sent，改变音频后复用请求ID明确拒绝 `REQUEST_ID_REUSED`，原结果仍为sent。早期测试发现取消原因被统一覆盖、另一次夹具角色已在下界没有真正换维度，失败记录保留；修复与明确起始维度后的复验通过。最终静态候选为 `proximity-voice-release-20261029-r3`，R1/R2未部署且已被替代。

## 选用现成语音传输，复用旧天音／天耳

[Simple Voice Chat](https://github.com/henkelmax/simple-voice-chat) 已有 Paper 插件、原生三维距离衰减、Opus 传输及服务端 API。核对 Modrinth 官方项目后，取得声明支持1.21.1的 `voicechat-bukkit-2.6.27.jar`（940342字节），文件SHA512与上游一致。已经实际加载Bukkit注册服务、实体音轨、AudioSender和麦克风事件；真人听音仍待验收。产物留在私有候选目录，不提交第三方JAR。

复用原 `SpeechAudioPlayerContractTest` 和 `SpeechFrames`，已直接对这份真实 Bukkit 2.6.27 JAR 编译运行，8 个断言通过：960 样本帧、尾帧补齐、自然耗尽与取消回调的区别。测试使用假编码器／音轨，不发网络包或声音，不代表已经有人在游戏听见。

仓库已有 `world/god-voice-src` 和 `world/sidecar`：

| 已有内容 | Paper 接入方式 |
| --- | --- |
| `SpeechJob/Lane/Frames/Receipts/Health` | 复用队列、代次、960 样本帧及真实终态语义 |
| `GodVoicePlugin/TtsQueueWatcher` | 替换 NeoForge 生命周期与实体访问为 Bukkit；仍调用 SVC 官方实体音轨 |
| `MicCapture/CaptureInterval/CaptureFence` | 保留首末音包时间、停止包与去重；录音槽和 Opus decoder 改为每位说话者独立 |
| `mic_asr_watcher.py` | 复用音频归一化、原子任务及收据；当前仅萌萌白名单、只给女神的旧路由不满足多人附近听觉 |

旧模块不能直接放进Paper。历史 `docs/VOICE-INTEGRATION.md` 是旧NeoForge环境的部署记录，不能据此启动退役服务或重新消费旧语音队列。本次新建媒体适配器、复用现役TTS并完成CPU真实转写；新入口尚未发布为正式游戏能力。

## 两条实际链路

Agent：本机TTS或远端PCM16 WAV → 本人已认证游戏连接 → 后台归一化／重采样 → SVC实体音轨 → 附近玩家。当前不支持MP3/WebM/Ogg上传。发声跟随角色，掉线或取消即停止。SVC有替无模组玩家发声的AudioSender，但一人只能注册一个，且不能用于正在使用客户端语音模组的玩家；TTS采用独立实体音轨，避免抢真人麦克风。

真人：SVC 麦克风 → 每位玩家独立分段 → 本机 ASR 每段识别一次 → 私有文本事件送给符合听觉范围的 Agent。识别完成时才找附近玩家会把旧话给迟到者；必须记录采音期间的维度、听众和连接代次。初版可采用整段持续在范围内的听众交集，识别结束再剔除已离线／换会话者。队伍／私有语音组必须独立建模，不能当成附近语音广播。

TTS 播放和 ASR 输入分开标记，防止 Agent 听到自己的合成又回复、再合成。转写是游戏发言，不是执行命令或授予管理权限。默认文本格式短且固定，例如 `[附近语音] 小鱼：入口在这边。`，不向公屏发送内部 JSON 或重复回执。

## 远端 Agent 与开销

远端上传复用现有游戏连接及其角色身份，服务端拒绝正文里的actor/playerUuid。网页上传尚未新增。不把内部TTS/ASR的管理入口、桥令牌公开给玩家；外部框架只需接入本人的连接，不再跑一套大脑。

采用有界音频长度、每角色串行队列、全局背压和稳定请求 ID。上传／入队、开始播放、自然播完、取消和失败分别返回；网络超时后先查原请求，不自动重复说话。只有原帧供应器自然耗尽、原播放线程停止才记完成；停止回调本身不足以证明听完。WAV、WebM/Opus、Ogg/Opus 和裸 Opus 帧不是同一种传输格式，必须显式解码，不能按字节直接互换。

解码、网络请求、ASR、持久化放后台；主线程只解析实体、采样位置与发布不可变听众快照。每段语音只做一次 ASR，按合格听众分发短文本，不对每个 Agent 重跑识别，也不将音频嵌入命令行或聊天。

## 客户端与网络

Java 玩家原生听说需要匹配 MC 版本的 Simple Voice Chat 客户端模组。未装模组的原版、Mineflayer 和基岩玩家仍应能正常进入服务器，保持可选语音，不强制语音握手。

基岩／不装模组者可评估自托管浏览器桥：[Simple Web Voice Chat](https://github.com/muzaaqi/simple-web-voice-chat) 已公开 Paper ↔ 官网后端 ↔ 浏览器的 SVC 桥接协议；[Bedrock Simple Voice](https://modrinth.com/plugin/bedrock-simple-voice) 提供浏览器配对与自托管模式。后者较新，仍须审查实际源码、版本和手机后台表现。候选不等于已经采用；共用服务器的密钥必须留在后端，不能下发到浏览器。

SVC 通常额外使用 UDP 24454，不能复用 Geyser 的同一 UDP 监听。现有 Velocity/YSM 登录链路仍须实测握手和公网 UDP 路由；本次没有打开新防火墙或路由器端口。浏览器麦克风走官网 HTTPS 和配对身份；手机切到游戏后可能被系统挂起，不能承诺所有手机都能后台持续通话。

## 验收与上线边界

先在独立 Paper 端口验证双向 Opus、实体移动、近远距离与跨维度；再验证多人同时说话、断线重连、重复包、取消／积压、迟到 ASR 不泄露给新听众，以及不把语音或数据刷到公屏。必须包含原版无模组入服、真实 Java 麦克风／耳听、Mineflayer 接收、Numen 身体及网页／基岩浏览器，不能用健康接口或单元测试代替。

官方资料：[API 示例](https://dev.modrepo.de/minecraft/voicechat/api/examples)、[麦克风事件](https://voicechat.modrepo.de/de/maxhenkel/voicechat/api/events/MicrophonePacketEvent.html)、[服务端配置](https://dev.modrepo.de/minecraft/voicechat/wiki/server_config)。安装新 Paper JAR 仍需原维护授权、预告、身份／副本检查及双盘冷备。现阶段没有将语音功能写成官网已支持或给 Agent 虚构可用命令。
