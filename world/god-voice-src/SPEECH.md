# GodVoice 实体说话队列

`python world/god-voice-src/build.py --speech` 显式构建播放改造，产物与构建记录位于唯一的 `runtime/god-voice-build/speech-*/`，不替换运行 JAR。普通构建模式仍拒绝未经明确选择的旧播放器变化。`--speech` 检查现运行 JAR 的全部既有录音、法杖边界、入口 class 原样保留；只允许原 TtsQueueWatcher 及新增 Speech 类发生变化。

schema 2 的 `tts-queue/<id>.json` 接受 `id/entity/file/text/voiceId/generation/createdAt/expiresAt/dimension/scope/recipientUuid/radius/priority`。时间为 epoch 毫秒，generation 是非负整数；radius 默认 24、最多 32；recipient 模式必须指定 UUID。file 必须指向队列内同 id 的 MP3，最多 4 MiB、音频最多 120 秒。实际实体名用于字幕，任务中的名字不能冒充实体名。

每实体最多一个解码、播放或等待停止的位置，另外四个等候位置。等候句按 createdAt/id 排序；urgent 不自动插队，显式打断由上游递增 `speech-state/<entity>.json` generation 实现。schema 2 缺失或损坏的状态文件不播放，旧代、过期、卸载、死亡、换维度会取消；解码完成后再次核验，旧异步结果不能播放。旧 schema 1 沿用其无 generation 的交付合同，但也使用同一串行队列、听众距离与终态回执；接收后最多两分钟有效。

队列扫描和音频解码在后台，实体解析、维度位置、听众资格、字幕与播放生命周期在 Minecraft 主线程。200 毫秒后台检查 generation/期限，即使主线程忙也可将旧音频听众集合清空并 interrupt。每条 SVC EntityAudioChannel 跟随实体、设置空间距离；SVC 音频线程的过滤器只读取主线程生成的不可变 UUID 集合。nearby 是同维度、半径内且 SVC 已安装、已连接、未禁用的玩家；recipient 还要求 UUID 匹配。没有适用听众时返回 `failed/no_voicechat_listeners`，不能将其视为已被玩家听见。

SVC 2.6.22 的 stopPlaying 仅发线程中断，停止回调也会在取消时执行。此实现保持实体槽位直至原 AudioPlayer.isStopped；只有 960 样本帧供应器自然耗尽、回调到达且线程停止才写 completed。开始及结束向实际听众发实体名 actionbar，播放期间每两秒刷新；不增加模型调用。

回执为 `speech-receipts/<id>.json`，包含 schema 2、id、entity、generation、status、code、updatedAt、可选 startedAt；不含正文。started 与 completed/cancelled/failed/expired 分开。终态不可被迟到回调覆盖；只有 completed 将交付文件保存为 `.done/<id>.json`，其他状态使用后缀。崩溃残留 `.processing` 一律取消，不自动重播。上游只能在 Java 发布前写 synthesized/failed/cancelled，交付后由 Java 独占推进，避免两个写者倒退状态。

MC 主线程将实际采样时间、activeCount 和 queuedCount 发布为不可变快照，只有一份待写的最新样本。现有 `godvoice-tts-watcher` 每秒最多尝试一次原子更新 `data/godvoice/.speech-health.json`，不增加线程或进程，不将磁盘任务塞进解码队列。schema/protocol=2、updatedAt、activeCount、queuedCount、countsIncludeLegacy=true 保持不变；updatedAt 始终是 MC 采样时间，不以后台写入时间刷新旧状态。没有说话任务时也采样，计数包含解码/播放/停止等待与旧协议。慢盘期间新样本覆盖旧的待写样本，不积压任务；写入失败也限流，服务代次变化时不发布迟到样本。过期心跳仍能暴露 MC 或后台文件访问停滞。

此候选修复针对 2026-09-08 看门狗报告中主线程 `writeHealth → Files.writeString → open0` 的确切阻塞点；没有修改播放前的 generation 文件核验、started/terminal 回执写入或启动/停止的文件操作。这些路径仍有主线程 IO，不能把心跳修复宣称为所有慢盘风险已消除。后台 watcher 自身遇到慢盘也可能暂停语音交付，应保持过期心跳可见。

构建包括纯队列、持久 generation/回执、旧录音边界，以及实际安装 SVC AudioPlayerImpl 的假 encoder/channel 合同测试。新增 SpeechHealthTest 验证阻塞 sink 时 10000 次主线程式发布不等待磁盘、只保留最新样本、真实采样时间、失败限流和过期代次拒绝；完整构建共 114 个断言通过。构建记录在 `runtime/god-voice-build/speech-cf2e846fbb13429096c96afb85760a6e/`。2026-09-08 21:22 已受管部署，服务端、D 客户端和恢复缓存 hash 为 `b23d72da9c6d83a1557538af4bb7db6a73c8ada5469d14f1d1861238b2c44e99`；六项语音冒烟和实时健康通过。离线测试不访问网络或输出声音，也不等于真人听音、距离衰减、客户端字幕视觉或长时间服务运行已经验收。
