# RTX 3090 专用 Drama 3 语音服务

本机采用 [speech.cpp v0.9.0](https://github.com/nyosegawa/speech.cpp/releases/tag/v0.9.0) Windows Vulkan 运行时与 [Drama 3 Q4_K GGUF](https://huggingface.co/sakasegawa/drama-3-GGUF)。此组合已在实体 RTX 3090 24GB 上实测参考音克隆、流式 PCM 和双人对话，比本机 ComfyUI W6A8 热请求更适合直播短句；性能及中文错词记录见 [实测报告](research/DRAMA3-LOCAL-DEPLOYMENT-2026-10-28.md)。权重、二进制、参考音和运行日志位于被 Git 忽略的 `E:\ai-models\drama3-20261028\speechcpp`。

## 接口

- 本机：`http://127.0.0.1:18120/v1`
- 家庭局域网：`http://192.168.3.133:18120/v1`
- 健康：`GET /health`，返回 `{"status":"ok"}`
- 模型：`GET /v1/models`，当前模型 ID 为 `drama-3`
- 合成：`POST /v1/audio/speech`，音色为 `kirito`、`yui`、`cast`，也可用 `none`

`cast` 是同一段音频中的两个人物：桐人用 `<|speaker:0|>`，结衣用 `<|speaker:1|>`。短句直播建议 `response_format: "pcm"`，服务端边生成边发 44.1kHz、16-bit、单声道 PCM；需要普通文件时设 `"wav"`。`top_k: 4097` 是本机已验证的设置；固定 `seed` 可重现同一设备上的音频。服务一次处理一个合成请求，调用端应限制排队与超时。[接口文档](https://github.com/nyosegawa/speech.cpp/blob/main/docs/server.md)

安装脚本会把常驻任务的单段生成上限设为 `max_seconds: 10`。旧任务的默认上限在冷重启后使三音色合成触发 Vulkan 显存不足；10 秒上限下独立服务进程两轮共六段短句均成功。直播台词应拆成短句，长篇语音需要另行测试和分段。修改脚本后仍需重新安装任务，检查 `Drama3-Speech` 的实际动作含 `--max-seconds 10`，并在重启后不传额外请求上限运行三音色冒烟。

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

## 本机运维

源码：`tools/drama3/Install-Drama3Service.ps1` 注册 `Drama3-Speech` 和每分钟检查的 `Drama3-Watchdog`。`Drama3-Speech` 的任务动作**直接运行 speech.exe**，因此停止任务也停止进程；用 PowerShell 包装会遗留子进程，已在部署试验中排除。看门狗对冷启动留 90 秒加载窗口；失去健康应答后重新启动原任务。安装脚本先检查模型长度与 SHA-256，再保存本地 LLM 容器和代理任务的原状态到 `server/drama3-service/previous-state.json`。之后仅停止 `qwen38-27b-lan`、将其 Docker restart policy 设为 `no`，并停用 `TqLLM LAN Proxy`。它不删除模型、容器或旧数据。

以管理员 PowerShell 执行：

```powershell
& 'D:\Projects\QiandengJi\tools\drama3\Install-Drama3Service.ps1' -Mode User
```

在这台 Windows RTX 3090 上，`SYSTEM` 任务的 `/health` 虽返回 200，真实合成却稳定返回 `vk::Queue::submit: ErrorDeviceLost`，显存也未加载模型；不能用 HTTP 健康状态代替合成验收。部署因此采用当前用户的交互式 GPU 会话，**登录 Windows 后自动启动**。管理员执行 `-Mode User` 时，同时创建或核验只允许 `192.168.3.0/24` 的入站规则 `Qiandeng-Drama3-LAN-18120`；非管理员执行则无法创建规则。安装结束前自动合成桐人、结衣与双人语音，三者都通过才写入成功状态。`-Mode System` 保留作诊断选项，不作为此机的生产模式。重复安装会重新登记同名任务，运行前应确认当前没有长语音请求。故障会恢复本次调用之前 Qwen 容器及代理任务的状态，并恢复原任务配置。

常用检查：

```powershell
Get-ScheduledTask -TaskName Drama3-Speech,Drama3-Watchdog
python D:\Projects\QiandengJi\tools\drama3\drama3_health.py --base http://127.0.0.1:18120
python D:\Projects\QiandengJi\tools\drama3\drama3_health.py --base http://192.168.3.133:18120 --smoke
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader,nounits
```

`--smoke` 会在被忽略的 `server/drama3-service/smoke/` 下保存三段可复听 WAV，并检查长度、采样率和非静音。默认不传 `max_seconds`，用于验证服务任务的默认设置；在仍运行旧任务配置时可加 `--max-seconds 10` 验证请求端临时方案。语音识别在试验中对中文人物名识别不稳定，一句桐人短句也偏离原文；自动冒烟不等于音色和发音已经人工验收。

如需临时停止服务：`Stop-ScheduledTask -TaskName Drama3-Speech`，随后禁用 `Drama3-Watchdog`，否则看门狗会再次拉起。恢复时先启用看门狗，再 `Start-ScheduledTask -TaskName Drama3-Speech`。如要恢复此前本机 LLM 部署，先停止并禁用两个 Drama 3 任务，读取 `server/drama3-service/previous-state.json`，再按其中记录恢复 Docker restart policy、容器运行状态和 `TqLLM LAN Proxy`。不要在 Drama 3 仍占显存时启动本机 Qwen。

这台 3090 机器专用于 Drama 3 后，LLM 应由另一台机器提供；本服务不会自动改写 QwenPaw 的模型供应商地址，也不会替换现有游戏 `/tts`/IndexTTS-2.5 兼容网关。要让游戏角色实际改用此接口，客户端或兼容网关需按调用契约单独接入和验收。

Drama 3 权重遵循 [Fish Audio Community License 1.0](https://huggingface.co/sakasegawa/drama-3-GGUF/blob/main/LICENSE)；模型用途、第三方语音克隆托管与真人声音权利应按原协议核对，并保留 “Built with Fish Audio” 归属说明。
