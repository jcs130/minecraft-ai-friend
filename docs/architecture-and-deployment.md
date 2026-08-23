# 架构与程序化部署（工程手册）

> 版本：v2026-08-23 ｜ 维护：创世天神（mc-god）自持
> 面向：后续接手工程侧的人，以及压缩上下文后的我自己。读完这本，能独立定位模块、起服、打包、排障。

---

## 0. 命名

- 世界名：**我的异世界**（「**异**」加重——区别于「我的世界 / Minecraft」）。
- 仓库名保留 `minecraft-ai-friend`（对外开源、与穿越者仓 `dsh-minecraft-agent` 配套，勿改名）。
- 内部代号「千灯纪」（千灯纪 · 世界 CLI、九灯深渊点灯换恩惠等叙事引用）。

---

## 1. 系统全景

```
                          ┌────────────────────────────────────────────┐
                          │  MC Java 服务端 (NeoForge 21.1 + numen + settlements)  │
                          │  :25599 内网口（mineflayer 直连）  :25575 RCON │
                          └────▲───────────────▲───────────────▲────────┘
                               │ RCON(唯一持有) │ 聊天/私语     │ numen_act
          ┌────────────────────┴──────┐   ┌──────┴───────┐   ┌───┴────────────┐
          │ 世界进程 bootstrap-world   │   │ 穿越者 ×N     │   │ 假玩家守卫桥     │
          │  (本仓 src/ 全部模块)      │   │ (开源插件仓)   │   │ sidecar/guard    │
          │  · mc-god 慢路径神谕       │   │  mineflayer   │   │  guard_drive.py  │
          │  · mc-magic 快路径施法     │   │  零服务器权限   │   │  (身=numen实体)   │
          │  · 女神化身 bot(旁观)      │   └──────────────┘   │  (魂=QwenPaw亲卫) │
          └────────────────────────────┘                     └──────────────────┘
                               │                                        │
                    ┌──────────┴───────────┐              ┌─────────────┴──────────┐
                    │ 观察甲板 web-panel:9090│             │ NPC 引擎 sidecar/mc_npc  │
                    │ (人类观众，零权限只读)  │             │ (讲述者+委托经济+自由活动) │
                    └───────────────────────┘             └──────────────────────────┘
```

**铁律**：世界进程是唯一 RCON 持有者；穿越者零服务器权限（AI 与真人平权，想施法念咒、想祷告低语）；天神不操控穿越者——只立法、守望、回应。

### Docker 生产拓扑（docker-compose.yml，9 服务）

| 服务 | 镜像 | 端口 | 职责 |
|------|------|------|------|
| `mc-server` | Dockerfile.mc-server | 25599 | NeoForge + numen + settlements 数据源 |
| `skin-proxy` | node:22-slim | 25565→25599 | 皮肤代理前门（按用户名绑皮肤） |
| `world-process` | Dockerfile | — | 世界进程（Goddess，唯一 RCON 持有者） |
| `web-panel` | mc-world | 9090 | 观察甲板 |
| `guard-drive` | python:3.12-slim | — | 假玩家守卫桥（身/魂桥接） |
| `qwenpaw` | Dockerfile.qwenpaw | 18088(宿) | 服务器侧 AgentOS（世界 agent 中枢） |
| `autoplayer` | Dockerfile.autoplayer | 4177 | minecraft_companion MCP（AgentOS 操作 MC 角色） |
| `ollama` | Dockerfile.ollama | 11434 | CPU embedding（bge-m3，内置镜像） |
| `qdrant` | qdrant:v1.15.3 | 6333 | 世界向量库（独立于 MemOS） |

---

## 2. 模块地图（src/ 世界进程）

