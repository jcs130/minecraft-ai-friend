# Kokoro 游戏语音

游戏语音改用本机现存的 Kokoro 82M v1.1-zh。生成角色台词仍由 QwenPaw 的云端模型负责；Kokoro 只把文本转换为音频，运行时不访问 Hugging Face、不加载通用 LLM。沿用同一个 Compose `tts` 服务、容器 `qiandengji-tts-1` 和本机 `127.0.0.1:8100`。

## 音色与接口

| 游戏身份 | 原语音 ID | 实际 Kokoro 音色 |
|---|---|---|
| 桐人 | `cosy_male` | `zm_010`，中文男声 |
| 结衣 | `cosy_female` | `zf_001`，中文女声 |
| 女神 | `goddess` | `zf_001`，中文女声 |

`config/kokoro-voices.json` 明确列出 47 个既有 ID 的映射。原参考 WAV 保留且只读，但 Kokoro 不读取它们来克隆声音；未分类的旧 ID 使用默认女声，不把角色名当作已经验证的原角色声线。`/voices` 返回兼容 ID、`voiceMappings` 和两个 `nativeVoices`，以便管理页面区分别名与实际音色。

保留 `GET /tts` 的 WAV / MP3、`POST /tts` 的 WAV，以及车万女仆 `POST /tts/maid` 的 MP3。旧 GPT-SoVITS 请求字段和本地参考路径的 basename 继续有效。响应仍是完整文件；没有宣称游戏客户端已接入流式播放。原 `speed` 参数保持旧 duration factor 语义，内部换算成 Kokoro 的 `1 / duration_factor`。

部署支持中文和中英混合。英文使用 Misaki 的本地词典、`en_core_web_sm` 和 eSpeak 发音回退；这个小型语言处理包不负责生成台词。Kokoro 0.9.4 的默认非英文管线可能截断过长音素，因此适配器按实际音素长度分句，消费全部输出片段后生成 24kHz、单声道、16-bit PCM。现有 600 字输入限制保留。

Kokoro 不支持 IndexTTS 情感向量；非零 `emo` 请求返回明确的 422，健康接口报告 `emotionsSupported=false`、`voiceCloning=false`。现有 GodVoice 和女仆活动请求没有传情感向量。GPU 队列仍有界，繁忙返回 429，失败不生成成功播放回执，临时音频在响应结束后清理。

## 来源与复现

复用 `C:/xiaozhi/hf_cache_kokoro` 的官方模型缓存，revision 为 `01e7505bd6a7a2ac4975463114c3a7650a9f7218`。准备脚本只复制已固定 SHA256 的模型、配置和两个音色，共 4 个文件，解引用 Windows HF 缓存软链接。文件位于被 Git 忽略的 `server/kokoro-state/model`，模型权重不进入仓库。

```powershell
# 校验本机缓存，并准备独立的 Kokoro 数据目录。
.\run-python.bat tools/prepare_kokoro_runtime.py

# 复用已审计的本地 CUDA/PyTorch 镜像，安装 Kokoro 及本地发音资源。
.\run-python.bat tools/prepare_kokoro_runtime.py --build

# 只替换游戏 TTS；其它世界服务保持各自当前状态。
docker compose up -d --no-deps tts

# 实际 HTTP 合成、完整响应延迟、音频解码与运行来源验证。
.\run-python.bat tools/smoke_kokoro_runtime.py
```

镜像为 `qiandengji-tts:kokoro-1.1-qd1`，基于仍保留的 `qiandengji-tts:2.5-qd1`。复用基底避免再次下载 CUDA；IndexTTS 包留在基础层但不实例化，旧权重不挂到新服务。Dockerfile 显式 COPY 两个推理入口，构建记录保存真实镜像 ID 和源码哈希。运行数据来源与构建回执分别保存在 `server/kokoro-state/source-manifest.json` 和 `runtime-image.json`。

模型、映射及声音目录只读；只有独立的 `server/kokoro-state/tmp` 可写。保留 `restart: unless-stopped`、HTTP 健康探针和现有运维清单，不创建宿主常驻 Python 进程。启动必须通过真实预热，否则不报告服务就绪。

需要回滚时使用保留的旧镜像、旧 API 和旧资产：

```powershell
docker compose -f compose.yml -f world/tts/compose.index-rollback.yml up -d --no-deps tts
```

回滚后再次执行默认 Compose 启动命令即可切回 Kokoro。这个覆盖文件使用 Compose 的 `!override` 完整替换挂载，避免同时挂上两套模型；本机 Compose 5.5.1 已验证解析。没有改写旧 IndexTTS 的来源清单或模型文件。

## 验收范围

2026-09-13 已切换并通过 12 次实际合成、20 项运行断言；容器 healthy，重启计数 0。实际镜像为 `sha256:6cfa69464d66b4febbfa2474e3efb77fc2df08c1587b6c356734972c0ebb86ed`。四个模型文件、镜像内两份源码、挂载映射与保留的旧声音均通过哈希核验。39 项离线测试通过，1 项因 Windows 不允许创建测试软链接而跳过；实际 HF 软链接复制已验证成功。烟测工具另外 8 项离线自检通过。

预热后的同一句“千灯纪语音测试。”连续 5 次 MP3 请求耗时为 0.1482、0.1727、0.1350、0.1633、0.1668 秒，中位数 **0.1633 秒**。这 5 次样本的 nearest-rank p95 为 0.1727 秒，样本量很小，不视为负载下的稳定 SLA。计时包括从宿主发出 HTTP 请求到读完完整音频，不包含随后解码或游戏播放。

| 固定请求 | IndexTTS 历史单次样本 | Kokoro 本次单次样本 |
|---|---:|---:|
| 同句 GET WAV | 2.812 秒 | 0.2750 秒 |
| 同句 GET MP3 | 2.813 秒 | 0.1358 秒 |
| 女仆 POST MP3 | 3.000 秒 | 0.2493 秒 |

桐人男声和结衣女声完整请求分别为 0.3337 秒、0.2508 秒；长中文段落 0.8942 秒生成 26.76 秒音频，中英混合 0.2598 秒生成 6.384 秒音频。每段均成功解码且包含非静音 PCM，未以解码成功代替人工听感评分。安装中的 TLM 1.5.3 MPEG 解码器真实读到 139,392 字节 PCM、24,000Hz，并再次确认拒绝 PCM WAV，因此专用女仆接口继续输出 MP3。

合成后容器内存约 1.883GiB；整机显存已用 2,438MiB，包含桌面等原有占用，不能当作独占显存。相同机器此前 IndexTTS 合成后采样约 3.19GiB 容器内存、整机显存已用 7,232MiB。

完整结果在本地 `runtime/kokoro-20260913/kokoro-runtime-smoke.json`，没有声卡播放、玩家队列写入或生成式 LLM 调用。该阶段尚未恢复 Minecraft、游戏 QwenPaw 和语音队列消费者；后续同日已完成 [D 盘 Docker 服务恢复](GAME-RUNTIME-LAYOUT.md)，并再次确认 GPU Kokoro 健康。HTTP 音频可用仍不等于真人已在游戏中听到，GodVoice 播放回执和人物实际发声需分别验证。

资料：[Kokoro 官方项目](https://github.com/hexgrad/kokoro)、[v1.1 中文模型与音色说明](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)、[Misaki 官方发音处理](https://github.com/hexgrad/misaki)。
