# 千灯纪 TTS 接管与验收

2026-09-07 本轮已将 TTS 所需 79 个资产完整复制到 `D:/Projects/QiandengJi/server/tts-state`，共 **8,508,340,107 bytes**，逐文件核对源与目标 SHA-256。统一运维已完成切换：D `qiandengji-tts-1` 健康运行、旧 `shadow-tts` 已停止，继续提供本机 8100 兼容入口。真实 HTTP 合成和隔离队列消费验收共 10 项通过，见 `reports/tts-ownership-transfer.json` 与 `reports/tts-ownership-smoke.json`。本文保留准备时来源审计，并在末节记录切换后实测边界。

## 当前所有者与兼容范围

审计时 `shadow-tts` 正在运行，容器 ID 为 `dd8f27c354d8eff03632e79dff00b78212783da1621938986426a5be4ddb4524`。发布地址是 `127.0.0.1:8100→8100/tcp`，重启策略 `unless-stopped`，NVIDIA device request 为 `count=-1`、`capabilities=[[gpu]]`。启动为 `python3 -u /app/tts_api.py`，工作目录 `/app`，默认容器用户 root；未配置容器 healthcheck。

镜像必须按已核实的不可变 ID 复用，不能仅依赖可变标签：

```text
sha256:9da38721708a19a1c0528b5224a2d9e464453bd56f46f51e9c595dd27e0f56bb
历史标签 mc-tts:1.0；本地镜像大小 4,990,222,488 bytes
```

这是 IndexTTS 2.5 API。运行容器中只读查询到 torch 2.8.0、transformers 4.52.1、FastAPI 0.141.1、uvicorn 0.52.4、huggingface_hub 0.36.2、lameenc 1.8.4。推理源码 `/app/indextts/infer_v2_5.py` 与原本地构建源码的 SHA-256 均为 `9049c151924cb003968df12957816dff31fc0cb983adf2e364219ef941930093`。只读 `docker diff` 未发现 Python 业务源码或模型文件在可写层中改动；编译缓存、字体缓存、生成音频不属于必须迁移的模型资产。

审计时只读 `GET /health` 返回 `{"ok":true}`，`GET /voices` 返回 47 个声音 ID，包含 `goddess` 和 `touhou_little_maid`。这只证明旧服务当时的状态，不作为 D 服务推理成功的证据。

| 现有调用 | 必须保留 |
| --- | --- |
| `world/sidecar/god-voice-watcher.py:49` | `GET /tts?text=…&voice=…&format=mp3`，返回 MP3 字节 |
| `server/mc/config/touhou_little_maid/sites/tts.json` | `POST /tts`，GPT-SoVITS v2 字段兼容，返回 WAV |
| API 其他既有能力 | GET WAV、voice、lang、emo、speed 参数，`/voices` 与 `/health` |
| `world/sidecar/voice_paths.py:23` | 只接受本地指定主机和 8100；继续使用 `http://host.docker.internal:8100` |

保持原端口后无需调整 D voice watcher 或女仆站点 URL。现有其他宿主调用者也能继续使用 `127.0.0.1:8100`；新服务归 D 管理，但端口仍是本机兼容入口。

## 已准备的独立数据

完整文件来源、大小和 SHA-256 位于 `server/tts-state/source-manifest.json`。该清单另外记录镜像内的推理 worker、Python 包和 `/app/checkpoints/pinyin.vocab` 来源，避免把 `/app/checkpoints` 误当成模型 bind `/checkpoints`。

| D 目标 | 原只读来源 | 数量 / bytes | 新挂载权限 |
| --- | --- | --- | --- |
| `server/tts-state/app/tts_api.py` | C 项目 `ops/docker/shadow/gpu-tts/tts_api.py` | 1 / 7,552 | 只读 |
| `server/tts-state/checkpoints` | C 项目 `ops/docker/shadow/tts/checkpoints` | 31 / 8,467,698,827 | 只读 |
| `server/tts-state/voices` | C 项目 `ops/docker/shadow/tts/voices` | 47 / 40,633,728 | 只读 |
| `server/tts-state/tmp` | D 新建空目录 | 无旧合成记录 | D 独立可写 |

这里的 C 项目根是 `C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend`。所有 C 文件保持原样。旧 voices 虽曾被旧容器以 RW 挂载，复制后新服务仅访问 D 副本。没有让新服务共享旧容器可写目录，也没有复制旧 `/tmp` 音频、日志、venv、下载器、账号或凭据。

未发现可直接复用的独立非游戏模型缓存。所需辅助模型已经齐备于 checkpoint 内：w2v-bert、CampPlus、BigVGAN、情感 Qwen 和 tokenizer。因此本次完整复制约 8.51 GB 就能解除 C 游戏目录依赖，无需下载模型或重复复制 4.99 GB Docker 镜像。复制前 D 空闲 368.8 GB，空间充足。

API 副本未改行为，SHA-256 为 `a28c7d4c9776e425316a8b47578737fc73f367da5fa1480eb057598d03778a07`。

## Compose 建议

`server/tts-state/compose.service.json` 是可读的完整 Compose 服务片段，服务名 `tts`。已执行 `docker compose --project-name qiandengji -f server/tts-state/compose.service.json config --quiet`，配置校验成功；此命令不创建或启动容器。统一负责人可把该服务并入根 Compose，避免维护两套启动入口。

核心设置：

