# 全量 Docker 化蓝图（2026-08-21）

造物主旨意：**全部迁移进 Docker，QwenPaw 也包括在内。** 本文档是落地蓝图的单一事实源。

## 一、现状侦察结论（已核实）

| 组件 | 当前形态 | 端口 | 容器化状态 |
|------|---------|------|-----------|
| MC 服务端 | NeoForge 21.1.233 + numen + settlements（`numen-sandbox/`） | 25599 / RCON 25575 | ✅ 已有镜像 `mc-server:latest`（2.49GB，曾起过） |
| 世界进程 | 已脱壳 `bootstrap-world.mts`（13 服务 DI） | — | ❌ 旧镜像 `mc-world:latest` 是 cordis 壳，须重写 |
| 观察面板 | `web-panel.mjs` | 9090 | ❌ 宿主跑 |
| 皮肤代理 | `sidecar/skin-proxy.mjs` | 25565→25599 | ❌ 宿主跑 |
| 假玩家桥 | `sidecar/guard/guard_drive.py`（纯 stdlib） | — | ❌ 宿主跑 |
| **QwenPaw** | **`qwenpaw==2.1.0`（=CoPaw），`qwenpaw app`** | **8088** | **❌ 宿主 Windows 跑（`~/.copaw`）——造物主点名缺口** |
| ollama | 宿主 Windows 原生 | 11434 | ❌ 宿主跑（embedding `bge-m3-cpu`） |
| qdrant | `memos-qdrant` 容器 | 6333 | ⚠️ 已容器化，但属 MemOS 栈，需为世界独立 |
| vLLM | `vllm-qwen38-ara` 容器 | 8890 | ✅ 已容器化（GPU 本地推理，可选去留） |
| MemOS | memos-api/redis/neo4j/qdrant | 8002 | ✅ 已容器化（记忆系统） |

**核心结论：MC 服务端、vLLM、qdrant、MemOS 早已容器化；真正还裸奔在宿主的只有 世界进程、面板、皮肤代理、假玩家桥、QwenPaw、ollama。其中 QwenPaw 是造物主点名的关键缺口。**

## 二、关键事实锚点

1. **QwenPaw 实况**：包名 `qwenpaw`（2.1.0，依赖 `agentscope==2.0.4.post1`）；启动命令 `qwenpaw app`；实际进程 `python ...\.qwenpaw\venv\Scripts\qwenpaw.exe app`。数据根 `C:\Users\lzl19\.copaw`（config.json + workspaces + sessions + memory + file_store + plugins）。
   - 通道：飞书（lark-oapi，config.json 含 app_id/app_secret）为主，console/discord/dingtalk 等。
   - MCP：`winremote`（127.0.0.1:8090，Windows 桌面自动化）、`minecraft_companion`（127.0.0.1:4177）、`tavily_search`（禁用）。
   - 记忆后端 `remelight`，embedding 走 openai 后端（配置空，实际可指 ollama）。
2. **MC 服务端 = `numen-sandbox/`**：NeoForge 21.1.233；mods 全为纯 Java jar（numen / numen_act / settlements / settlementsfix / lithium / modernfix / noisium / clumps / chunky / spark / architectury / supermartijn642configlib / alternate_current / incontrol / grieflogger）——**无 JNI native 依赖，跨平台无虞**。
3. **世界进程 env 契约**（bootstrap-world.mts 已核实）：`MC_DATA_DIR` / `MC_HOST` / `MC_PORT` / `MC_RCON_HOST` / `MC_RCON_PORT` / `MC_LOG_PATH` / `MC_GOD_NAME` / `MC_MEMORY_ENABLED` / `MC_QDRANT_URL` / `MC_EMBEDDING_URL` / `MC_EMBEDDING_MODEL` / `QWENPAW_CONSOLE_URL` / `MC_ADVANCEMENTS_DIR` / `MC_VIEWER`。
4. **旧 Docker 资产**：`mc-docker/`（一体化 Dockerfile.Server + compose + entrypoint + vol-staging 数据卷）、`mc-native/vol-staging/`（完整运行时数据：world.db/chronicle/magic-state/skins/transmigrators/screenshots/village/defects）。

## 三、目标拓扑（9 容器 + 单网桥 + 数据卷挂宿主机）

```
玩家 ──25565──► skin-proxy ──► mc-server(:25599, RCON :25575)
                                  ▲ mineflayer + RCON
                    world-process(Goddess) ──► qwenpaw(8088) / qdrant(6333) / ollama(11434)
                                  ▲ numen 假玩家
                    guard-drive(假玩家桥) ──► qwenpaw(8088 亲卫 agent)
                    web-panel(9090) ──► mc-server RCON
                    qwenpaw ──► vllm(8890, GPU 可选)
```

