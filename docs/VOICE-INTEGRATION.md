# 现有语音链迁移

`world/sidecar/god-voice-watcher.py` 来自原世界端 sidecar；
`mic_asr_watcher.py` 来自现役 `shadow-asr` 镜像内同名脚本。
新服务复用已有 `mc-voice:1.0` 镜像，源码只读挂载到 `/opt/sidecar`。
队列统一使用本项目 `server/mc/data/godvoice`，不会读取或消费原 C 盘队列。

## 原功能链路

1. Simple Voice Chat 麦克风 → god-voice 模组落 WAV 和玩家元数据。
2. ASR 消费 `mic/inbox` → `mic/outbox` 转写 JSON → world 按玩家发言处理。
3. world 回复 → `text-queue` → 本地 TTS → `tts-queue` → god-voice/SVC 在实体处播放。

保留原 `MengMeng` 语音白名单。缺失玩家元数据时等待，不再默认冒认孟孟；
PCM int16 按 `/32768` 归一化成 sherpa 接收的 float32。
JSON 先写临时文件再同文件系统改名发布，避免读到半份任务。

world 必须配置 `GODVOICE_DIR=/godvoice` 并挂载
`./server/mc/data/godvoice:/godvoice`。MC 已通过 `/data` 挂载看到同一目录
`/data/data/godvoice`。

## 实际部署配置

ASR 模型已完整复制到被忽略的 `server/asr-model`（约 78 MiB），只读挂载
`/model`；新项目不依赖原模型目录。TTS 复用本机既有无状态推理服务
`http://host.docker.internal:8100`，不加载第二份 GPU 模型。
默认关闭 Edge 云端回退；如需开启，显式设 `VOICE_ALLOW_EDGE_FALLBACK=1`。

```yaml
  voice:
    image: mc-voice:1.0
    pull_policy: never
    restart: unless-stopped
    entrypoint: ["python", "-u", "/opt/sidecar/god-voice-watcher.py"]
    environment:
      TZ: Asia/Shanghai
      GV_BASE: /godvoice
      TTS_LOCAL_URL: http://host.docker.internal:8100
      VOICE_ALLOW_EDGE_FALLBACK: "0"
    volumes:
      - ./world/sidecar:/opt/sidecar:ro
      - ./tools/voice_health.py:/opt/voice_health.py:ro
      - ./server/mc/data/godvoice:/godvoice
    healthcheck:
      test: ["CMD", "python", "/opt/voice_health.py", "--state", "/godvoice/.voice-health.json"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3

  asr:
    image: mc-voice:1.0
    pull_policy: never
    restart: unless-stopped
    entrypoint: ["python", "-u", "/opt/sidecar/mic_asr_watcher.py"]
    environment:
      TZ: Asia/Shanghai
      MIC_BASE: /godvoice/mic
      ASR_MODEL_DIR: /model
      ASR_THREADS: "2"
      ASR_MIN_DUR: "0.45"
      VOICE_ALLOWED_PLAYERS: MengMeng
    volumes:
      - ./world/sidecar:/opt/sidecar:ro
      - ./tools/voice_health.py:/opt/voice_health.py:ro
      - ./server/mc/data/godvoice:/godvoice
      - ./server/asr-model:/model:ro
    healthcheck:
      test: ["CMD", "python", "/opt/voice_health.py", "--state", "/godvoice/mic/.asr-health.json"]
      interval: 30s
      timeout: 5s
      start_period: 60s
      retries: 3
```

由根协调者统一启动：`docker compose -p qiandengji up -d world voice asr`。

## 验证结果与边界

- 路径隔离、本地 TTS 地址限制、任务文件名防目录越界、完整 JSON 发布的
  4 项离线测试通过：`python -m unittest discover -s tests -p test_voice_watchers.py -q`。
- 新 ASR 已加载本地模型并监听 `/godvoice/mic/inbox`，voice 已监听独立文本队列。
- 实际本地推理测试通过：TTS 合成“这是语音链路测试。”得到 91,214 B、
  2.067 秒、22,050 Hz 单声道 WAV；迁移的 ASR 识别为“这是语音链路测试”。
  测试总耗时 8.27 秒，临时文件删除，没有向任何玩家或任务队列投递。
  报告：`reports/voice-inference-20260906T235021002685Z.json`。
- 该验证覆盖 TTS 音频生成及 ASR 推理；真实客户端麦克风采集和 SVC 扬声器播放
  尚需客户端实测。心跳健康仅说明消费者持续轮询。
- 实际 NeoForge 客户端已进入本项目存档，并与 `127.0.0.1:24455` 完成
  SVC UDP 认证及连接确认；2026-09-07 补齐 ATRI 后，18 个语音包与游戏实际下载缓存的哈希检查通过。
  见 `reports/client-runtime.json`。该握手结果仍不等同于真实麦克风输入或耳听播放。

原 claim/retry 语义保留：若进程在提交播放后崩溃，遗留任务仍可能被重试播放，
不声称跨进程“恰好一次”。运行日志可能含玩家游戏内语音文本。
