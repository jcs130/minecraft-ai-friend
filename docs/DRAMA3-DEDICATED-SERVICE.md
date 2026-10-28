# RTX 3090 专用 Drama 3 语音服务

本机采用 [speech.cpp v0.9.0](https://github.com/nyosegawa/speech.cpp/releases/tag/v0.9.0) Windows Vulkan 运行时与 [Drama 3 Q4_K GGUF](https://huggingface.co/sakasegawa/drama-3-GGUF)。此组合已在实体 RTX 3090 24GB 上实测参考音克隆、流式 PCM 和双人对话，比本机 ComfyUI W6A8 热请求更适合直播短句；性能及中文错词记录见 [实测报告](research/DRAMA3-LOCAL-DEPLOYMENT-2026-10-28.md)。权重、二进制、参考音和运行日志位于被 Git 忽略的 `E:\ai-models\drama3-20261028\speechcpp`。

## 接口

- 本机：`http://127.0.0.1:18120/v1`
- 家庭局域网：`http://192.168.3.133:18120/v1`
- 健康：`GET /health`，返回 `{"status":"ok"}`
- 模型：`GET /v1/models`，当前模型 ID 为 `drama-3`
- 合成：`POST /v1/audio/speech`，音色为 `kirito`、`yui`、`cast`，也可用 `none`
- 自定义音色：`POST /v1/audio/voices`、`GET /v1/audio/voices`、`GET /v1/audio/voices/{voice_id}`

`cast` 是同一段音频中的两个人物：桐人用 `<|speaker:0|>`，结衣用 `<|speaker:1|>`。短句直播建议 `response_format: "pcm"`，服务端边生成边发 44.1kHz、16-bit、单声道 PCM；需要普通文件时设 `"wav"`。`top_k: 4097` 是本机已验证的设置；固定 `seed` 可重现同一设备上的音频。服务一次处理一个合成请求，调用端应限制排队与超时。[接口文档](https://github.com/nyosegawa/speech.cpp/blob/main/docs/server.md)

服务内部把单段生成上限固定为 `max_seconds: 10`，请求也不能超过 10 秒。旧原生服务的默认 47.6 秒上限在冷重启后使三音色合成触发 Vulkan 显存不足；10 秒上限下独立服务进程两轮共六段短句均成功。直播台词应拆成短句，长篇语音需要另行测试和分段。新服务不依赖任务命令行设置该上限，需在重启后不传额外请求上限运行三音色冒烟。

Python 标准库调用示例：

```python
import json
import urllib.request

body = {
    "model": "drama-3", "voice": "kirito",
    "input": "<|speaker:0|> 大家晚上好，我是桐人。",
    "response_format": "wav", "top_k": 4097, "max_seconds": 10,
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

注册请求为 `multipart/form-data`，字段 `voice_id`、`audio` 和 `reference_text` 必填，`model` 可选且只能是 `drama-3`。`voice_id` 使用小写英文字母开头，后续可用小写字母、数字、下划线和短横线，最长 32 字符；已有 ID 及 `none`、`kirito`、`yui`、`cast` 不可覆盖。重新录制时应选新 ID。**可米的音频尚未上传，`cormy` 目前不是可用音色**；下面的请求供调用方拿到她的原始录音后使用：

```bash
curl -sS -X POST 'http://192.168.3.133:18120/v1/audio/voices' \
  -F 'voice_id=cormy' \
  -F 'model=drama-3' \
  -F 'reference_text=这里填写音频中实际说出的每一个字' \
  -F 'audio=@cormy.wav;type=audio/wav'
curl -sS 'http://192.168.3.133:18120/v1/audio/voices/cormy'
curl -sS 'http://192.168.3.133:18120/v1/audio/voices'
```

注册返回 HTTP 202、`status: "pending"` 和 `Location: /v1/audio/voices/cormy`；轮询单项直到 `ready` 后才可合成。编码或热加载失败为 `failed`，`error` 写明原生失败原因；未知 ID 的查询为 404。输入必须是未压缩的 **16/24/32-bit PCM WAV**，单声道或双声道、8–96 kHz、**3–20 秒**、至多 **16 MiB**。服务端保留原 WAV 和原文，原生编码器会混成单声道并重采样至 44.1 kHz。MP3、AAC、WAV 浮点格式应先转换为 PCM WAV。参考文本必填，需与录音实际说的话一致；服务无法自动核对逐字准确性，错配会影响克隆质量。

`ready` 后合成：

```bash
curl -sS 'http://192.168.3.133:18120/v1/audio/speech' \
  -H 'Content-Type: application/json' \
  --data-raw '{"model":"drama-3","input":"你好，我是可米。","voice":"cormy","response_format":"wav","max_seconds":10,"top_k":4097}' \
  -o cormy.wav
```

输出 WAV 为 44.1 kHz、16-bit、单声道；`response_format: "pcm"` 继续提供流式原始 PCM，`stream_format: "sse"` 继续提供分块事件。`max_seconds` 仍不得超过 10。未知音色的合成明确返回 HTTP 400 `unsupported_value`；`pending` 和 `failed` 返回 HTTP 409 `voice_not_ready`，**不会自动改用现有音色或默认音色**。

注册资料位于被 Git 忽略的 `server/drama3-service/voices/<voice_id>/`：`reference.wav`、`reference.txt`、`voice.gguf` 与 `manifest.json`。清单记录 schema/引擎版本、codec 哈希、音频与原文 SHA-256、编码 GGUF SHA-256、时间和状态。注册异步编码一次，热加载成功才标记 `ready`；合成只用缓存的 GGUF。服务重启时校验哈希并直接热加载所有 `ready` 音色，恢复 `pending` 作业，保留 `failed` 原因。当前接口不提供同名覆盖或删除。

本机隔离测试使用**现有桐人测试录音**注册 `qa_kirito`，不是可米录音：2026-10-28 11:50 接口先返回 pending，约 4 秒后 ready，编码产物 6144 字节；同一文本和 seed 123 下 `qa_kirito` 与 `yui` 的 WAV 时长分别为 3.947 秒和 3.065 秒，SHA-256 不同。测试服务重启后 GGUF 哈希和修改时间未变，`qa_kirito` 自动恢复为 ready，同一合成的 SHA-256 仍为 `80f9a13cda59d2060790fe246da29ff21064bddba7f38215aac1e065ae9059e9`。这证明独立音色经原生路径影响合成以及重启复用；可米本人音色的听感仍需调用方上传后验收。

正式端口另注册了 `qa_kirito_20261028`，明确是桐人 QA 录音。注册返回 pending 后转为 ready；固定文本与 seed 123 的 WAV SHA-256 为 `c125605e4f00000e6c8fff4b5c8ba88d4ce25ca1fb6fa04da4d78613199a53e7`，同设置下 `yui` 为 `a4875b0385216945b020c11a64752505a0b38bea645166a4bf954cd888d1b1c6`。正式任务重启后，缓存 GGUF 的 SHA-256 和修改时间均不变，QA 合成哈希仍一致。看门狗实际恢复任务后，QA 合成及桐人、结衣、`cast` 三段再验通过。`cormy` 查询仍为 404，合成为 400 `unsupported_value`；这些 QA 结果**不代表可米音色已经验收**。

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

`--smoke` 会在被忽略的 `server/drama3-service/smoke/` 下保存三段可复听 WAV，并检查长度、采样率和非静音。默认不传 `max_seconds`，用于验证服务的 10 秒默认设置；诊断旧原生任务时才需加 `--max-seconds 10`。10:58 的旧 `speech.exe` 任务确曾带 `--max-seconds 10` 并通过六段测试。12:00 已将正式任务切换为直接运行 Python 音色服务，12:16 看门狗停机恢复后从本机 LAN IP 进行 QA 和三音色真实合成通过。另一台局域网设备的连通性仍待从该设备实测；自动冒烟不等于音色和发音已经人工验收。

### 3090 显存边界

原生 `speech.exe serve` 与最初 C API 服务在全 40 层专家放入 GPU 时，冷启动先合成 6.4 秒 QA 参考音色均可出现 `ErrorOutOfDeviceMemory`，即使 `/health` 为 200；原生服务差分复现了同一错误。speech.cpp 0.9.0 按**模型加载时可用显存**放置专家层，故本机新服务在加载瞬间用 NVIDIA 驱动暂占 4 GiB，令其中 7 层专家放在 CPU，模型加载后立即释放该占用；推理仍走 Vulkan0。隔离服务两次冷启动的 QA→三音色及后续两轮三音色通过，正式任务与看门狗恢复后同顺序通过。实际短句首包约 0.5–0.8 秒，整句约 4–5 秒，慢于原全 GPU 的约 2 秒；同 seed 的输出也会因部分层改在 CPU 计算而与原全 GPU 音频不同。生产日志与模型状态在 `server/drama3-service/voice-service.log`、`deployment.json`，不能用单独健康状态替代真实合成检查。若更换显卡或模型，应重新测定这个预留值。

如需临时停止服务：在管理员 PowerShell 中先禁用 `Drama3-Watchdog`，再 `Stop-ScheduledTask -TaskName Drama3-Speech`，否则看门狗会再次拉起；当前非管理员会话无权禁用该任务。恢复时先启用看门狗，再 `Start-ScheduledTask -TaskName Drama3-Speech`。如要恢复此前本机 LLM 部署，先停止并禁用两个 Drama 3 任务，读取 `server/drama3-service/previous-state.json`，再按其中记录恢复 Docker restart policy、容器运行状态和 `TqLLM LAN Proxy`。不要在 Drama 3 仍占显存时启动本机 Qwen。

这台 3090 机器专用于 Drama 3 后，LLM 应由另一台机器提供；本服务不会自动改写 QwenPaw 的模型供应商地址，也不会替换现有游戏 `/tts`/IndexTTS-2.5 兼容网关。要让游戏角色实际改用此接口，客户端或兼容网关需按调用契约单独接入和验收。

Drama 3 权重遵循 [Fish Audio Community License 1.0](https://huggingface.co/sakasegawa/drama-3-GGUF/blob/main/LICENSE)；模型用途、第三方语音克隆托管与真人声音权利应按原协议核对，并保留 “Built with Fish Audio” 归属说明。
