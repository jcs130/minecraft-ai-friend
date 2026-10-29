# 局域网完整 TTS 与自建音色

千灯纪局域网的 VoxCPM2 语音服务使用原来的单模型、单推理工作线程。
地址为 `http://192.168.3.163:8017`。该局域网入口无需 API Key；不通过网站公开。
原有 `:4000/v1/audio/speech` 路由及其凭据保持。

本目录为现役 1.5.2 服务的可审计增量，生成 1.6.0。音色创建、查询、试听、更新和删除即时生效，无需重启或重新训练模型。它使用参考音克隆音色，不是模型权重训练。

## Agent 用法

1. `GET /v1/audio/voices` 列出音色、默认音色和上传说明。
2. 上传本人准备的参考录音及准确原文，创建自己的音色：

```sh
curl -X POST http://192.168.3.163:8017/v1/audio/voices \
  -F 'id=my-agent' -F 'label=我的声音' \
  -F 'reference_text=这里填写录音中实际说出的完整原文。' \
  -F 'file=@reference.wav'
```

`id` 可省略，由服务自动生成；提供时可用英文字母、数字、点、下划线和短横线，最多96字符。支持 WAV、FLAC、OGG、MP3；建议5–20秒清晰单人录音。单文件最多32MiB，时长0.25–300秒。不会做音高、语速或人声特征的人工改写，仅转为单声道24kHz WAV。

3. 返回 `201` 后，用返回的 `id` 合成或试听：

```sh
curl http://192.168.3.163:8017/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"model":"Cormy-TTS","voice":"my-agent","input":"你好，我来千灯纪冒险啦。"}' \
  -o speech.wav
```

流式合成用 `/v1/audio/speech/stream`。原有 `seed`、`instructions`、发音控制和分句能力保留，文本每次最多1200字符，长文本分段提交。当前 Hi-Fi 模型按参考音节奏合成，`speed` 仍为1。

也可用 JSON 创建：`reference_audio` 为完整音频的 base64，`reference_text` 为原文；兼容 `audio_base64`、`prompt_text`、`transcript`。无需提供本机路径或上传模型文件。

## 管理已有音色

| 方法与路径 | 用途 |
|---|---|
| `GET /v1/audio/voices/{id}` | 名称、说明、参考原文及音频摘要 |
| `GET /v1/audio/voices/{id}/audio` | 获取标准化参考 WAV |
| `PUT /v1/audio/voices/{id}` | 更新名称、说明、原文或参考音；JSON和表单均可 |
| `DELETE /v1/audio/voices/{id}` | 删除自己上传的音色注册 |
| `GET /health`、`GET /metrics` | 就绪状态和实际合成队列 |

局域网内共享管理，不增加账号、所有权审批或额外密钥。预置音色和默认音色保持不变；想修改预置音色时，另建一个自己的ID。重名返回409，未知ID返回404；未知音色的合成请求明确失败，不悄悄换人。

上传音频及原文持久保存在 `/var/lib/cormy-tts/voices`；目录可以用 `managed_voice_dir` 配置。索引原子保存，合成使用不可变参考快照和带音频/原文摘要的缓存，避免更新后串音色。删除注册不立即删除音频文件，确保已排队合成可以完成；不把音频或音色数据提交Git。

## 构建、验证和回退

`build_overlay.py <现役voxcpm2_server.py> <候选目录>` 先核对已验证1.5.2源摘要再生成增量，拒绝在未知版本上盲目覆盖。把现役的其余共享模块保留在原相对位置；依赖使用已有 `numpy`、`soundfile`、`scipy`，不另拉GPU模型。

在包含现役共享模块的隔离目录设置 `PYTHONPATH` 后运行 `test_managed_voices.py`，再运行原单推理线程与生成模式回归。生产更新先保存实际源码、配置和音色目录的E/F副本，确认语音队列空闲，再只正常停启 `cormy-tts.service`。默认音色、已有音色、普通合成、流式合成和创建后真实合成都需要验收；健康接口200不足以证明完成。

回退只恢复同次备份的 `voxcpm2_server.py` 及新增模块前像，再正常启动语音服务。保留新的音色目录和最新语音资料，以后升级后仍可使用。游戏服务器和共享LLM网关不随TTS代码回退。
