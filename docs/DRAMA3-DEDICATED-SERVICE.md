# RTX 3090 专用 Drama 3 语音服务

本机采用 [speech.cpp v0.9.0](https://github.com/nyosegawa/speech.cpp/releases/tag/v0.9.0) Windows Vulkan 运行时与 [Drama 3 Q4_K GGUF](https://huggingface.co/sakasegawa/drama-3-GGUF)。此组合已在实体 RTX 3090 24GB 上实测参考音克隆、流式 PCM 和双人对话，比本机 ComfyUI W6A8 热请求更适合直播短句；性能及中文错词记录见 [实测报告](research/DRAMA3-LOCAL-DEPLOYMENT-2026-10-28.md)。权重、二进制、参考音和运行日志位于被 Git 忽略的 `E:\ai-models\drama3-20261028\speechcpp`。

## 接口

- 本机：`http://127.0.0.1:18120/v1`
- 家庭局域网：`http://192.168.3.133:18120/v1`
- 健康：`GET /health`，返回 `{"status":"ok"}`
- 模型：`GET /v1/models`，当前模型 ID 为 `drama-3`
- 合成：`POST /v1/audio/speech`，音色为 `cormy`、`kirito`、`yui`、`cast`，也可用 `none`
- 自定义音色：`POST /v1/audio/voices`、`GET /v1/audio/voices`、`GET /v1/audio/voices/{voice_id}`

`cast` 是同一段音频中的两个人物：桐人用 `<|speaker:0|>`，结衣用 `<|speaker:1|>`。短句直播建议 `response_format: "pcm"`，服务端边生成边发 44.1kHz、16-bit、单声道 PCM；需要普通文件时设 `"wav"`。`top_k: 4097` 是本机已验证的设置；固定 `seed` 可重现同一设备上的音频。服务一次处理一个合成请求，调用端应限制排队与超时。[接口文档](https://github.com/nyosegawa/speech.cpp/blob/main/docs/server.md)

当前默认和本机上限都是 `max_seconds: 30`，**单位是 speech.cpp 每个原生文本块，不是整次 HTTP 请求**。原生模型自动将长文本按约 300 UTF-8 字节切块，在同一个 `speech_synthesize` 请求内让后块继承首块和近期块的声学历史；服务不另行拆句发起独立克隆。先前的 10 秒本机限制曾使 204 字测试台词约 28.793 秒后以 `max_seconds` 结束；改为每块 30 秒后，同一台词约 46.997 秒并返回 `complete`。该模型没有 `options.text_chunk_size`、`text_chunk_mode` 参数；请求选项直接放在 JSON 顶层，`max_seconds` 最高 30。`seed` 可显式传入 0 至 2^53−1；未传时服务为**每个请求**抽取一次并返回，固定 seed 仅用于重现样本，不能代替音色试听。上游契约见 [Drama 3 模型说明](https://github.com/nyosegawa/speech.cpp/blob/main/docs/models/drama3.md)。

Python 标准库调用示例：

```python
import json
import urllib.request

body = {
    "model": "drama-3", "voice": "kirito",
    "input": "<|speaker:0|> 大家晚上好，我是桐人。",
    "response_format": "wav", "top_k": 4097, "max_seconds": 30,
}
request = urllib.request.Request(
    "http://192.168.3.133:18120/v1/audio/speech",
    data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=120) as response:
    audio = response.read()
with open("kirito.wav", "wb") as output:
    output.write(audio)
```

该服务不要求密钥，也没有 TLS；Windows 入站规则应只允许 `192.168.3.0/24` 的 TCP 18120。不能将它直接映射到公网。其余机器的真实连通性必须从该机器发起 HTTP 请求验证，本机访问自身 LAN IP 只能证明监听和本机路由。

## 自定义音色注册与复用

Drama 3 的原生契约是：**参考录音必须配准确的逐字参考文本**，先由模型 codec 编码成 `*.voice.gguf`，再加载到运行模型。原生 `speech serve` 不提供注册接口，也不能把 WAV 直接作为 Drama 3 音色加载；本站的接口通过 speech.cpp 0.9.0 C API `speech_voice_make_from` 和 `speech_voice_add` 完成这两步。[模型说明](https://github.com/nyosegawa/speech.cpp/blob/main/docs/models/drama3.md)、[C API](https://github.com/nyosegawa/speech.cpp/blob/main/docs/c-api.md)

注册请求为 `multipart/form-data`，字段 `voice_id`、`audio` 和 `reference_text` 必填，`model` 可选且只能是 `drama-3`。`voice_id` 使用小写英文字母开头，后续可用小写字母、数字、下划线和短横线，最长 32 字符；已有 ID 及 `none`、`kirito`、`yui`、`cast` 不可覆盖。**`cormy` 已由调用方注册并处于 ready；不要覆盖或重新注册她的参考资料。**下面只示例未来新音色的注册格式：

```bash
curl -sS -X POST 'http://192.168.3.133:18120/v1/audio/voices' \
  -F 'voice_id=new_voice_id' \
  -F 'model=drama-3' \
  -F 'reference_text=这里填写音频中实际说出的每一个字' \
  -F 'audio=@new_voice.wav;type=audio/wav'
curl -sS 'http://192.168.3.133:18120/v1/audio/voices/new_voice_id'
curl -sS 'http://192.168.3.133:18120/v1/audio/voices'
```

注册返回 HTTP 202、`status: "pending"` 和对应的 `Location`；轮询单项直到 `ready` 后才可合成。编码或热加载失败为 `failed`，`error` 写明原生失败原因；未知 ID 的查询为 404。输入必须是未压缩的 **16/24/32-bit PCM WAV**，单声道或双声道、8–96 kHz、**3–20 秒**、至多 **16 MiB**。服务端保留原 WAV 和原文，原生编码器会混成单声道并重采样至 44.1 kHz。MP3、AAC、WAV 浮点格式应先转换为 PCM WAV。参考文本必填，需与录音实际说的话一致；服务无法自动核对逐字准确性，错配会影响克隆质量。

`ready` 后合成：

```bash
curl -sS 'http://192.168.3.133:18120/v1/audio/speech' \
  -H 'Content-Type: application/json' \
  --data-raw '{"model":"drama-3","input":"你好，我是可米。","voice":"cormy","seed":20261021,"response_format":"wav","max_seconds":30,"top_k":4097}' \
  -o cormy.wav
```

输出 WAV 为 **44.1 kHz、16-bit、单声道**，与 `cormy` 的 **48 kHz 参考录音**无关；WAV 响应的 `X-Speech-Stop` 标明 `complete`、`max_seconds` 或 `model_limit`。`response_format: "pcm"` 为边生成边输出的原始 PCM16；`stream_format: "sse"` 的 `speech.audio.delta` 携带 base64 PCM，最后的 `speech.audio.done` 携带实际已发样本数、seed 和 stop。SSE 原生错误在可写连接上以 `stop: "error"` 和错误文字收尾；客户端断开时原生请求取消，已断连接无法接收尾事件，服务日志记录 `cancelled`。原始 PCM 流不含尾事件，需要终态的调用方应选 SSE；其生成失败时连接被截断。未知音色返回 HTTP 400 `unsupported_value`；`pending` 和 `failed` 返回 HTTP 409 `voice_not_ready`，**不会自动改用现有音色或默认音色**。

注册资料位于被 Git 忽略的 `server/drama3-service/voices/<voice_id>/`：`reference.wav`、`reference.txt`、`voice.gguf` 与 `manifest.json`。清单记录 schema/引擎版本、codec 哈希、音频与原文 SHA-256、编码 GGUF SHA-256、时间和状态。注册异步编码一次，热加载成功才标记 `ready`；合成只用缓存的 GGUF。服务重启时校验哈希并直接热加载所有 `ready` 音色，恢复 `pending` 作业，保留 `failed` 原因。当前接口不提供同名覆盖或删除。

本机隔离测试使用**现有桐人测试录音**注册 `qa_kirito`，不是可米录音：2026-10-28 11:50 接口先返回 pending，约 4 秒后 ready，编码产物 6144 字节；同一文本和 seed 123 下 `qa_kirito` 与 `yui` 的 WAV 时长分别为 3.947 秒和 3.065 秒，SHA-256 不同。测试服务重启后 GGUF 哈希和修改时间未变，`qa_kirito` 自动恢复为 ready，同一合成的 SHA-256 仍为 `80f9a13cda59d2060790fe246da29ff21064bddba7f38215aac1e065ae9059e9`。这证明独立音色经原生路径影响合成以及重启复用；可米本人音色的听感仍需调用方上传后验收。

正式端口另注册了 `qa_kirito_20261028`，明确是桐人 QA 录音。注册返回 pending 后转为 ready；固定文本与 seed 123 的 WAV SHA-256 为 `c125605e4f00000e6c8fff4b5c8ba88d4ce25ca1fb6fa04da4d78613199a53e7`，同设置下 `yui` 为 `a4875b0385216945b020c11a64752505a0b38bea645166a4bf954cd888d1b1c6`。正式任务重启后，缓存 GGUF 的 SHA-256 和修改时间均不变，QA 合成哈希仍一致。看门狗实际恢复任务后，QA 合成及桐人、结衣、`cast` 三段再验通过。后来调用方真实上传了 `cormy`，这段早期 QA 历史不再代表她的当前音色状态；当前状态与长台词验收见下节。

### 一次生成的长台词与流式终态

可执行的 SSE 请求 JSON；**整条台词只发一次**，不用客户端逐句另行克隆后拼接：

```json
{
  "model": "drama-3",
  "voice": "cormy",
  "input": "今晚的风把村口的灯吹得轻轻摇晃，可米和桐人沿着石桥走到河边，结衣在后面提醒我们别踩进浅水。地图上显示营地在东侧的山坡，坐标是X一百二十八、Y六十四、Z负三百零二，我们先核对方位，再沿着火把一直向前。到了树林边缘，我发现一只小狐狸躲在倒下的树旁，背包里的面包还剩三块，大家可以在聊天里帮我决定先补给还是先搭一座桥。如果夜色突然变深，我们就回到亮着灯的屋子，记下今天看到的路标，明天继续探索这片陌生又漂亮的世界。",
  "seed": 20261021,
  "max_seconds": 30,
  "top_k": 4097,
  "response_format": "pcm",
  "stream_format": "sse"
}
```

将 JSON 保存为 `request.json` 后执行 `curl -sN -H 'Content-Type: application/json' --data-binary @request.json http://192.168.3.133:18120/v1/audio/speech`。本仓库的 `tools/drama3/longform_probe.py` 会发送同一类请求，把每个 delta 记录并还原为可试听的原始 WAV；`tools/drama3/disconnect_probe.py` 验证运行中断线，`tools/drama3/queue_disconnect_probe.py` 验证排队中断线。探针只写入被 Git 忽略的 `server/drama3-service/longform-acceptance/`。

2026-10-28 20:07–20:11 正式 RTX 3090 验收：`cormy` 是 `ready` 且模型真实列出该音色；原参考 WAV、逐字稿、GGUF 的 SHA-256 分别为 `b40ec6f0799071da8b4d7c3176267034a2442ab7c06c88f1785d2ac131051c7d`、`4d403427fbd957a920a91a4b172f5213f80fa6ff024cb8ecb0890d646812ea16`、`3ae79d3e3dfef209fc50c24b2ee085d5f7a9e41a79d4243a023b4940663a5ed3`，升级前后相同，未重新注册或编码。204 字/606 UTF-8 字节长句在旧每块 10 秒限制下首段 0.595 秒、28.793 秒音频、`stop=max_seconds`；改为每块 30 秒后，首段 0.467 秒、总请求 45.698 秒、46.997 秒音频、`stop=complete`、`samples=2072576`，与实际 PCM16 样本数相同，未见 Vulkan OOM。短句和名字/坐标句也以 `complete` 收尾，首段分别在 1.003 和 2.854 秒到达；名字句首段受串行队列等待影响。相同短句/seed 的直接 WAV 与 SSE 还原 WAV 的 PCM 逐字节一致，直接 WAV 响应 `X-Speech-Stop=complete`、`X-Sample-Rate=44100`。长 SSE 首段后主动断线，原生请求约 0.8 秒内记录为 `stop=cancelled`。

20:25 再次**仅重启 `Drama3-Speech`**；日志在 20:26:03 记录模型与 `cormy` 就绪，20:26:06 的首条合成即为相同 204 字长句。冷机首段 1.059 秒、总请求 51.969 秒、音频 46.997 秒、`stop=complete`，PCM 哈希与热机相同，未复现 Vulkan OOM。显式 `max_seconds=1` 的短句真实返回 `stop=max_seconds`、`samples=43008`，证明截断终态没有被改写为成功。排队取消实测：第一条正在合成的请求断线后记录 `stop=cancelled samples=24576`，其后排队且已断线的另一请求记录 `stop=cancelled samples=0`，没有进入模型生成。冷机后 `cormy`、`kirito`、`yui`、`cast` 四音色真合成冒烟再次通过。

独立 CPU Qwen3-ASR-0.6B 对 47 秒长 WAV 转写出了从开头到结尾的所有句段，未发现整段台词缺失；短句逐字一致。它把长句中部分人物名写成近音字，名字/数字坐标句还把 `Z=-302` 识别成正数；这可能是 TTS 发音，也可能是 ASR 错词，**不能据此宣称专名和负号发音已准确**。用户于 20:22 试听下方的 204 字单请求原始 WAV，反馈“全程音色基本一致”；该人工听感只覆盖这段样本，不由 HTTP 200、哈希相同或单一 ASR 推广到任意台词。文件与逐事件日志：`server/drama3-service/longform-acceptance/{short,names,long}-max30-seed20261021.wav`、对应 `.request.json`/`.log.json`、`asr-qwen3-0.6b.jsonl`。服务日志按请求 ID 写 voice、seed、字符数、块预算、stop、样本数和耗时，不记录台词或参考音内容。

20:31 的真实日志仍见另一个局域网客户端以 `max_seconds=10` 连续提交 6–27 字独立请求；服务只能保证**每个 HTTP 请求内部**连续生成，调用端必须停止那条逐句独立克隆拼接路径，才能让整条台词共享原生声学历史。

## 本机运维

源码：`tools/drama3/Install-Drama3Service.ps1` 注册 `Drama3-Speech` 和每分钟检查的 `Drama3-Watchdog`。更新后的 `Drama3-Speech` 任务动作**直接运行 `C:\Python314\python.exe` 和 `voice_service.py`**，因此停止任务也停止拥有模型的进程；没有 PowerShell 包装或常驻子进程。看门狗对冷启动留 90 秒加载窗口；失去健康应答后重新启动原任务。初次安装脚本会核对模型长度与 SHA-256，并处理本机 Qwen 专用机切换；已有 Drama 3 服务升级注册能力时只需运行 `Switch-Drama3VoiceService.ps1`，该脚本只更改 Drama 3 任务动作，保留原 Principal、触发器、防火墙和其他服务，失败会恢复旧动作。

以管理员 PowerShell 执行：

```powershell
& 'D:\Projects\QiandengJi\tools\drama3\Install-Drama3Service.ps1' -Mode User
# 已有服务仅切换音色接口：
& 'D:\Projects\QiandengJi\tools\drama3\Switch-Drama3VoiceService.ps1'
```

在这台 Windows RTX 3090 上，`SYSTEM` 任务的 `/health` 虽返回 200，真实合成却稳定返回 `vk::Queue::submit: ErrorDeviceLost`，显存也未加载模型；不能用 HTTP 健康状态代替合成验收。部署因此采用当前用户的交互式 GPU 会话，**登录 Windows 后自动启动**。初次安装 `-Mode User` 同时创建或核验仅允许 `192.168.3.0/24` 的入站规则 `Qiandeng-Drama3-LAN-18120`。安装或切换结束前自动合成桐人、结衣与双人语音，三者都通过才写入成功状态。`-Mode System` 保留作诊断选项，不作为此机的生产模式。重复初次安装脚本会重新登记同名任务；切换脚本不会触碰 Qwen 容器或代理任务，原任务 XML 备份在被忽略的 `server/drama3-service/before-voice-registry-task.xml`。

常用检查：

```powershell
Get-ScheduledTask -TaskName Drama3-Speech,Drama3-Watchdog
python D:\Projects\QiandengJi\tools\drama3\drama3_health.py --base http://127.0.0.1:18120
python D:\Projects\QiandengJi\tools\drama3\drama3_health.py --base http://192.168.3.133:18120 --smoke
python D:\Projects\QiandengJi\tools\drama3\drama3_health.py --base http://127.0.0.1:18120 --custom-voice qa_kirito_20261028 --smoke
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader,nounits
```

`--smoke` 会在被忽略的 `server/drama3-service/smoke/` 下保存三段可复听 WAV，并检查长度、采样率和非静音。默认不传 `max_seconds`，用于验证当前服务的 **每块 30 秒默认设置**；诊断旧原生任务时才需加 `--max-seconds 10`。10:58 的旧 `speech.exe` 任务确曾带 `--max-seconds 10` 并通过六段测试。12:00 已将正式任务切换为直接运行 Python 音色服务；20:07 仅重启 `Drama3-Speech` 并再次确认桐人、结衣、`cast` 三段真合成。局域网设备 `192.168.3.152` 的请求已抵达本机，其他设备连通性需各自测试；自动冒烟不等于音色和发音已经人工验收。

### 3090 显存边界

原生 `speech.exe serve` 与最初 C API 服务在全 40 层专家放入 GPU 时，冷启动先合成 6.4 秒 QA 参考音色均可出现 `ErrorOutOfDeviceMemory`，即使 `/health` 为 200；原生服务差分复现了同一错误。speech.cpp 0.9.0 按**模型加载时可用显存**放置专家层，故本机新服务在加载瞬间用 NVIDIA 驱动暂占 4 GiB，令其中 7 层专家放在 CPU，模型加载后立即释放该占用；推理仍走 Vulkan0。隔离服务两次冷启动的 QA→三音色及后续两轮三音色通过，正式任务与看门狗恢复后同顺序通过。实际短句首包约 0.5–0.8 秒，整句约 4–5 秒，慢于原全 GPU 的约 2 秒；同 seed 的输出也会因部分层改在 CPU 计算而与原全 GPU 音频不同。生产日志与模型状态在 `server/drama3-service/voice-service.log`、`deployment.json`，不能用单独健康状态替代真实合成检查。若更换显卡或模型，应重新测定这个预留值。

如需临时停止服务：在管理员 PowerShell 中先禁用 `Drama3-Watchdog`，再 `Stop-ScheduledTask -TaskName Drama3-Speech`，否则看门狗会再次拉起；当前非管理员会话无权禁用该任务。恢复时先启用看门狗，再 `Start-ScheduledTask -TaskName Drama3-Speech`。如要恢复此前本机 LLM 部署，先停止并禁用两个 Drama 3 任务，读取 `server/drama3-service/previous-state.json`，再按其中记录恢复 Docker restart policy、容器运行状态和 `TqLLM LAN Proxy`。不要在 Drama 3 仍占显存时启动本机 Qwen。

这台 3090 机器专用于 Drama 3 后，LLM 应由另一台机器提供；本服务不会自动改写 QwenPaw 的模型供应商地址，也不会替换现有游戏 `/tts`/IndexTTS-2.5 兼容网关。要让游戏角色实际改用此接口，客户端或兼容网关需按调用契约单独接入和验收。

Drama 3 权重遵循 [Fish Audio Community License 1.0](https://huggingface.co/sakasegawa/drama-3-GGUF/blob/main/LICENSE)；模型用途、第三方语音克隆托管与真人声音权利应按原协议核对，并保留 “Built with Fish Audio” 归属说明。
