# GodVoice 实体说话队列

`python world/god-voice-src/build.py --speech` 显式构建播放改造，产物与构建记录位于唯一的 `runtime/god-voice-build/speech-*/`，不替换运行 JAR。普通构建模式仍拒绝未经明确选择的旧播放器变化。`--speech` 检查现运行 JAR 的全部既有录音、法杖边界、入口 class 原样保留；只允许原 TtsQueueWatcher 及新增 Speech 类发生变化。

schema 2 的 `tts-queue/<id>.json` 接受 `id/entity/file/text/voiceId/generation/createdAt/expiresAt/dimension/scope/recipientUuid/radius/priority`。时间为 epoch 毫秒，generation 是非负整数；radius 默认 24、最多 32；recipient 模式必须指定 UUID。file 必须指向队列内同 id 的 MP3，最多 4 MiB、音频最多 120 秒。实际实体名用于字幕，任务中的名字不能冒充实体名。

每实体最多一个解码、播放或等待停止的位置，另外四个等候位置。等候句按 createdAt/id 排序；urgent 不自动插队，显式打断由上游递增 `speech-state/<entity>.json` generation 实现。schema 2 缺失或损坏的状态文件不播放，旧代、过期、卸载、死亡、换维度会取消；解码完成后再次核验，旧异步结果不能播放。旧 schema 1 沿用其无 generation 的交付合同，但也使用同一串行队列、听众距离与终态回执；接收后最多两分钟有效。

文件和音频解码在后台，实体解析、维度位置、听众资格、字幕与播放生命周期在 Minecraft 主线程。200 毫秒后台检查 generation/期限，即使主线程忙也可将旧音频听众集合清空并 interrupt。每条 SVC EntityAudioChannel 跟随实体、设置空间距离；SVC 音频线程的过滤器只读取主线程生成的不可变 UUID 集合。nearby 是同维度、半径内且 SVC 已安装、已连接、未禁用的玩家；recipient 还要求 UUID 匹配。没有适用听众时返回 `failed/no_voicechat_listeners`，不能将其视为已被玩家听见。

SVC 2.6.22 的 stopPlaying 仅发线程中断，停止回调也会在取消时执行。此实现保持实体槽位直至原 AudioPlayer.isStopped；只有 960 样本帧供应器自然耗尽、回调到达且线程停止才写 completed。开始及结束向实际听众发实体名 actionbar，播放期间每两秒刷新；不增加模型调用。

回执为 `speech-receipts/<id>.json`，包含 schema 2、id、entity、generation、status、code、updatedAt、可选 startedAt；不含正文。started 与 completed/cancelled/failed/expired 分开。终态不可被迟到回调覆盖；只有 completed 将交付文件保存为 `.done/<id>.json`，其他状态使用后缀。崩溃残留 `.processing` 一律取消，不自动重播。上游只能在 Java 发布前写 synthesized/failed/cancelled，交付后由 Java 独占推进，避免两个写者倒退状态。

每秒由 MC 主线程更新 `data/godvoice/.speech-health.json`：schema/protocol=2、updatedAt、activeCount、queuedCount、countsIncludeLegacy=true。没有说话任务时也更新。计数包含解码/播放/停止等待与旧协议；过期心跳可暴露 MC 阻塞或播放器没有启动。

构建包括纯队列、持久 generation/回执、旧录音边界，以及实际安装 SVC AudioPlayerImpl 的假 encoder/channel 合同测试。后者不访问网络或输出声音；这些测试不等于真人听音、距离衰减、客户端字幕视觉或长时间服务运行已经验收。
