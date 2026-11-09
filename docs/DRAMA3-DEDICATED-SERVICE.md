# RTX 3090 Drama 3 局域网服务（现役）

2026-11-10 已部署官方 2026-10-29 重传的 Drama 3 权重 `78e5ab79e49aa9a25abe8799eff2c4d73a1c3216`，由固定转换器生成 CUDA/Q4 资产，继续使用最新正式 [drama-rs v0.3.0](https://github.com/apiplant/drama-rs/releases/tag/v0.3.0)。这次是实际模型资产升级，引擎正式版本未变。Windows 交互式计划任务 `Drama3-Speech` 运行 `tools/drama3/drama_rs_service.py`，在 WSL Ubuntu 24.04 中启动原生模型；原生引擎只监听 `127.0.0.1:18121`，Windows 网关监听 `0.0.0.0:18120`。入站防火墙规则 `Drama 3 speech LAN 18120` 只放行 `192.168.3.0/24`。无需 API 密钥。2026-10-29 的引擎切换和原 speech.cpp 运维记录分别见本页历史验收与 [历史文档](archive/DRAMA3-SPEECHCPP-SERVICE-2026-10-28.md)。

模型、二进制、参考录音和日志不入 Git。现役二进制仍在 `E:\ai-models\drama3-compare-20261029\drama-rs\`，新模型在 `E:\ai-models\drama3-upgrade-20261109\model-78e5ab7-q4\`；通过被忽略的 `server/drama3-service/runtime.json` 选择，原模型原样保留。运行状态与音色位于 `server/drama3-service/`；本次下载、转换、验收和回退证据位于本机 `E:\ai-models\drama3-upgrade-20261109\`。

## 固定权重来源与升级

网关支持从 `server/drama3-service/runtime.json` 读取本机选定的二进制和模型目录，也可用 `--runtime` 显式选择候选清单。清单包含 `schema_version:1`、`engine_version`、绝对路径 `binary` / `model`、二进制 SHA-256 `binary_sha256` 和模型资产清单的 SHA-256 `manifest_sha256`。缺少选择文件时沿用原默认模型；文件存在但校验失败时直接报错，不自动换回其他权重。

模型目录内的 `asset-manifest.json` 记录 `format:drama-rs-v1`、官方 `source_revision`、转换器 `converter_revision`，以及每个文件的 `name`、`bytes` 和 `sha256`。部署前逐项验证完整文件哈希；启动时绑定该清单、二进制哈希和必需文件大小，避免每次重启重复读取约 21 GB 权重。必须包含 40 层、globals、tower、codec 和 tokenizer，不能只更新显示的版本号。

`GET /v1/models` 的 `data[0].weights` 返回实际选定的公开来源信息，保留原 `id:drama-3`。原生引擎版本也须与选择清单一致。查询时应看这份来源，而非仅凭模型目录日期判断是否升级。

```powershell
Invoke-RestMethod 'http://192.168.3.133:18120/v1/models' | ConvertTo-Json -Depth 8
Get-Content 'server/drama3-service/runtime.json'
```

候选可用单独状态目录及 `--host 127.0.0.1 --port 18130 --native-port 18131` 验证。单张 3090 须逐个运行模型。切换前保存原选择清单、任务 XML 和全部音色文件哈希；失败时恢复原选择并重新做真实音频检查。原维护文件继续控制看门狗，不能让看门狗在转换或候选验收期间另起模型。

看门狗通过 `drama_rs_service.py --cleanup-only` 清理当前配置的原生子进程；按二进制路径、`serve` 和回环地址/端口匹配，保留不同端口或不同二进制。先 TERM 并等待，未退出才 KILL，再确认释放；实际端口空闲检查在 WSL 内完成。无法确认退出或端口仍被占用时拒绝重复加载。启动失败和正常关闭也执行相同清理。

截至本次核查，最新正式 `drama-rs` 仍为 v0.3.0；官方 Python 推理器的 [参考采样更新](https://github.com/fishaudio/fish-speech/pull/1368)（源码 `0f8a12e8a651062fdee9c33a894bdccd3a8513f1`）与 `epsilon_cutoff` 属于另一实现，现役参数以 `/v1/capabilities` 为准。网关在向引擎派发及开启音频流前验证有限采样值、`top_k` 及 64-bit seed，避免无效请求变成后置流错误。

本次源权重的 24 个文件共 41,502,569,692 字节，逐项校验 Hub 文件大小及 LFS SHA-256 / Git blob 哈希；转换器为 `498f18c0b403006f207db121df8c70e024b2453a`。新资产清单包含 47 个文件，清单 SHA-256 为 `4dbeaddb578f291820845664efe1b998a589313d045339b0da6fdb183501db55`。源版本见 [官方提交历史](https://huggingface.co/fishaudio/drama-3/commits/main)；权重重新上传本身不证明音质提升。

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

2026-11-10 升级验收：先用原模型保存六组真实音频基线，再在隔离端口连续两轮测试可米长句、短句、中文名字/坐标句、桐人、结衣、双人，共 12 组 WAV，并验证兼容 SSE。切换正式 LAN 地址后同样的六组 WAV 与 SSE 再次通过，`/v1/models` 确认新来源；输出均为 44.1 kHz 单声道 PCM16，非静音，SSE 实际 PCM 样本数与尾事件一致，停止原因仍为 `unknown`。

正式可米 204 字单请求生成 **46.626 秒**音频，首段 **0.601 秒**、总耗时 **9.790 秒**，PCM SHA-256 为 `a264b848e1ea2ef5ce1ff8d9163a0e9eb7aa4b516f54f05ea69963bad28e269d`。候选验收期间 30 次整卡显存采样最大 **22,296 MiB**、最小剩余 **2,031 MiB**；这不是单进程隔离值或完整冷启动峰值。全部原音色目录 65 个文件的 SHA-256 与升级前相同。正式任务保持 `lzl1992` Interactive，确认仅一个原生 18121 模型进程，维护闸门已撤下，看门狗健康检查退出 0；网关日志另记录局域网 `192.168.3.152` 成功合成，不据此推断该设备的人工播放效果。语音内容、克隆质量与语气主观听感仍需试听。

本次源码验证：Windows 单元测试 27 项中 24 项通过、3 项 Linux 进程测试按平台跳过；同三项在 WSL 实跑通过，覆盖 TERM、忽略 TERM 后 KILL、保留其他端口/二进制及拒绝占用端口。真实音频报告分别在本机升级目录的 `candidate-acceptance/report.json` 和 `production-acceptance/report.json`，旧模型基线在 `baseline-2/report.json`。这些本机结果不等于任意新机器已完成部署。

以下为 2026-10-29 初次切换的历史结果，不是新版权重结果：

2026-10-29 在正式 LAN IP 上验收：可米 204 字单请求 `split:false` 的音频为 **45.047 秒**、首段 **0.479 秒**、整次生成 **9.558 秒**，PCM SHA-256 `6448a1e192d504192121b9088c6eaa06d3c479f6618e1a11c42f5dba0f999222`，与先前用户试听认为“稳定完整”的 drama-rs 隔离样本相同。短句、中文名字/坐标句、桐人、结衣、双人及一段 `[whisper]` 文本都生成了有效 WAV；双人/语气的主观听感尚未单独由用户验收。兼容 SSE 实测最后 `samples` 与收到的 PCM 字节数一致，`stop:"unknown"` 如实暴露上游限制。原始请求、WAV 和报告在 `server/drama3-service/drama-rs-acceptance/`。目前仅从本机访问自身 LAN IP，外部设备的当前连接与播放须从该设备确认。

常用检查：

```powershell
Get-ScheduledTask -TaskName Drama3-Speech,Drama3-Watchdog
Invoke-RestMethod 'http://192.168.3.133:18120/health'
Invoke-RestMethod 'http://192.168.3.133:18120/v1/audio/voices'
& 'C:\Python314\python.exe' 'D:\Projects\QiandengJi\tools\drama3\drama_rs_health.py' --base 'http://192.168.3.133:18120'
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader,nounits
```

每分钟的 `Drama3-Watchdog` 检查 Windows 网关与任务，重启前按精确二进制和回环端口清理残留原生进程。`Drama3-Speech` 应保持交互式用户任务；现役模型在 WSL 的冷启动约 60–90 秒，不能只依据任务 Running 或 `/health` 推断真实合成。本次权重回退应设置原维护闸门，停语音任务并用当前选择执行 `drama_rs_service.py --cleanup-only`，再恢复升级前的 `runtime.json`；本机升级前无此文件，撤下选择文件即回到原默认目录。随后启动任务，做真实音频验收并恢复看门狗。备份在本机升级目录 `backup/`。不能同时运行新旧 GPU 模型。

`tools/drama3/Switch-Drama3Rs.ps1` 是 2026-10-29 从 speech.cpp 切换引擎的历史脚本，不用于本次权重回退。只有明确需要回到旧 speech.cpp 时才恢复其备份任务 XML，并按历史文档重新验收，不能混用两种引擎的参数与音色格式。

本轮没有重启 Minecraft、Cortico、IndexTTS、QwenPaw 或 LLM 服务。Drama 3 模型的使用和真人参考音授权仍受 [Fish Audio Community License](https://huggingface.co/fishaudio/drama-3/blob/main/LICENSE) 约束。
