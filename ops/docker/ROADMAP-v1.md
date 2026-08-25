# 千灯纪工程章程 — v1 封板 + 异世界大全集立项

> 造物主谕（2026-08-25）：
> 1. 已正常跑起来的服务器**封板**，作为 **Agent 友好服正式发布版本**；不能在宿主机裸机跑，**QwenPaw 也要内置到 docker 里**。
> 2. **全新的异世界大全集版本**作为下一个开发项目。

## 第 1 步：Agent 友好服封板（本项目）

### 目标形态
零宿主机进程：`docker compose up -d` 一键起全家桶，作为正式发布版（千灯纪 v1 · Agent 友好服）。

### 现状盘点（2026-08-25 裸机进程 → 目标容器）

| 裸机进程（pid） | 职责 | 目标容器 |
|---|---|---|
| java 39512 | MC 主服 NeoForge 21.1.73（25599/25575） | `mc`（itzg/minecraft-server:java21，已有骨架） |
| node 41896+12200 | 世界进程/女神化身 bootstrap-world.mts | `world-process`（Dockerfile.world 待建） |
| python 17656 | 守卫桥 guard_drive.py | `guard`（Dockerfile.guard 待建） |
| python ×6 mcp_numen.py | 守卫 agent 的 MCP 工具（QwenPaw 子进程） | 随 `qwenpaw` 容器内拉起（镜像内置） |
| python 39744/48304 | QwenPaw 服务本体（8088） | `qwenpaw`（**Dockerfile.qwenpaw 已写，构建中**） |
| node 48156 | web-panel.mjs | `world-process`（同容器或独立） |
| python 36480 | mc_gateway.py | 二期 |
| TTS cosy(8000)/indextts(8085) | 面板语音 | 二期可选（显存相关） |
| ollama 11434 | 本地模型 | 不进瓶（发行版默认云 API） |
| node 26892 | 门神 gate.cjs | 属异世界链路，本项目不含 |

数据面（已容器化，external 网络 `memos_memos` 接入）：memos-api:8002 / memos-mcp:8003 / qdrant / neo4j / redis。

### 镜像清单（2026-08-25 Phase A 全部出炉 ✅）
1. `qwenpaw-mc:2.1.0` ✅ 3.19GB。python:3.12-slim + PyPI qwenpaw==2.1.0（清华源）+ memos-api:local 底座，内置 mcp_numen.py + god_channel.py，冒烟过。
2. `mc-world:2.1.0` ✅ 2.23GB。**复用旧 mc-world:latest 当底座**（node v22.23.2 + tsx + linux 原生 better-sqlite3，实证 SQLITE_OK），仅 COPY 当前源码零 npm install；world-process 全装配链冒烟绿（36 atoms/众生册/三职女神 armed）。minecraft-protocol 1.66.2 实测够用。**保留底座 ENTRYPOINT**（sh -c defaults→data 补种 + exec tsx bootstrap-world.mts）——这是启动逻辑不是负担。
3. `mc-sidecar:2.1.0` ✅ 1.91GB。**guard/oracle/npc 三服务合一镜像**（memos-api:local python 3.11 底座，全标准库零 pip，不同 CMD 分服务）。oracle 9001 ✅、guard 双亲卫桥+影分身引擎 ✅（fail-fast：缺 RCON_PASSWORD 拒启，合理）。
4. `skin-proxy:2.1.0` ✅ 2.23GB。同旧底座 + COPY skin-proxy.mjs；**必须 ENTRYPOINT [] 清空底座入口**（否则 CMD 沦为旧 sh -c 的参数）；冒烟 listening :25565 ready ✅。
（auth 跳过；mc 服本体 = itzg 容器已有骨架，不在本批。）

### 数据卷分野（容器挂载地图）
- `data/`（B 仓根）→ world-process 卷：world.db/chronicle/guard 账本；缺的 atoms 等由旧镜像 ENTRYPOINT 从 /app/defaults 补种（cp -rn 不覆盖）。
- `mc-data/` → NPC 生态卷：village/villagers.json 等，`NPC_DATA_DIR` 指向它。
- `mc-server/` → MC 服卷（itzg /data 挂载，mods 真身在 data/mods）。
- 一期待办：guard 渲染路径（NODE_EXE/TSX_CLI）容器内无 node——渲染服务化进 world 容器（HTTP）二期解决；guard 主循环不受影响。

### 架构决策（已定）
- **神不进瓶子**：瓶中 QwenPaw 跑「世界专属 agent」（守卫魂等）；mc-god（天神）与宿主机 QwenPaw 留在外面管理容器。
- **瓶中数据家**：`~/.copaw`（config.json + workspaces + chats）volume 挂载，随世界数据卷走。
- **守卫魂 LLM 端点**：env 可配（默认云 API），私服可指 vllm:8890。
- **控制面**：新世界用神使通道（god-channel，共享卷文件 IPC）；RCON 留应急兜底。
- **MC 镜像坑**：itzg 把 /mods 拷进 /data/mods 不回收——增删模组动 `data/mods` 真身。

### 分阶段路线
- **Phase A（✅ 2026-08-25 完成）**：五件镜像（qwenpaw-mc/mc-world/mc-sidecar/skin-proxy + itzg mc）全部构建+冒烟通过。
- **Phase B**：影子环境端到端（compose 起全家桶、女神化身进容器 MC、守卫魂活、神使通道通、账本落卷）——不动生产。
- **Phase C**：停机窗口切换（生产 world/+data/ 挂入、裸机进程退役、compose 拉起、验证）→ **封板打 tag v1.0.0**。

## 第 2 步：异世界大全集（下一个开发项目）

- 基座：`mc-isekai`（31 模组，已在 docker，healthy）。
- 接入架构（2026-08-25 定谳）：**全员 numen**——必需通道玩法模组（河豚技能/铁之法术/史诗战斗）仅 numen 可承载；mineflayer 降级为老世界 + 门神外部通道。
- 控制面：神使通道为正典（信标已活、exec 实测通）。
- 第一里程碑：神使通道 summon 第一具 numen 身体 + 动词链全通。
- 复用第 1 步全部镜像。

## 构建记录
- 2026-08-25：Dockerfile.qwenpaw 落地；PyPI 直连慢（>20min 未完），改清华镜像源后台重建。
- 2026-08-25（Phase A 收官）：mc-world/mc-sidecar/skin-proxy 三件出炉并冒烟全绿。关键经验：①复用旧镜像当底座可零 npm/pip（先探底座 node_modules 与代码 import 树的差集）；②旧底座 ENTRYPOINT 是 sh -c 时，新镜像自定义入口必须 `ENTRYPOINT []`；③`.dockerignore` 先行防 context 吞 node_modules；④guard/oracle/npc 三 python 服务合一镜像（零 pip，CMD 分服务）省 2×1.9GB。
