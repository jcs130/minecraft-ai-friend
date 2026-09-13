# D 盘游戏运行镜像恢复

2026-09-13 原 Docker 引擎里的 `mc-world:2.1.38`、`mc-sidecar:2.1.0`、`mc-voice:1.0` 已不存在。它们没有随源码保存 Dockerfile；当前补齐三种独立镜像的构建输入，使用新的 `qiandengji-*` 标签，旧镜像身份和历史证明不改写。

| 新镜像 | 用途 | 构建输入 |
| --- | --- | --- |
| `qiandengji-world:20260913-qd1` | world、网页管理、握手 gate、内部 control | 固定 digest 的 Node 22 Debian 镜像，原 `world/package-lock.json`，显式源码、管理页面和 modern-viewer 工作者/纹理资产 |
| `qiandengji-sidecar:20260913-qd1` | NPC 与资源 HTTP 服务 | 固定 digest 的 Python 3.11，现有标准库服务和健康探针 |
| `qiandengji-voice:20260913-qd1` | 语音队列与 CPU ASR | 同一 Python 基础镜像，sherpa-onnx 1.13.8、NumPy 2.2.6、现有可选 Edge fallback 包 |

Kokoro GPU 合成仍由单独 `tts` 服务承担，语音镜像不包含生成式 LLM。模型与游戏/人物数据继续使用 D 盘只读或读写挂载，构建上下文不包含存档、密钥、会话、语音队列、Windows `node_modules` 或模型权重。

构建在项目根目录运行：

```powershell
.\run-python.bat tools/build_game_runtime_images.py sidecar voice world
```

脚本只构建镜像，不启动服务，也不修改 Compose。仅源码与必要渲染资产进入 `runtime/game-images-*/context`；同目录记录文件 SHA256、真实构建输出、镜像 ID。可用 `--stage-only` 只审阅上下文。已存在的标签不能覆盖，后续改动用新的 `--tag-suffix`，再明确更新 Compose。

当前来源回执位于 `server/runtime-images/{world,sidecar,voice}.json`，`serviceStarted:false` 表示构建工具没有启动服务，不是运行状态。镜像 ID 是本次构建事实，不代表旧容器镜像已经找回。Node 依赖使用原 lockfile 的完整性校验；APT 和 Python 间接依赖仍可能随后续仓库版本变化，不能宣称重建字节完全一致。

镜像内检查会实际读写内存 SQLite、生成 Canvas PNG、加载 Linux GL 绑定并核验现代/原版渲染资源。语音侧已用 `--network none`、只读现有 `/model` 执行原模型 5.61 秒中文样本，包含模型加载耗时 2.06 秒，返回非空完整转写；没有消费真实玩家语音队列。可重复此检查：

```powershell
docker run --rm --network none --mount 'type=bind,source=D:\Projects\QiandengJi\server\asr-model,target=/model,readonly' --mount 'type=bind,source=D:\Projects\QiandengJi\world\runtime-images\smoke-asr.py,target=/opt/smoke-asr.py,readonly' qiandengji-voice:20260913-qd1 python /opt/smoke-asr.py
```

构建与离线样本通过不能代替进服、模组功能和游戏内听感验收；整服状态以 Compose、Minecraft 日志和实际接口探针为准。
