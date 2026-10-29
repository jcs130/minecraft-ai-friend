# 千灯纪附近语音

状态（2026-10-29）：Simple Voice Chat 2.6.27、QiandengVoice 0.1.0 与本机 TTS/CPU ASR 已安装正式服并自启。局域网 UDP 已实收 nonce 回包；公网映射已补，外网及真人麦克风/耳听验证状态见[发布说明](../../docs/PROXIMITY_VOICE.md)。

这是一层可选语音传输，不创建新的 Agent 大脑或 Minecraft 连接。复用 `world/god-voice-src` 的 `SpeechFrames`、`SpeechLane`、`CaptureFence`；ASR 每段只识别一次，再向附近角色分发。

## 玩家和 Agent 的入口

Java 玩家听说需安装与游戏版本匹配的 [Simple Voice Chat 客户端](https://modrinth.com/plugin/simple-voice-chat/versions?g=1.21.1&l=fabric)。不安装的原版、Mineflayer 和基岩玩家仍能入服；真人麦克风语音识别为附近私有短字幕。基岩／原版浏览器音频桥尚未实现，不要宣传已经能听到音频。

可选本机 TTS 的简短流程：

```text
/voice voices
/voice voice <已有音色ID>
/voice auto on
```

之后本人的普通聊天同时发声，按语音距离送达。默认不开启自动配音，也不替所有人选择可米音色。私聊、命令、系统提示、ASR 字幕不配音。`/voice say <最多200字符>` 单独发声；`/voice stop` 取消本人语音；`/voice status <请求UUID>` 查询结果；`/voice captions off` 关闭本人附近字幕。

**推荐 Agent 在自己的机器生成音频后上传**，省掉服务端 TTS 推理；文字 TTS 保留为可选方式。上传仍需少量校验、重采样、Opus 编码及附近分发开销，不是零开销。两条路径二选一发送同一句话，不要同时 `say` 和 `upload`，也不默认打开自动配音。

调用现有本机 TTS 1.6.0，不更换默认音色、声库或推理模型。新建／上传音色继续使用现有 LAN TTS 音色管理接口，见 [LAN TTS](../lan-tts/README.md)。这里只列出和选择已有音色。

## 复用现有 Mineflayer 连接

```js
import {attachProximityVoice} from './client.mjs';
const voice = attachProximityVoice(bot); // bot 已由原框架登录
const result = await voice.say('我们去冒险者公会。', {
  requestId: crypto.randomUUID(), // 保存原 ID；超时后查它，不能生成新 ID 重播
  voice: '你选择的音色ID'
});
```

外部生成时，用同一个已登录连接上的 `voice.upload(wavBuffer, {requestId})`，无需调用 `say` 或提供服务端模型 Key。可上传 PCM16 WAV（单／双声道、8–96 kHz、0.1–30 秒、最多4 MiB），后台转换为48 kHz单声道；这个分支只调用媒体归一化，不调用 TTS。当前不接受 MP3、WebM、Ogg 或裸 Opus，不能改后缀冒充 WAV。`voice.status(requestId)` 查原请求。`onHearing` 参数可显式选择结构化附近语音事件；不传时仍使用现有聊天接收链路的短字幕。

上传音频本身不会自动生成文字字幕。希望其他 Agent 也理解内容时，可以同时发送对应的普通附近文字，并保持 `/voice auto off`，避免再合成一遍；不必把已知台词重新交给服务端 ASR。单独 `voice say` 也只是发声，不等于发送了一条聊天文字。

上传通过当前 Minecraft 连接，客户端不能指定其他角色 UUID。`mcagent:voice` 的原始协议为首字节1＋JSON控制或首字节2＋请求UUID的16字节＋大端32位序号＋最多16 KiB音频。服务端按连接确定身份、校验总长度/SHA256、隔离会话；内部桥令牌不下发给 Agent。配套 LoginGuard0.1.9 只增加此通道的实时授权门禁，原账号桥与密码库保持。

`queued`、`playing`、`sent`、`cancelled`、`failed`、`unknown` 分开处理。`sent` 只表示原音频帧自然耗尽并发送结束，不证明真人实际听见。断线、超时或重启不重播；未确认的旧记录保留未知状态。TTS 缓存最多64份／64 MiB／1小时，清缓存保留回执，不重新合成旧请求。原始麦克风 WAV 不持久保存。

## 构建和验证

```powershell
python build.py --paper E:/MC/server --svc E:/MC/ops/repairs/proximity-voice-20261029/voicechat-bukkit-2.6.27.jar --jdk E:/MC/jdk/jdk-21.0.12.1+1 --out E:/MC/builds/voice-new
python -m unittest discover -s service -v
node --test tests/client.test.mjs
```

Python 测试需先在独立 venv 安装 `service/requirements.txt`；模型从 [sherpa-onnx 官方 Paraformer 文档](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-paraformer/paraformer-models.html) 获取中文小模型的 `model.int8.onnx` 和 `tokens.txt`，模型不入 Git。`service/config.example.json` 只提供路径示例；在本机私有文件中生成至少32字符的桥令牌，并复制到 Paper `plugins/QiandengVoice/bridge.token`。服务只监听127.0.0.1，拒绝浏览器 Origin，TTS 目标仅允许数字内网／回环 HTTP 地址。

```powershell
python service/voice_service.py --config E:/MC/private/proximity-voice/service.json
```

测试专用 `QiandengVoiceQA.jar` 提供控制台音频夹具，绝不能装进正式服。构建产物和第三方 JAR 不入 Git。

完整验收、候选边界及正式维护见 [附近语音方案与实测](../../docs/PROXIMITY_VOICE.md)。

## Canonical client distribution

`client.mjs` is a dependency-free standalone distribution of `packages/agent-mc-world/core/proximity-voice.mjs`. Update the core first, then run `node sync-client.mjs`; verify with `node sync-client.mjs --check`. SDK users can import `agent-mc-world/proximity-voice`. Authentication/native-world gates and durable request recovery are supplied by the core World lane; the low-level helper never creates another bot.
