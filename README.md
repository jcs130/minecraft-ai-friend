# 异世界千灯纪 · 本地整合项目

项目目录：D:\Projects\QiandengJi。以 Rapid Optimization 为基础，整合已有玩法、AI 与原存档。Minecraft **1.21.1 / NeoForge 21.1.248 / Java 21**。

源码仓库：[jcs130/minecraft-ai-friend](https://github.com/jcs130/minecraft-ai-friend)，当前整合分支为 `codex/performance-foundation`，沿用原仓库历史，原世界源码已移入 `world/`。首次拉取请先读 [GitHub 开发与本机资源恢复](docs/GITHUB-WORKFLOW.md)：本仓库保存源码、配置模板、构建工具与验证方法；下文的运行状态、`reports/`、存档和成品链接指开发机上的本地文件，Git clone 不包含这些文件，也不等于已经完成环境安装。

第一批技能规则/存储、玩家命令和工会规则已作模块提取；实际边界、保留的耦合与后续顺序见 [代码架构与拆分记录](docs/ARCHITECTURE.md)。最新阶段按用户要求恢复运营组改造：独立服务已升级 QwenPaw 2.2.0，安装六角色实用技能，采用有限额的原生后台协作；入口、实测和费用约束见 [运营组说明](docs/OPERATIONS-TEAM.md)。

后续改造已将普通玩家命令执行从女神模块提取为独立应用服务，保持 `/mycli`、`/myhelp`、罗盘与既有 CLI 队列入口。world 启动不再等待 QwenPaw 健康；明确技能指令不调用模型，模糊咏唱、问答与祈愿仍使用原集成。验证与当前限制见 [玩家命令应用服务](docs/PLAYER-COMMAND-SERVICE.md)。

真人言灵入口统一为 **长按使用举杖 → 小窗默认语音、显示咒语示例 → 肩键左右选技能 → 松开释放**。左右肩键在语音与 8 个快捷槽之间循环，键盘备用 Page Up / Page Down；快捷槽在原技能罗盘编辑。每次重新举杖回到语音，准备与选择不会提前施法。两支自制法杖、录音和原生铁魔法的分工见 [言灵法杖说明](docs/STAFF-CHANTING-DESIGN.md)，实际运行证据与硬件体验的验收范围分别记录。

QwenPaw 已作为默认适配器保留，会话调用支持注入替换实现。打开 **http://127.0.0.1:19091** 作为日常管理首页：天神之眼、服务维护、运营组、技能档案、村务和共享传送点统一入口。服务器管理支持登录、维护预览、日志与执行回执；密码文件位于 `server/admin-state/secrets/admin-password.txt`。最新使用与架构见 [服务器管理说明](docs/SERVER-MANAGEMENT.md)。

运营治理入口为 **http://127.0.0.1:19091/#operations**：显示六个运营角色和两个游戏会话角色，排除宿主、旧游戏和内置辅助角色。运营实例的 default 是正式司灯。统一 CLI 为 `python tools/project.py ops status`，保留完整审计清单；启停只面向登记的 D 容器，先输出计划，执行带 `--execute qiandengji`。旧游戏环境已精确停用，宿主 QwenPaw、通用模型和非游戏任务保留。当前项目共 12 项服务（含独立运营容器），实际部署与模型实验见 [运营组说明](docs/OPERATIONS-TEAM.md)；原迁移文档保留为准备阶段记录。

结合《AI 共生与演化服务器》计划的后续方案见 [AI 共生世界设计](docs/SYMBIOSIS-WORLD-DESIGN.md)。设计保留当前底座与旧档，复用 Numen，优先补齐真人、AI 与女仆共享的实物工会合同，再发展生活、探索和世界演化；文中的新增能力是开发计划，不代表已部署。

2026-09-07 当前技能整合：**8 项特色秘术、27 槽技能罗盘、原生铁魔法入口和安全传送阵**已部署。新罗盘 10 组实机检查、传送 8 组检查通过；覆盖真实右键打开、图标、点击施法、一次扣费、请求去重、地点选择与跨维度到达。鸣人、桐人原生 YSM 已在真实客户端同时显示，女仆配音资源与语音链已有实测记录。当前服务状态以 `check-health.bat` 和运行报告为准，文末原档遗留项仍按各自范围说明。

原 59 份玩家数据和各维度进度继续保留。本轮已在正常停服后完成 **原 4 个 UUID 的 YSM 外观附件**绑定，保留其身份、物品、属性、位置、任务和其他进度，注册表未改动。实际记录见 `reports/character-model-bindings.json`；不再以迁入时的整文件哈希描述当前运行存档。

世界内容专项检查见 `docs/WORLD-CONTENT-STATUS.md`：已查出未接入的旧群系/地形包、NPC 实体与任务错配，并修复现有考古/怪物掉落和探索进度。当前存档的地形生成方案没有更换，未重建或删除旧区块。

2026-09-07 后续按用户要求精简：默认保留 **8 项特色秘术**，57 项旧主动施法归档停用，7 项被动及原永久奖励保留。右键指南针改为三行技能罗盘，固定铁魔法/传送阵入口，独立图标与只读档案；传送阵支持全部地点分页、固定编号、真实维度与安全落点。使用见 [技能说明](docs/SKILLS-UNIFIED-CLI.md)，逐项去留见 [精简审计](docs/SKILL-CONSOLIDATION-AUDIT.md)。此前罗盘精简阶段只更新服务端、兼容 0.1.2 客户端；后续言灵道具是双端更新，需要匹配新客户端。实际验收状态以各阶段报告为准，此前的羽落等 72 技能阶段结果是历史基线。

## 开始使用

1. 打开 Docker Desktop，双击 `start-server.bat`，等待服务健康。
2. 双击 `start-client.bat`，输入原来的玩家名，**拼写和大小写保持一致**；客户端直接连接 `127.0.0.1:25567`。
3. 结束后运行 `stop-server.bat`，正常保存并停止本项目。`check-health.bat` 检查服务和实际联调结果。

当前沿用原离线模式，相同名字才能对应原离线 UUID、背包与玩家进度。QA 使用专用测试角色，请用自己的原名继续玩。

可导入包：[QiandengJi-1.21.1-0.1.4-local.mrpack](dist/QiandengJi-1.21.1-0.1.4-local.mrpack)，**已导出并完成成品校验**。包含 87 个模组 JAR、自制言灵杖、基础优化设置、18 个女仆语音包和两套原生 YSM 人物模型（26 个文件）。Minecraft/NeoForge 由启动器安装，启动器导入界面未逐个测试。本机启动脚本只读使用已有游戏缓存，不读取账号凭据。

文件大小：383,565,975 字节。SHA256：`cdfbee0322452f97ab761bdb6f896458e77dad3c4c60f7fc3a39f339f932935e`。完整校验记录见 [pack-export.json](reports/pack-export.json)。

配音与人物外观见 [COSMETICS-STATUS.md](docs/COSMETICS-STATUS.md)。YSM 的 27 个内置模型完整保留，新增“鸣人 · 木叶忍者”和“桐人 · 黑衣剑士”，用 **Alt+Y** 打开选择界面。两个专用 Numen QA 身体已经完成实际显示、UUID 精确绑定和保存重建验证，见 [模型接入与截图](docs/PLAYER-MODELS-INTEGRATION.md)。原角色签名皮肤已恢复，原四角色的 YSM 附件已离线绑定，没有为验收召唤原角色；旧 GLB 仅作为源档另行归档。

键鼠、手柄与 Agent 的统一技能入口见 [SKILLS-UNIFIED-CLI.md](docs/SKILLS-UNIFIED-CLI.md)。右键技能指南针或按 F6 打开三行罗盘，可进入铁魔法、传送阵和只读旧技能档案。Controlify、YACL 和千灯控制器已安装；罗盘真实客户端画面见 `reports/skill-compass-visual.json`，实际物理手柄输入尚未验收。原生铁魔法的装备检查、菜单施法、真实效果、法力/冷却、卷轴消耗、中文咏唱及 Numen UUID CLI 已验证。原生 `casting_started` 回执表示已接纳并开始施法，不等于最终命中；特色秘术的旧魔力与铁魔法原生法力仍分别使用。

当前 D 盘服务端另已启用 `qiandeng_fixes` 内容修复数据包。单机存档使用相同模组时，可将 `dist/QiandengJi-content-fixes-1.21.1.zip` 放进该存档的 `datapacks/`；这个补丁独立于上述客户端 mrpack，不包含地形扩展。源码在 `content/datapacks/qiandeng_fixes/`，重建工具为 `tools/prepare_content_fixes.py`。

## 整合内容

- 本机开发客户端：**87 个 JAR**，由 24 个基础优化、59 个原内容/依赖、3 个控制器组件和 1 个自研言灵道具模组组成。保留 Sodium、Iris、ModernFix、C2ME 等现有配置基础，以及女仆、铁魔法、技能树、建筑、YSM 等原世界内容。可分发成品须另核对导出报告。
- 服务端：**71 个不同模组 JAR**，包含原生法术桥和新 `qiandeng_chanting` 自制法杖；本轮增加快捷栏编辑和录音区间校验，见 `reports/chanting-items-deployment.json`。原包仅去掉一份字节完全相同的 Better Combat 重复包；Spawn 动物内容已保留。
- 自研系统：botgate 的 Agent 协议、技能箱、飞行、附魔、光环；本地 Numen 与 numen_act；世界魔法引擎、NPC 消费链及 MCP 技能说明。
- 存档：完整 shadow 世界，含下界、末地、魔法口袋维度、女仆归隐之地、原有 59 份玩家数据、成就、统计和 spellbooks 数据包。
- 外部进度：72 条原技能定义及魔力/已学技能、传送点、人物档案、SQLite 账本等一并迁入；当前开放 8 项特色秘术，57 项旧主动技能归档停用，7 项被动及已有永久奖励保留。SQLite backup 包含 WAL 中已提交的数据。

原 C 盘客户端和 shadow 存档作为来源保留，D 盘是独立运行副本。开始复制时原 MC 服务已经停止，本项目没有重新启动它。

## 目录与备份

| 目录 | 内容 |
|---|---|
| client/ | 可运行整合客户端，含本机配置和日志 |
| server/mc/shadow/ | 已迁入并实际运行的原存档 |
| server/world-data/ | 技能、成长、人物、数据库和 AI 通道的权威数据 |
| server/mcdata/ | 游戏模组与 NPC 的共享队列、状态镜像 |
| server/agents/ | 独立女神 AI 的本机配置与凭据 |
| world/ | 世界端、botgate、MCP 和 sidecar 开发源码 |
| tools/ | 构建、迁移、启动与实际冒烟工具 |
| manifests/、reports/ | 文件锁、依赖检查及联调证据 |
| dist/ | 可导入整合包 |

备份个人进度：等待 `stop-server.bat` 完成后备份整个 `server/`。只复制 region 会丢失其他维度、玩家数据与自研技能进度。原始迁移记录 `server/snapshot-manifest.json` 中的 server-import 是暂存目录历史名称，随后整体改为 server；其中的静态检查状态不代替后续运行报告。

## 本机地址

| 用途 | 地址 |
|---|---|
| Minecraft / Agent 直连 | 127.0.0.1:25567 |
| 原版协议 Agent 网关 | 127.0.0.1:25701 |
| 本项目 RCON | 127.0.0.1:25577 |
| Simple Voice Chat | 127.0.0.1:24455/UDP |
| 女仆语音包 | http://127.0.0.1:19090/packs/ |
| 独立女神 AI 服务 | 127.0.0.1:18089 |
| D 盘独立管理台 | http://127.0.0.1:19091 |
| 天神之眼 | http://127.0.0.1:19092 |

当前地址用于这台电脑。局域网/异地联机需要设置可达地址与监听范围。女仆 TTS 已归属 D 项目容器，沿用 8100 端口，游戏队列使用 D 盘目录；原 9090 管理入口已经退役。

完整游戏对话测试中，原本地 27B 模型发生断流；本项目的 mc-herald 已改用与 mc-god 相同的现有云模型，保留各自角色提示词。原本地模型选择保存在 `server/agents/model-choice-backups/`，没有修改原服务的模型配置。

## 开发与验证

```powershell
cd D:\Projects\QiandengJi
python -m unittest discover -s tests -v
python tools/export_pack.py
python tools/project.py status
python world/ops/health/health_mon.py
```

静态依赖检查：`reports/client-validation.json`。部分 1.21 范围由 FML 自带兼容表接受，实际客户端已成功启动和进服。

本轮模型及控制器证据：`reports/game-models-smoke.json`、`reports/controller-support-health.json`、`reports/controller-visual.json`。`manifests/game-models.lock.json` 明确锁定两目录 26 个模型文件；成品已逐项校验模型 SHA256，导出拒绝未锁的 YSM 文件和 auth/cache/builtin 目录。原四角色实际写入见 `reports/character-model-bindings.json`；进度 JSON、SQLite 和 Pufferfish 另备份于 `runtime/backups/skills-integration-20260907`。

当前施法证据：[skill-compass-smoke.json](reports/skill-compass-smoke.json)（10 组通过）、[waypoint-travel-smoke.json](reports/waypoint-travel-smoke.json)（8 组通过）、[irons-bridge-smoke.json](reports/irons-bridge-smoke.json)（原生铁魔法入口，包括中文咏唱和 UUID CLI）。旧 [skill-cli-smoke.json](reports/skill-cli-smoke.json) 的 12 项记录属于精简前基线，其中羽落术等已归档，不代表当前仍可施放。

健康检查读取当前 11 个服务及扩展文件哈希，最新结果和时间见 [runtime-health.json](reports/runtime-health.json)。罗盘验收夹具的恢复与原技能/传送点保留情况见 [skill-compass-deployment.json](reports/skill-compass-deployment.json)。另有 [CLI 回应实测](reports/cli-feedback-smoke.json)：真实客户端收到一次状态和三次完整帮助回复，观察窗口内没有再次因刷屏断线；该项没有追加施法，也不代表无限频率请求测试。

实际 AI/技能结果：`reports/ai-smoke.json`；NPC 书籍交互：`reports/npc-smoke-*.json`；最新服务状态：`reports/runtime-health.json`。以报告时间和 ok 字段为准，离线测试成功不等同于所有游戏内容已实测。

源码、模板与报告不含密钥。server、client、.env 和 dist 被 Git 忽略；客户端导出采用明确白名单，不含个人存档、账号和服务端凭据。保留的原模型凭据只用于这个本地项目。

外部 Agent 的 MCP 配置示例在 `config/numen-mcp.example.json`，入口为 `tools/run_numen_mcp.py`；既有 Numen 工具与操作指南保留，统一施法接口见 [SKILLS-UNIFIED-CLI.md](docs/SKILLS-UNIFIED-CLI.md)。默认绑定名 QiandengAgent；连接前需由本项目的 Numen 创建同名身体。启动器强制使用 D 盘通道与新 RCON 端口，不能误读原服务密钥。接入方法见 `docs/NUMEN-MCP.md`。

本机 `world/node_modules` 已按原 lock 安装，安装时跳过 native build scripts；Docker 世界端仍使用原验证镜像中的完整运行依赖。若要改为宿主直接运行或启用 WebGL 视觉，需另行安装/构建 canvas、gl、better-sqlite3 等原生依赖；当前尚未验收宿主 Agent 的离屏 WebGL 视觉。

## 已知的原档遗留问题与验证范围

- 原 NPC 柜台档案仍指向已退役的 settlements 实体类型和新村庄坐标，存量对应实体却在旧区域，并存在大量历史重复记录。本轮保留原数据，不自动重召或清理 NPC；技能书消费链已验证，柜台交易未验收。详见 `reports/npc-trade-runtime.json`。
- 两份孟孟书匣的数据格式已修复并通过 reload。其他可选模组配方、标签等加载提示在原服已经存在，逐项记录在 `reports/save-runtime-verification.json`；不将静态依赖通过描述为所有模组内容都已穷尽测试。
- Simple Voice Chat 的实际客户端认证/连接及中文 TTS→ASR 已验证，真人麦克风输入和扬声器实际听感未验证。识别名单沿用 MengMeng，可在 compose 的 VOICE_ALLOWED_PLAYERS 中调整。
- 自动重建 NPC/村庄、旧清怪白名单、向量记忆、自动剧情/地形修复未在此次整合运行中启用。完整存档和文本记录保留，后续启用需单独核对对应依赖与旧实体状态。

真人操作见 [女神言灵：语言即接口](docs/LANGUAGE-INTERFACE.md)：长按使用键举起自制言灵杖，显示不遮挡瞄准的技能窗口；默认语音咏唱，左右肩键切换语音或 8 个快捷槽，松开使用键释放。罗盘中的“编辑快捷栏”可换技能、清空和恢复推荐。明确咒语不依赖模型；物理麦克风与手柄仍需实机验收。