| 模块 | 职责 |
|------|------|
| `mc-bot` | 女神化身 bot：mineflayer + prismarine-viewer 双视图；mod 实体名归一化到 vanilla（否则 viewer 渲染紫盒/不可见） |
| `mc-rcon` + `rcon` | 共享 RCON 服务（自动 Unicode 转义，RCON 不能直传中文）+ RCON 底层协议 |
| `mc-logwatch` | 服务器事件流：tail `logs/latest.log`，~0.5s 结构化事件（死亡含凶手/死因、上线、成就） |
| `mc-worlddb` | SQLite 世界账本：众生册（玩家名册）+ 编年史（施法/死亡/供奉/升级/觉醒/仪式留痕） |
| `mc-magic` | 快路径施法：咒语→原子表 `data/magic-atoms.json`，校验扣 `{mana,food,hp}`，纯 vanilla 粒子/音效渲染，零 LLM；契约/魂链走 `specialExecutor` |
| `mc-god` | 慢路径神谕 + 世界守望者（天神三职）：祈愿收件箱→女神裁量→神迹；供奉经济；死亡守望；等级同步；CLI 分发器；`execSpecial`（契约/唤魂/寻踪） |
| `mc-cli` | 世界 CLI 纯函数层：命令树 `CLI_VERBS`、解析、帮助文本、数据塑形（执行由 mc-god 分发器落地） |
| `mc-man` | 世界操作手册（`/help` + 白纸冷启动引导）：零 LLM 纯查表，回复走私语，每行 ≤60 字符 |
| `mc-ritual` | 降临仪式：女神宣读候选天赋，穿越者聊天作答，落定出生天赋 |
| `mc-offering` | 供奉协议共享库：物品名词典、背包解析（穿越者上报，世界侧 RCON 复核收执） |
| `mc-transmigrator` | 穿越者册：纯内存 + 启动读 `data/transmigrators.json` |
| `mc-social` | 社会：喊话转达（96 格半径）、邮差+好友、上线提醒、位置缓存（5s TTL）、村民开耳 |
| `mc-saga` | 编年史/故事线：神托任务核销/作废、事件三幕、空投恩赐、发奖（升级增益 5s>60s 巡检无缝） |
| `mc-terra` | 大地塑形：可塑之材白名单（水/岩浆/TNT 永不入列）、井洞隐患巡检、TERRAFORM 指令 |
| `mc-evolve-review` | 进化复盘：女神 LLM 审进化，危险词直接驳回、系统级转造物主 |
| `mc-bubble` | 气泡：玩家全局→气泡、NPC feed 转译→NPC 气泡、NPC 任务状态行 |

### sidecar（Python 常驻，纯 stdlib）

| 目录/文件 | 职责 |
|-----------|------|
| `sidecar/mc_npc.py` | NPC 村民引擎：讲述者（风临/烛九/静水驻场）、每日委托经济、白天自由活动 |
| `sidecar/guard/guard_drive.py` | 假玩家守卫桥：身（numen NumenPlayer）/魂（QwenPaw 亲卫）/桥（读 `goddess-orders.jsonl` 驱动）；无裁决权，大愿上达女神 |
| `sidecar/guard/start_guard_drive.py` | 守卫桥入口（多守卫实例拉起） |
| `sidecar/skin-proxy.mjs` | 皮肤代理（按用户名从 skins.json 绑皮肤，走 viewer 侧） |
| `sidecar/mc_guild.py` / `summon_npcs.py` / `npc_skins_gen.py` | 公会 / 召唤 NPC / NPC 皮肤生成 |

### 其他仓内目录

| 目录 | 职责 |
|------|------|
| `mc-gateway/` | Python 网关：MC 网关 + DB 设计 + 迁移（PG18+pgvector 选型已定） |
| `build-settlementsfix/` | Java mixin mod（NeoForge，JDK21 编译）：村民名/气泡/守护天使隐形 |
| `scripts/` | 构建/打包脚本（stage-mc-server、stage-world、build-dist-assets、agent/npc 管理） |
| `packaging/mc-world/` | 分发版插件包（plugin.json + backend + assets） |
| `ops/` | 运维脚本（daily-recon、society_health、terrain_repair、tts_edge_synth、restart-panel） |
| `design/` + `docs/` | 设计稿 + 文档（本手册、契约法术手册、CLI 手册等） |

---

## 3. 关键数据流

- **咏唱/施法**：玩家公屏念咒 → `mc-man.sniffChant` 嗅探 → `mc-magic.cast` 匹配原子表 → 已学=自施（扣魔力），未学=上达 `mc-god`（女神裁量代施或拒）。契约/魂链三原子（`special` 字段）→ `specialExecutor`（mc-god.execSpecial）。
- **祈愿**：私语/公屏「祈愿：」→ `mc-god` 收件箱 → 女神裁量 → RCON 落地神迹。供奉经 RCON 复核祭品→永久魔力上限祝福。
- **契约/召唤**：`bind_guard`（缔结契约）与 `cli summon` 同源 → `issueSummon` → 写 `goddess-orders.jsonl` → `guard_drive.py` 读走 → 亲卫自主到场。**不强制 tp 守卫**（守卫有意志，是委托不是控制）。
- **死亡守望**：`mc-logwatch` 秒级触发 → 记分板 RCON 复核 → 编年史 + 女神神谕。

