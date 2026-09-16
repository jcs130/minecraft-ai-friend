# 异世界千灯纪 · 本地整合项目

一个运行在本机的 **Minecraft 多 Agent 共生服务器**：真人玩家、房主女神、运营 Agent 团队、自主生存
Agent 与女仆妖精 Agent 共享同一个世界，各自有独立职责与入口。

- 游戏版本：**Minecraft 1.21.1 / NeoForge 21.1.248 / Java 21**
- 项目目录：`D:\Projects\QiandengJi`
- 源码仓库：[jcs130/minecraft-ai-friend](https://github.com/jcs130/minecraft-ai-friend)，主干 `main`，整合工作分支 `codex/performance-foundation`，原世界源码已移入 `world/`
- 当前按 **13 个活动 Docker 服务** 管理；历史阶段验收日志见 [整合历史记录](docs/INTEGRATION-HISTORY.md)

> 本仓库保存源码、配置模板、构建工具与验证方法。运行状态、`reports/`、存档和成品链接指开发机上的本地文件，Git clone 不包含这些，也不等于已完成环境安装。首次拉取先读 [GitHub 开发与本机资源恢复](docs/GITHUB-WORKFLOW.md)。

---

## 一、四类 Agent

整个系统的核心是四类自主 Agent，分工明确、互不替代：

### 1. 房主 · 灯语女神（世界管理权威）
世界的「房主」与管理员。以名为 `Goddess` 的观察者 bot 入驻服务器，**独占 RCON**，掌管巡逻、分诊、
派发、内容审批与程序化咏唱→法术。其 LLM 神谕走 QwenPaw 角色 `game:mc-god`。最终所有权归人类「造物主」。
- 载体：`world` 服务（`world/bootstrap-world.mts`，TS 世界引擎，进程内装配 magic/social/saga/terra/worlddb/logwatch 等）
- 天神之眼（世界观察渲染）：宿主 **19092**

### 2. 开发运营 Agent 团队（QwenPaw 单实例 · 10 角色）
负责游戏的开发、运营、策划与协调，全部统一在**游戏 QwenPaw 实例**（控制台 **18089**），以原生 cron
班次串行运行（旧独立运营实例已归档）。canonical 角色源：`world/ops/world_team.py`。
- **天神 / 工程师**（`qd-engineer`）：读写 `engineering/repo` 源码、跑隔离测试、提交受审修复
- **司灯 / 协调**（`qd-steward`）：工单台账、风险派发、回执
- **公会策划**（`qd-guild-planner`）：剧情/任务/活动设计，提交内容包
- 另有 **灯语·玩家交流**（`mc-herald`）、**内测玩家**（`qd-survivor`）、村民/女仆对话角色、结衣、女仆角色
- 治理入口：管理台 **19091** `#operations`；统一 CLI `python tools/project.py ops status`
- 设计背景见 [运营组说明](docs/OPERATIONS-TEAM.md)、[世界团队架构](docs/WORLD-TEAM-ARCHITECTURE.md)

### 3. 自主生存 · 自我进化 Agent —— 桐人（survivor）
一个具身、自主游玩并自我进化的游戏 Agent：controller tick 主循环驱动感知→决策→动作，经 Numen 网关
落地到游戏。具备**自适应 LLM 调用路由**（4 级双系统，按不确定性决定是否调用模型）、**模式检测与技能
结晶（熟能生巧）**、自主规划、身体丢失自愈、练习与成长。
- 载体：`survivor` 服务（`world/survival/service.py`），核心逻辑 `world/survival/controller.py`
- 设计见 [自主生存 Agent](docs/AUTONOMOUS-SURVIVOR.md)、[快慢双系统](docs/FAST-SLOW-AGENT-SYSTEM.md)、[自我规划](docs/SURVIVOR-SELF-DIRECTED-PLANNING.md)

### 4. 女仆妖精 Agent —— 结衣 / Yui（车万女仆模组）
基于 **车万女仆（Touhou Little Maid）** 模组的辅助妖精伴侣：SAO 导航妖精结衣，承担陪伴/家庭与
管理救援职责，**不会死亡**（伴侣保护），与桐人组成两人小队（桐人自主游玩成长，结衣不替其游玩）。
- Java 模组侧：`world/maid-bridge-src`（Touhou Little Maid 1.5.3 扩展，站点 `qiandeng-qwen`）
- Python 侧：`world/sidecar/maid_agent_api.py`（OpenAI 形状适配器 → QwenPaw 角色 `qd-maid-dialogue`）+ 身份/注册/原生工具/对话收件箱
- 村民与女仆引擎：`npc` 服务（`world/sidecar/mc_npc.py`，走裸 RCON），启动时拉起 maid-agent（:8091）与 party-agent
- 设计见 [女仆 Agent 设计](docs/MAID-AGENTS-DESIGN.md)、[结衣自主生活](docs/YUI-AUTONOMOUS-LIFE.md)、[SAO 角色](docs/SAO-CHARACTERS.md)

---

## 二、服务与基础设施（13 个活动服务）

| 服务 | 镜像 | 职责 | 宿主端口 |
|---|---|---|---|
| `mc` | itzg/minecraft-server:java21 | MC 服务器，持 shadow 世界存档 | 25565(LAN) / 25567(本机兼容) / RCON 25577 / 语音 24455·udp |
| `world` | qiandengji-world | 房主女神世界引擎 + 天神之眼渲染 | 19092 |
| `gate` | qiandengji-world | vanilla↔NeoForge 握手代理，Agent 协议入口 | 25701 |
| `panel` | qiandengji-world | 只读管理台（#operations/#services/#survivor） | 19091 |
| `control` | qiandengji-world | 部署/重启回执通道（/plan+/execute） | 容器内 3090 |
| `inventory` | qiandengji-sidecar | 只读容器健康采集 → panel | — |
| `npc` | qiandengji-sidecar | 村民/女仆引擎（含 maid-agent、party-agent） | — |
| `resources` | qiandengji-sidecar | 女仆语音包静态服务 | 19090 |
| `qwenpaw` | qiandengji-qwenpaw-game:2.2.1 | 游戏 QwenPaw（运营团队 10 角色宿主） | 18089 |
| `survivor` | qiandengji-survivor | 自主生存 Agent（桐人） | — |
| `voice` | qiandengji-voice | 女神语音监听（god-voice-watcher） | — |
| `asr` | qiandengji-voice | 麦克风 ASR 监听 | — |
| `tts` | qiandengji-tts:kokoro | Kokoro 中文 TTS | 8100 |

> `qwenpaw-ops`（旧独立运营实例，18090）在 compose 中保留定义但**已归档、不在 13 个活动服务内**；运营角色已并入游戏 QwenPaw 18089。

**载入 mc 的自研模组（非独立服务）**：botgate（Agent 协议/技能箱/飞行/附魔/光环）、maid-bridge（车万女仆桥）、irons-bridge（原生铁魔法）、god-voice、chanting-items（自制言灵法杖）、client-controls（客户端控制器）。源码在 `world/*-src/`。

**外部 Agent 接入**：运行 stdio Python MCP 桥 `tools/run_numen_mcp.py`（配置示例 `config/numen-mcp.example.json`），默认 `MC_HOST=127.0.0.1:25567`、`MC_RCON=127.0.0.1:25577`，身体经 `numen_act summon` 召唤；或以原版 bot 经 gate 25701 接入。详见 [NUMEN-MCP](docs/NUMEN-MCP.md)。

---

## 三、开始使用

1. 打开 Docker Desktop，双击 `start-server.bat`，等待服务健康。
2. 双击 `start-client.bat`，输入原来的玩家名（**拼写和大小写保持一致**，离线模式相同名字才对应原 UUID/背包/进度）；客户端连接 `127.0.0.1:25567`。
3. 结束后运行 `stop-server.bat` 正常保存并停止；`check-health.bat` 检查服务与实际联调结果。

局域网玩家在多人游戏中手动添加 `192.168.3.133`（TCP 25565）；游戏端口与语音 UDP 24455 已开放给局域网，管理端口仅本机。QA 用专用测试角色，请用自己的原名继续玩。

---

## 四、本机地址

| 用途 | 地址 |
|---|---|
| Minecraft / Agent 直连（本机兼容入口） | 127.0.0.1:25567 |
| 局域网游戏连接 | 192.168.3.133:25565 |
| 原版协议 Agent 网关（gate） | 127.0.0.1:25701 |
| 本项目 RCON | 127.0.0.1:25577 |
| Simple Voice Chat | 127.0.0.1:24455/udp |
| 游戏 QwenPaw 控制台（本机免密码，运营团队 10 角色） | http://127.0.0.1:18089 |
| D 盘独立管理台（运营治理 / 服务维护 / 天神之眼入口） | http://127.0.0.1:19091 |
| 天神之眼（世界观察渲染） | http://127.0.0.1:19092 |
| 女仆语音包 | http://127.0.0.1:19090/packs/ |

管理台与游戏 QwenPaw 仅发布到 `127.0.0.1`、本机免密码。旧运营 18090 已归档停用。

---

## 五、开发与验证

```powershell
cd D:\Projects\QiandengJi
python -m unittest discover -s tests -v
python tools/project.py status
python world/ops/health/health_mon.py
python tools/export_pack.py
```

- 代码架构与模块拆分见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。
- 可独立复用的两个组件：容器编队控制面（`world/admin/fleet/control-core.mjs` + 项目拓扑 `world/admin/topology.qiandengji.mjs`）与 [Agent 安全提交工作区](docs/AGENT-SAFE-COMMIT.md)（`world/ops/engineering_workspace.py` + `world/admin/engineering-runner.mjs`），两者都不含 Minecraft 概念，绑定项通过构造参数注入。
- 部署/重启**必须**走 control 回执通道（`/plan`+`/execute`，自动 mc save-all、依赖序、健康门、持久回执），发布流程见 [部署 runbook](docs/deploy-release-runbook.md)。Python/JS 代码经 bind mount 进容器，上线只需宿主检出 + 重启受影响容器；只有 compose.yml 变更才需重建服务。
- 服务健康与扩展文件哈希见 [runtime-health.json](reports/runtime-health.json)；各专项验收证据在 `reports/`，以报告时间和 `ok` 字段为准。
- 源码、模板与报告不含密钥；`server/`、`client/`、`.env`、`dist/` 被 Git 忽略。

---

## 六、目录与备份

| 目录 | 内容 |
|---|---|
| `world/` | 世界端源码：`src`(TS 世界引擎/gate)、`admin`(panel/control/eye)、`ops`(运营/QwenPaw 治理)、`sidecar`(NPC/女仆/公会/语音)、`survival`(自主生存 Agent)、`*-src`(自研模组源) |
| `server/mc/shadow/` | 已迁入并实际运行的原存档 |
| `server/world-data/` | 技能、成长、人物、数据库和 AI 通道的权威数据 |
| `server/mcdata/` | 游戏模组与 NPC 的共享队列、状态镜像 |
| `server/agents/` | 独立女神 AI 的本机配置与凭据 |
| `config/` | 角色（`characters/`）、伴侣保护、技能目录、Numen MCP 示例等配置 |
| `tools/` | 构建、迁移、启动与实际冒烟工具 |
| `manifests/`、`reports/` | 文件锁、依赖检查及联调证据 |
| `dist/` | 可导入整合包 |
| `client/` | 可运行整合客户端（本机配置和日志，Git 忽略） |

备份个人进度：等 `stop-server.bat` 完成后备份整个 `server/`（只复制 region 会丢失其他维度、玩家数据与自研技能进度）。

---

## 七、客户端分发包（当前）

当前分发包：[`dist/QiandengJi-1.21.1-0.1.5-local.mrpack`](dist/QiandengJi-1.21.1-0.1.5-local.mrpack)，已导出并完成成品校验。

- 大小：383,651,079 字节；SHA256：`7d80d0bff7885153ffd11ac424f9369e5547c0646a12f854c4a8b66e4e5937a0`
- 88 个模组 JAR、自制言灵杖、基础优化设置、女仆语音包、原生 YSM 人物模型；Minecraft/NeoForge 由启动器安装
- 完整校验记录见 [pack-export.json](reports/pack-export.json)；旧包与历史明细见 [整合历史记录](docs/INTEGRATION-HISTORY.md)

单机存档使用相同模组时，可把 `dist/QiandengJi-content-fixes-1.21.1.zip` 放进该存档 `datapacks/`（独立于客户端 mrpack，不含地形扩展；源码 `content/datapacks/qiandeng_fixes/`，重建工具 `tools/prepare_content_fixes.py`）。客户端兼容与注册表差异见 [CLIENT-REGISTRY-COMPATIBILITY.md](docs/CLIENT-REGISTRY-COMPATIBILITY.md)。

---

## 八、延伸文档

- 运行布局与验收边界：[GAME-RUNTIME-LAYOUT.md](docs/GAME-RUNTIME-LAYOUT.md)
- 技能与统一入口：[SKILLS-UNIFIED-CLI.md](docs/SKILLS-UNIFIED-CLI.md)、[言灵法杖](docs/STAFF-CHANTING-DESIGN.md)、[语言即接口](docs/LANGUAGE-INTERFACE.md)
- AI 共生世界设计（后续方案，非已部署）：[SYMBIOSIS-WORLD-DESIGN.md](docs/SYMBIOSIS-WORLD-DESIGN.md)
- 服务器管理：[SERVER-MANAGEMENT.md](docs/SERVER-MANAGEMENT.md)
- 历史阶段验收日志：[INTEGRATION-HISTORY.md](docs/INTEGRATION-HISTORY.md)
- Agent 协作约定（权威）：[AGENTS.md](AGENTS.md)
