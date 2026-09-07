# 言灵杖录音边界 v1

这是 2026-09-07 的离线实现记录，不代表已完成实际麦克风或手柄验收。构建证据在 `runtime/audio-boundary-build.json`，两模块完整源码和测试 SHA 在各自 `runtime/*-build/build-record.json`。

每次举杖默认语音；肩键在 0..8 间切换。原 `qiandeng_chanting:mode` 单 VarInt 消息保持不变，非零槽选择与松手提交不等音频 ACK。语音未就绪时 HUD 明示，仍可选快捷槽；没有后台无限重试。显式切回 0 才开始新的、最多 2 秒的语音准备。

客户端 SVC 2.6.22 `MicThread.sendAudio([SZ)V` 的音频线程屏障调用原 `flush()` 发空结束包，复位处理器尾音计数，并丢弃已捕获的 PCM。`ALMicrophone.available()` 单位是样本，`read()` 要求完整帧，因此实现不直接读麦克风：按 `pollProcessedAudio(Z)[S` 实际帧长度，在正常轮询中丢弃屏障时已排队的样本。超过 48000 样本积压则本次语音不可用，不阻塞轮询。普通独立 PTT 的返回值仍由原 SVC 保留，StaffPttMixin 只 OR 附加状态。

服务端在 begin 推送真实 nonce，并通过可选 `StaffAudioBoundaryEvent` 清掉仅本人录音缓冲。每次实际 mode 改变 revision 加一，先暂停本人录音。客户端确认实际音频线程已停止旧句后，发序号 floor；服务端确认当前 nonce、revision、活动语音模式、原录音白名单、已运行的 decoder，再安装 fence 并 ACK。附加 PTT 只在完整匹配 ACK 后开启。迟到 nonce/revision/floor 的 ACK 无效；同栈 useTicks 倒退也与输入门统一视为新手势。

Godvoice 在具体 `ServerStartingEvent` 中反射查找 `StaffAudioBoundaryEvent`，用该具体 Class 程序化注册 consumer；不会订阅 NeoForge 禁止监听的抽象 `PlayerEvent`。事件处理仍检查精确类名和协议版本，两个 mod 无相互 Java 类依赖。序号由 SVC 公开 `MicrophonePacket.toStaticSoundPacket().getSequenceNumber()` 读取；小于等于 floor、重复或倒序的包丢弃。原生空 Opus 包先切段，绝不交给 Opus 解码器。1.2 秒静音仍是断包情况下的备用切段。元数据保持 schema 2，旧句落盘后的 ASR 仍受既有手势和模式时间门禁约束。

## 消息与 QA

- C2S `qiandeng_chanting:audio_boundary_v1`：`gestureId` UTF 最多 96、`revision` VarInt、`floor` 有符号 VarLong，允许 -1 到 Long.MAX_VALUE-1。
- S2C `qiandeng_chanting:audio_state_v1`：`kind` VarInt（0=start，1=ACK）、同一 `gestureId`、`revision`、`floor`、`accepted` Boolean。负 ACK 回显请求字段，不能被视为当前 nonce。
- `floor=-1` 表示此 SVC 连接尚未发送音包；新 floor 必须不小于旧 floor 和已收到的最高序号。相等允许用于确实没有新增音包的静默边界。floor 回退拒绝。
- `qdchant status` 增加 `audioBoundaryReady` 与 `audioRevision`。`qdchant claim ACTOR START END SLOT` 不改。语音准备未完成返回 `audio_boundary_pending`，不消耗手势；非零快捷槽不要求音频准备。
- 未列入 godvoice `listen` 名单不会得到成功 ACK，也不会录音。仅 ASR 下游白名单不足以构成录音准备。QA 如需成功路径，应在维护窗口临时用同一录音名单条件，完成后恢复原文件精确字节。
- Vanilla Mineflayer 须以原版 `minecraft:register` 宣告新增通道才能收到 NeoForge 可选消息。合成 floor 可检查真实消息和 fence 安装，但不能宣称经过 SVC UDP、实体麦克风或物理肩键。

部署前应同时更新共享 chanting JAR（客户端、服务端）和服务端 godvoice JAR。保留原版 mode payload、独立 PTT 和现有播放类；无需更改 schema 2 文件或 ASR JSON 结构。现场验收仍需真实 NeoForge 加载 Mixin，并用实体麦克风快速切换语音→快捷→语音，确认新句单独落盘且旧句不会迟到施法。

## 首次实际启动发现与修复

首次启动证实 NeoForge bus 8.0.5 拒绝自动订阅抽象 PlayerEvent；现已改为以上具体类型注册。构建新增真实依赖 JAR 的 JVM 回归：自动注册监听器成功、无 chanting 时保持可选、有 chanting 时具体事件成功派发，并以旧抽象注册抛错为负例，共 7 项。该测试不启动 Minecraft 服务，也不代表现场音频已经验收。
