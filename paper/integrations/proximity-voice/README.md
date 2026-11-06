# 千灯纪附近语音

2026-11-06 已部署 QiandengVoice 0.1.3：真人麦克风转写在附近聊天显示为 `[附近][语音识别] 玩家名：内容`，本人也能看到识别结果；保留 0.1.2 的 Agent 语音桥连接状态修复。正式运行版本和原账号数据已核对，详见[附近转写与验证](../../docs/VOICE_ASR_CHAT_20261106.md)和[Agent 连接状态](../../docs/VOICE_BRIDGE_PRESENCE_20261106.md)。

2026-11-06：QiandengVoice 0.1.1 已正式加载，提供收听状态、无接收端提示及分阶段错误；配套 MC 核心仍是已验证的本地候选，远端客户端未自动升级。见[发送与收听诊断及部署边界](../../docs/VOICE_DELIVERY_DIAGNOSTICS_20261106.md)。`sent` 不等于已听到；首次使用 Simple Voice Chat 须完成客户端设置并开启收听，麦克风可以保持静音。

2026-11-06：媒体服务误用基础 Python 导致上传音频准备失败，已切回现有语音虚拟环境；依赖预检、Windows 子进程接管和真实 HTTP 重采样已验证，守护重启后仍就绪。原失败请求不重播；独立 Java 录音复验仍待完成，见[修复与验收边界](../../docs/NUMEN_VOICE_REPAIR_20261106.md)。

2026-11-05：配套 LoginGuard 的 `mcagent:voice` 回程误拦已随 PR 批次上线，见[双向授权修复](../../docs/VOICE_PROXY_REPLIES_20261105.md)和[部署记录](../../docs/PR_BATCH_RELEASE_20261105.md)。代理上线不等于正式 TTS/ASR/真人听感验收。

状态（2026-10-29）：Simple Voice Chat 2.6.27、QiandengVoice 0.1.0 与本机 TTS/CPU ASR 已安装正式服并自启。局域网 UDP 已实收 nonce 回包；公网映射已补，外网及真人麦克风/耳听验证状态见[发布说明](../../docs/PROXIMITY_VOICE.md)。

这是一层可选语音传输，不创建新的 Agent 大脑或 Minecraft 连接。复用 `world/god-voice-src` 的 `SpeechFrames`、`SpeechLane`、`CaptureFence`；ASR 每段只识别一次，再向附近角色分发。

## 玩家和 Agent 的入口

Java 玩家听说需安装与游戏版本匹配的 [Simple Voice Chat 客户端](https://modrinth.com/plugin/simple-voice-chat/versions?g=1.21.1&l=fabric)。不安装的原版、Mineflayer 和基岩玩家仍能入服；真人麦克风语音识别为附近私有短字幕。基岩／原版浏览器音频桥尚未实现，不要宣传已经能听到音频。

0.1.3 会在一段话结束、识别完成后向说话者和同世界有效语音距离内的人显示转写；普通语音上限48格，悄悄话使用更短距离，私有语音组不公开转写。无需额外发送聊天命令；`/voice captions off` 只关闭本人接收，`/voice captions on` 恢复。订阅结构化 `nearby_voice` 的 Agent 仍只收到一份事件，其他客户端直接看到聊天文字。转写含 `!` 或 `/` 也只是识别内容，不会执行命令、变成全服喊话或再次自动配音。

可选本机 TTS 的简短流程：

```text
/voice voices
/voice voice <已有音色ID>
/voice auto on
```

之后本人的普通聊天同时发声，按语音距离送达。默认不开启自动配音，也不替所有人选择可米音色。私聊、命令、系统提示、ASR 字幕不配音。`/voice say <最多200字符>` 单独发声；`/voice stop` 取消本人语音；`/voice status <请求UUID>` 查询结果；`/voice captions off` 关闭本人附近字幕。不带参数的 `/voice status` 检查本人收听并提供下一步；管理员控制台可查 `/voice status <接收角色> [声源角色]`。

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

启用语音适配器时通过 `minecraft:register` 注册 `mcagent:voice`，并发送既有 `subscribe` 请求确认实际接入，字幕仍按原选项选 `chat` 或 `events`；关闭适配器时只注销该通道，游戏连接保留。MC 核心 `0.5.7-rc.160-preview.21` 及这里的 `client.mjs` 已实现这一生命周期。代理的通道声明本身不算接入证据；旧适配器第一次有效请求也能同步状态。不要另建听音账号、伪装已安装客户端模组或只在播放时临时改变状态。`VOICE_BRIDGE_CONNECTED` 表示上传／字幕桥接，不表示能接收原生 UDP 音频，也不证明别人已经听到。

`queued`、`playing`、`sent`、`cancelled`、`failed`、`unknown` 分开处理。`sent` 只表示原音频帧自然耗尽并发送结束，不证明真人实际听见。断线、超时或重启不重播；未确认的旧记录保留未知状态。TTS 缓存最多64份／64 MiB／1小时，清缓存保留回执，不重新合成旧请求。原始麦克风 WAV 不持久保存。

## 构建和验证

```powershell
python build.py --paper E:/MC/server --svc E:/MC/ops/repairs/proximity-voice-20261029/voicechat-bukkit-2.6.27.jar --jdk E:/MC/jdk/jdk-21.0.12.1+1 --out E:/MC/builds/voice-new
python -m unittest discover -s service -v
node --test tests/client.test.mjs
```

Python 测试需先在独立 venv 安装 `service/requirements.txt`；模型从 [sherpa-onnx 官方 Paraformer 文档](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-paraformer/paraformer-models.html) 获取中文小模型的 `model.int8.onnx` 和 `tokens.txt`，模型不入 Git。`service/config.example.json` 只提供路径示例；在本机私有文件中生成至少32字符的桥令牌，并复制到 Paper `plugins/QiandengVoice/bridge.token`。服务只监听127.0.0.1，拒绝浏览器 Origin，TTS 目标仅允许数字内网／回环 HTTP 地址。

```powershell
E:/MC/runtime/qiandeng-voice/Scripts/python.exe service/voice_service.py --config E:/MC/private/proximity-voice/service.json
```

Windows 常驻入口为 `service/media-supervisor.ps1`。`-Python` 必须指向安装了 `service/requirements.txt` 的同一虚拟环境，不要替换成基础 Python 或依赖 PATH。`/health` 应同时确认 `asrLoaded=true`、`asrDevice=cpu`；仅有任务处于 Running 不能证明服务可用。

测试专用 `QiandengVoiceQA.jar` 提供控制台音频夹具，绝不能装进正式服。构建产物和第三方 JAR 不入 Git。

完整验收、候选边界及正式维护见 [附近语音方案与实测](../../docs/PROXIMITY_VOICE.md)。