| 容器 | 镜像来源 | 内部端口 | 对外 | 数据卷 |
|------|---------|---------|------|--------|
| mc-server | 复用 `mc-server:latest` | 25599/25575 | — | `mc-server-data` |
| skin-proxy | node（B仓 sidecar） | 25565 | 25565 | skins 只读 |
| world-process | **重写**（脱壳 node22） | 3050 可选 | — | `world-data` |
| web-panel | 同 world-process 镜像 | 9090 | 9090 | `world-data` 只读 |
| guard-drive | python3.12（B仓 sidecar/guard） | — | — | guard 账本 |
| **qwenpaw** | **python3.12 + qwenpaw==2.1.0** | 8088 | 8088 | `qwenpaw-data`(~/.copaw) |
| ollama | ollama/ollama | 11434 | 11434 可选 | `ollama-data` |
| qdrant | qdrant/qdrant | 6333 | — | `qdrant-data` |
| vllm | vllm/vllm-openai（可选） | 8890 | — | 模型卷 |

## 四、数据卷落位

- `mc-server-data`（external，已有）= `numen-sandbox/` 的 world/mods/config。
- `world-data` = 世界进程运行时 data（以 `mc-native/vol-staging/` 为种子：world.db、world-chronicle.md、magic-state.json、skins.json、transmigrators/、screenshots/、village/、defects/ 等）。
- `qwenpaw-data` = 宿主 `C:\Users\lzl19\.copaw`（config.json、workspaces、sessions、memory、file_store、plugins）。

## 五、分阶段

1. **P1 重写世界进程镜像**（去 cordis 壳，node22 + tsx）。
2. **P2 QwenPaw 容器化**（pip 装 qwenpaw==2.1.0 + 挂载 ~/.copaw + 8088）。
3. **P3 重写 compose**（9 容器 + 单网桥 + 依赖顺序 + 健康检查）。
4. **P4 本地 Docker Desktop 起通验证自闭环**（MC + 世界进程 + 假玩家桥 + QwenPaw 编排）。
5. **P5 清理**：B 仓 data/skins.json 冗余副本、旧 cordis 镜像、mc-docker 一体化残留。

## 六、造物主最终拍板（2026-08-21 已定）

1. **不放 vLLM**：推理 + 视觉全走云端 QwenPaw provider，compose 无 vllm 容器。
2. **QwenPaw = 智能化管理世界的 AgentOS**：世界的中枢，通过 minecraft_companion MCP 操作世界角色；`qwenpaw` 服务 `depends_on: autoplayer`。
3. **CPU embedding 模型内置 docker**：`Dockerfile.ollama` 构建时 `ollama pull bge-m3-cpu:latest` 固化进镜像，自包含部署，运行时无需联网 pull。
4. **minecraft_companion MCP 有用**：= `mindcraft-autoplayer`（`C:\Users\lzl19\Documents\Codex\2026-06-20\new-chat\mindcraft-autoplayer`，`node src/server.js` 监听 4177，`/mcp` 暴露 MCP，依赖仅 prismarine-schematic）；`Dockerfile.autoplayer` 容器化，AgentOS 经它操作 MC 角色。

### 迁移执行时待处理（P4 验证阶段）

- **两套 QwenPaw 并存（2026-08-21 造物主明确）**：
  - **宿主机 QwenPaw（8088）= 造物主的 AgentOS**，`mc-god` 女神住在这里——**不可停、不可迁**，保持不动；
  - **容器 QwenPaw（AgentOS，服务器）** = 世界侧 agent（亲卫/传令官/灶神/mc-god 分身）的家，独立数据目录 `~/.qwenpaw-agentos`（从宿主机 `.copaw` 提炼：config.json 精简 + 世界侧 workspaces，挂载到容器 `/root/.qwenpaw` —— 全新安装无 legacy 包袱），经 minecraft_companion MCP 操作世界。
  - 端口：本地验证时容器映射 `18088`（避开宿主机 8088）；服务器部署设 8088。
- 容器 QwenPaw `config.json`（世界侧）：`minecraft_companion.url` → `http://autoplayer:4177/mcp`；`winremote.url` → `http://host.docker.internal:8090/mcp`（winremote 仍跑宿主，供 AgentOS 经网关遥控桌面）。
- autoplayer `data/config.json`：MC 服务器地址改 `mc-server`（RCON 25575 / 端口 25599）。
- 停宿主 ollama（11434）后拉起容器（embedding 已内置容器镜像，宿主 ollama 可退）；**宿主 QwenPaw(8088) 不动**。