```yaml
tts:
  image: sha256:9da38721708a19a1c0528b5224a2d9e464453bd56f46f51e9c595dd27e0f56bb
  pull_policy: never
  restart: unless-stopped
  working_dir: /app
  entrypoint: [python3, -u, /app/tts_api.py]
  ports: ["127.0.0.1:8100:8100"]
  environment:
    TTS_CKPT: /checkpoints
    TTS_VOICES: /voices
    TTS_DEFAULT_VOICE: goddess
    TTS_HOST: 0.0.0.0
    TTS_PORT: "8100"
    HF_HUB_OFFLINE: "1"
    TRANSFORMERS_OFFLINE: "1"
  volumes:
    - ./server/tts-state/app/tts_api.py:/app/tts_api.py:ro
    - ./server/tts-state/checkpoints:/checkpoints:ro
    - ./server/tts-state/voices:/voices:ro
    - ./server/tts-state/tmp:/tmp
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
```

完整 JSON 还包含 bind 的 `create_host_path:false`（缺资产时直接失败）、`TZ` 和基于 Python 标准库读取 `/health` 的健康检查：30 秒间隔、8 秒超时、180 秒启动宽限、10 次重试。没有 Docker socket、RCON、游戏存档或 QwenPaw 私有目录挂载。

GPU 配置沿用旧服务，可用硬件与驱动需要保持。不能让两套模型同时驻留后再争抢 8100；建议停旧再启动新。旧服务启动过程会加载全部模型并执行一次预热，首次新容器可能重建文本规范化、CUDA 和字体缓存；即使是健康验收也需要给启动留足时间。离线 HF 开关用于禁止缺文件时自动下载，实际启动兼容仍需切换窗口验证。

## 切换与验收顺序（统一运维已执行）

1. 统一负责人接入 D Compose 和运维登记，并保留旧容器及原配置作为回退依据。让 voice 队列停止接收新任务或短暂停消费，以免切换间隙把合成请求移成 `.err`。
2. 正常停止 `shadow-tts`，确认旧 8100 已释放；再启动 D `tts`。这一步不能由准备脚本自行执行。
3. 确认新容器使用上述 immutable ID，挂载均指向 D，`127.0.0.1:8100` 的所有者确实是 D `tts`。检查新容器健康与日志，不把旧服务的 health 响应当作迁移成功。
4. 核对 `/voices` 仍有 47 个相同 ID；分别用一条短 QA 文本验 GET WAV、GET MP3 和女仆格式 POST，确认响应能解码、音频非空。`/health` 只检查 `_tts` 已初始化，API 会捕获部分预热失败，所以还需要真实合成。
5. 恢复 voice 消费并验证一次 D 队列合成/投递；需要游戏中的听觉验收时再使用明确 QA，不宣称 HTTP 成功等于玩家已听到。健康检查应区分 TTS、voice watcher 与 MC/SVC 播放链。
6. 成功后确认 `shadow-tts` 保持停止。失败时先停 D `tts` 释放端口，再按统一回退操作恢复旧服务；不要双实例占用 GPU 和端口。

旧 API 在 `tts_api.py:145,147,185` 返回 FileResponse 后没有清理最终 WAV/MP3；本次保持这一行为，将输出放在 D 的 `tmp` 中，不能复制旧历史输出填满新目录。后续需在明确无在途响应时做受控保留期维护，或单独修响应结束清理；本次未擅自改动 API 或加入自动删除。

## 准备工具的验证

```powershell
python -X utf8 tools/prepare_tts_runtime.py --self-test
python -X utf8 tools/prepare_tts_runtime.py --prepare
```

`--prepare` 已执行成功。工具校验本地 immutable 镜像、D 空间、必需模型和声音、路径无链接/越界；只复制显式模型树与 WAV。已有相同文件只核对，已有不同文件拒绝覆盖；复制先落临时文件再核对源/目标 SHA-256，并检测源大小/时间变化。没有启停逻辑，也不导入推理库。9 项离线自检通过，覆盖路径越界拒绝、重复执行、不同目标保留、镜像/端口/D 挂载权限。

## D 服务真实验收

`tools/smoke_tts_ownership.py` 于 2026-09-07 20:11:41 至 20:12:08 中国时间完成，报告 `reports/tts-ownership-smoke.json` 为 `ok:true`，10 项检查全部通过：

- 新 D 容器使用上文 immutable 镜像，8100 仅本机发布，API/模型/voices 挂载均为 D 只读副本；旧容器实际状态为 `exited`。
- 合成前后各核验全部 79 文件、8,508,340,107 bytes，与源清单 SHA-256 全部一致；清单及女仆配置也与测试前备份逐字节一致。
- `/health` 正常，`/voices` 的 47 个声音 ID 与清单一致。GET WAV、GET MP3 均返回可真实解码、非空且非静音的音频。
- POST 使用当前女仆站点的既有字段及 `/voices/cosy_female.wav`，返回可解码 WAV；空文本返回 400。既有 POST 只返回 WAV，MP3 使用 GET `format=mp3`，没有冒称新增 POST MP3 支持。
- 使用现役 `god-voice-watcher.py`、现役 voice 镜像和独立临时 QA 队列完成一次真实本地合成，结果标记 `engine:local`，原任务已消费，MP3 可解码。该临时容器只挂 QA 目录，不接 MC/SVC 播放队列；结束后确认本次容器已移除。

所有测试音频保留在报告所列 `runtime/tts-ownership-qa-0ab1011def3e`，**没有播放**；没有使用真人麦克风、写真实玩家队列或改变游戏角色。因此已验证 D GPU 推理和实际队列消费者，不将其表述为玩家已在游戏听到。前两轮测试工具自身的解码环境/编码名问题保留为独立失败记录，最终报告未改写这些历史；这些不是模型服务故障。