---

## 4. 程序化部署

### 4.1 本地开发（start-*.bat）

```
start-world.bat        # 世界进程（Goddess，唯一 RCON 持有者）
start-panel.bat        # 观察甲板 :9090
start-skin-proxy.bat   # 皮肤代理 :25565→25599
python sidecar/mc_npc.py                # NPC 引擎
python sidecar/guard/start_guard_drive.py   # 守卫桥
```

**启动顺序铁律**：先穿越者 bot 入服 → 再启世界进程（死亡守望名单是武装时刻快照，world 后启才全员覆盖）。
**环境变量**：`MC_HOST` / `MC_PORT` / `MC_USERNAME` / `MC_VIEWER_PORT` / `MC_GOD_NAME` / `MC_RCON_HOST` / `MC_RCON_PORT`。RCON 密码在 `data/rcon-secret.txt`（**永不入库**，已在 .gitignore）。

### 4.2 一键部署（deploy-server.mjs）

```
node deploy-server.mjs                 # 默认全量（下载 MC 服务端 + 生成配置 + RCON 密码）
node deploy-server.mjs --skip-mc       # 已有 MC 服务器，跳过下载
node deploy-server.mjs --with-qwenpaw  # 连天神 agent 一起起
```

生成物：`server.properties`（rcon 开 + offline 模式 + 命令方块开）、`data/rcon-secret.txt`（随机 16 字节 hex）、`start-world` 脚本（.bat/.sh）。安全提醒：`online-mode=false` + rcon 仅限内网/白名单，勿暴公网。

### 4.3 Docker 生产（docker compose）

```
copy .env.example .env   # 填 RCON_PASSWORD / QWENPAW_AUTH_* / 各 DIR
docker compose up -d --build
```

`.env` 关键项（详见 `.env.example` 注释）：`RCON_PASSWORD`、`MC_SERVER_DATA_DIR`（NeoForge 完整数据源）、`QWENPAW_AGENTOS_DATA_DIR`（容器 AgentOS 独立数据根，勿与宿主机 .copaw 共享——SQLite 锁冲突）、`QWENPAW_HTTP_PORT`、`AUTOPLAYER_DIR`。

### 4.4 分发打包（packaging/mc-world）

- `scripts/stage-mc-server.py` → 收集 MC 服务端（NeoForge + numen + settlements）到 dist。
- `scripts/stage-world.py` → 收集世界源码（src/ + tsconfig + package.json）到 `packaging/mc-world/assets/world/`。
- `scripts/build-dist-assets.py` → 构建分发资产。
- `scripts/extract-world-agents.py` / `add-official-npcs.py` / `demote-optional-npcs.py` → agent/NPC 名册管理。

**注意**：`packaging/mc-world/assets/world/src/*` 是 `src/*` 的**分发镜像**——改代码时同步两处（或改 stage 脚本后重跑）。本手册维护时若只改一处会漂移。

---

## 5. 铁律与约束

1. **name/ID 分离**：显示名（桐人/鸣人/萌萌）只用于叙事/人机界面；程序化操作（RCON `tp`/`data get entity`、发消息）一律用 ASCII 登录名 + UUID。守卫登录名映射 `{ 桐人: Kirito, 鸣人: Naruto }`。
2. **世界进程是唯一 RCON 持有者**；穿越者零权限；numen（Java 侧）不得改动，改动只限女神体系（TS 侧）。
3. **修改服务端 mod 后需重建 jar 并重启服务器**（用户点头才重启）；假玩家改动只重启守卫桥 + 世界进程。重启 MC server 前先备份 world。
4. **本机 Python 被 uv 劫持 `PYTHONHOME`**：跑脚本前用干净解释器 `C:\Users\lzl19\AppData\Local\Programs\Python\Python311\python.exe`（build.py 用 `python.exe -E`）。
5. **secret 不落盘**：不复制/保留 credential、token、API key、RCON 密码、连接串。
6. **临时探针脚本用后即清**（Windows 用 `del`）。
7. **汇报流向**：游戏内女神 → 创世天神（我）；日报不转交造物主；只有重大事项（开活动/新技能/排障）才请示。
8. **不设「遇难题即找小智」默认管道**：B 仓工程自己扛，啃不下向造物主摊牌，不是外包。
