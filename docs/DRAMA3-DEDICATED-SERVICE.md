# RTX 3090 Drama 3 局域网服务（现役）

2026-10-29 已将 `192.168.3.133:18120` 从 speech.cpp 切换到 [drama-rs v0.3.0](https://github.com/apiplant/drama-rs)。Windows 交互式计划任务 `Drama3-Speech` 运行 `tools/drama3/drama_rs_service.py`，在 WSL Ubuntu 24.04 中启动 CUDA/Q4 原生模型；原生引擎只监听 `127.0.0.1:18121`，Windows 网关监听 `0.0.0.0:18120`。入站防火墙规则 `Drama 3 speech LAN 18120` 只放行 `192.168.3.0/24`。无需 API 密钥。原 speech.cpp 运维记录保存在 [历史文档](archive/DRAMA3-SPEECHCPP-SERVICE-2026-10-28.md)。

模型、二进制、参考录音和日志不入 Git。现役二进制和 Q4 模型位于 `E:\ai-models\drama3-compare-20261029\drama-rs\`；运行状态、上传的音色与试听证据位于被忽略的 `server/drama3-service/`。

## 接口与能力

| 路径 | 用途 |
| --- | --- |
| `GET /`、`GET /docs`、`GET /openapi.json` | 原生录音工作台与 API 文档，均经 18120 转发 |
| `GET /health`、`GET /v1/info`、`GET /v1/models`、`GET /v1/capabilities` | 运行状态和真实能力清单 |
| `POST /v1/speak` | 首选：单请求连续生成、随生成流出 44.1 kHz 单声道 PCM16 WAV |
| `GET /v1/voices` | 当前可选音色 ID |
| `POST /v1/voices?name=ID&text=逐字稿` | 原生格式：请求体为参考 PCM WAV；编码后返回 `ok` |
| `POST /v1/audio/voices`、`GET /v1/audio/voices`、`GET /v1/audio/voices/ID` | 兼容格式：multipart 注册及带状态查询 |
| `POST /v1/audio/speech` | 兼容旧客户端的 WAV、裸 PCM 或 SSE 流；有下面列明的参数差异 |

支持 `cormy`、`kirito`、`yui`、`none`，以及 `cast`。`cast` 是网关上的双说话人组合：`<|speaker:0|>` 用桐人，`<|speaker:1|>` 用结衣。原生多角色可传 `"voices":["kirito","yui"]` 或 `"voices":{"0":"kirito","1":"yui"}`；`/v1/speak` 也接受 `text/plain` 的无音色原文。未知音色明确返回 400，不会回退到其他角色。普通合成一次只占用一个模型槽；网关在排队时检查断开的客户端，模型内部已开始的生成目前不能保证立即取消。

原生文本中的 `[whisper]`、`[laughs]` 等表达标记会原样交给 Drama 3；可用相应词句及标点表达语气，效果须以实际试听为准。`temperature`、`top_k`、`top_p`、`seed` 是模型采样参数，不是语速或情绪强度参数。**drama-rs v0.3.0 没有原生数值 `speed` 或结构化 `emotion` 参数**；传入未支持的成员会报 400，不会伪装成生效。不要在参考文本外补写说话人、拼音或情绪标签。上游契约见 [HTTP server](https://github.com/apiplant/drama-rs#http-server) 和 [Drama 3 模型说明](https://github.com/fishaudio/fish-speech)。

## 合成：客户端应改用原生单请求

把完整台词放进**一次** `POST /v1/speak`，设置 `split:false`。不要由客户端逐句发起独立克隆后拼接，也不要设置 `split:true`。当前本机 `max_new` 为 1–2048 个模型声学帧的预算，默认 2048；它**不是秒数**。`stream:true` 边生成边发送 WAV，WAV 头使用流式未知长度，播放和存储时以实际收到的 PCM 字节为准。采样率始终是输出的 **44100 Hz**，不要拿可米参考音的 48000 Hz 当输出采样率。

```bash
curl -sS -N 'http://192.168.3.133:18120/v1/speak' \
  -H 'Content-Type: application/json' \
  --data-raw '{"text":"你好，我是可米。","voice":"cormy","seed":20261021,"split":false,"stream":true,"top_k":4097,"max_new":2048}' \
  -o cormy.wav
```

双人和语气示例：

```json
{
  "text": "<|speaker:0|> 结衣，我们先去那座山上看看。<|speaker:1|> [whisper] 好呀，桐人，我会跟着你。",
  "voices": ["kirito", "yui"],
  "seed": 17,
  "split": false,
  "stream": true,
  "max_new": 2048
}
```

当前模型工作台位于 `http://192.168.3.133:18120/`，可在局域网浏览器中选择音色、填写逐字稿、安排多说话人并试听。网页端与接口同源，无需跨域设置。

### 原接口迁移细节

`POST /v1/audio/speech` 仍接受 `model:"drama-3"`、`input`、`voice`、`response_format:"wav"|"pcm"`、`stream_format:"sse"`、显式 `seed` 和采样参数；新客户端应改用 `max_new`。为避免现有局域网调用方立即断音，旧 `max_seconds` 暂接受大于 0 且不超过 30 的数值，**但仅作兼容提示，不执行精确秒数限制**；响应头 `X-Legacy-Max-Seconds: advisory-only; use max_new`，SSE 尾事件的 `legacy_max_seconds_enforced:false` 也明确说明。因为新引擎无法精确保证“每块/整句多少秒”，绝不能把此参数当作已生效。`options`、数值 `speed`、结构化 `emotion` 仍明确拒绝。迁移另一台机器上的调用方时，优先直接切到 `/v1/speak` 并消费流式 WAV。

兼容 SSE 保留 `speech.audio.delta`（base64 PCM16）和 `speech.audio.done`（实际发送的 `samples`、`seed`、`stop`）。drama-rs v0.3.0 的生成接口没有公开 EOS 与声学帧上限的区别，因此正常传输结束时 `stop:"unknown"`，传输错误才报 `stop:"error"`；**不能据 HTTP 200 或有声音将其当作 `complete`**。裸 PCM 流本身不含终态。WAV 兼容响应的 `X-Speech-Stop` 同样为 `unknown`。若业务必须区分自然完成和截断，需先给上游引擎补真实终止原因，再升级客户端契约；这项能力目前尚未恢复到原 speech.cpp 水平。

## 音色上传、查询和重启复用

**现有可米资料未重新注册或替换。** `server/drama3-service/voices/cormy/` 中原 `reference.wav`、`reference.txt`、`voice.gguf` 的 SHA-256 分别仍为 `b40ec6f0799071da8b4d7c3176267034a2442ab7c06c88f1785d2ac131051c7d`、`4d403427fbd957a920a91a4b172f5213f80fa6ff024cb8ecb0890d646812ea16`、`3ae79d3e3dfef209fc50c24b2ee085d5f7a9e41a79d4243a023b4940663a5ed3`。新引擎使用保留的 WAV 和逐字稿在进程启动时编码一次，之后的每次合成复用**进程内**条件；旧 GGUF 原样保留供回退，但 drama-rs 不读取这种 speech.cpp 格式。上游尚不提供可跨进程复用的编码条件文件，重启时会重新从原 WAV/逐字稿编码。这是相对旧服务的持久化能力差异，不能声称原 GGUF 已被新引擎加载。

新音色可通过任一格式上传。参考录音须为未压缩 PCM WAV、16/24/32-bit、单或双声道、8–96 kHz、3–20 秒、至多 16 MiB；逐字参考文本必填，需与录音中的每个字相符。`voice_id` 为小写字母开头，后面可用小写字母、数字、下划线或短横线，最长 32 字符。已存在的 ID 不可覆盖。原生上传在模型编码成功后返回 `ok`；兼容 multipart 接口同步返回 `ready` 或带明确原因的 `failed`。两种格式都将原 WAV、原文、哈希和版本写入 `server/drama3-service/drama-rs-voices/<voice_id>/`，重启时校验并预载。列表和单项查询都能查看状态。

```bash
curl -sS 'http://192.168.3.133:18120/v1/voices?name=new_voice&text=%E8%BF%99%E9%87%8C%E5%86%99%E9%9F%B3%E9%A2%91%E7%9A%84%E9%80%90%E5%AD%97%E7%A8%BF' \
  -H 'Content-Type: audio/wav' --data-binary @new_voice.wav
curl -sS 'http://192.168.3.133:18120/v1/audio/voices/new_voice'
curl -sS 'http://192.168.3.133:18120/v1/voices'
```

```bash
curl -sS -X POST 'http://192.168.3.133:18120/v1/audio/voices' \
  -F 'voice_id=another_voice' \
  -F 'model=drama-3' \
  -F 'reference_text=音频中真实说出的逐字稿' \
  -F 'audio=@another_voice.wav;type=audio/wav'
```

正式环境用现有**桐人 QA 录音**新注册 `qa_rs_kirito_20261029`，而非再次注册可米。该 ID `ready` 后的同文本/seed PCM 与无参考生成不同；仅重启 `Drama3-Speech` 及 WSL 引擎后，它仍为 `ready`，同请求 PCM SHA-256 保持 `f828ee6adf451173f558636682fab7f0549c7f7e83dc976703f4dad49b64cb2e`。这证明新接口实际使用上传参考和重启恢复；不代表所有未来参考音的主观克隆质量。

## 本机验收与运维

2026-10-29 在正式 LAN IP 上验收：可米 204 字单请求 `split:false` 的音频为 **45.047 秒**、首段 **0.479 秒**、整次生成 **9.558 秒**，PCM SHA-256 `6448a1e192d504192121b9088c6eaa06d3c479f6618e1a11c42f5dba0f999222`，与先前用户试听认为“稳定完整”的 drama-rs 隔离样本相同。短句、中文名字/坐标句、桐人、结衣、双人及一段 `[whisper]` 文本都生成了有效 WAV；双人/语气的主观听感尚未单独由用户验收。兼容 SSE 实测最后 `samples` 与收到的 PCM 字节数一致，`stop:"unknown"` 如实暴露上游限制。原始请求、WAV 和报告在 `server/drama3-service/drama-rs-acceptance/`。目前仅从本机访问自身 LAN IP，外部设备的当前连接与播放须从该设备确认。

常用检查：

```powershell
Get-ScheduledTask -TaskName Drama3-Speech,Drama3-Watchdog
Invoke-RestMethod 'http://192.168.3.133:18120/health'
Invoke-RestMethod 'http://192.168.3.133:18120/v1/audio/voices'
& 'C:\Python314\python.exe' 'D:\Projects\QiandengJi\tools\drama3\drama_rs_health.py' --base 'http://192.168.3.133:18120'
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader,nounits
```

管理员切换脚本 `tools/drama3/Switch-Drama3Rs.ps1` 仅更改 `Drama3-Speech` 动作，先写 `server/drama3-service/before-drama-rs-task.xml`，加载后实测四种音色，失败时恢复旧动作；结果与日志在同一被忽略状态目录。每分钟的 `Drama3-Watchdog` 检查 Windows 网关与任务，重启前清理其可能遗留的同名 WSL 模型进程。`Drama3-Speech` 应保持交互式用户任务；现役模型在 WSL 的冷启动约 60–90 秒，不能只依据任务 Running 或 `/health` 推断真实合成。回退时须先停新任务和同名 WSL `drama` 进程，再将计划任务动作恢复为备份 XML 中的 `voice_service.py` 并做旧音色真实合成。不要同时运行新旧模型以免 24 GB 显存溢出。

本轮没有重启 Minecraft、Cortico、IndexTTS、QwenPaw 或 LLM 服务。Drama 3 模型的使用和真人参考音授权仍受 [Fish Audio Community License](https://huggingface.co/fishaudio/drama-3/blob/main/LICENSE) 约束。
