# 整合历史记录（阶段验收日志归档）

本文件归档自 `README.md` 的历史阶段验收日志，2026-09-16 随 README 架构化重写移出。
这里保留的是**阶段性验收事实与历史基线**，不代表当前运行状态；当前架构、服务与入口以
[README](../README.md) 和 [D 盘游戏运行布局](GAME-RUNTIME-LAYOUT.md) 为准。各专项验收以
`reports/` 下对应报告的时间和 `ok` 字段为准。

## 2026-09-13 服务整理

按 13 个活动 Docker 服务管理，10 个现有 Agent 统一在游戏 QwenPaw 18089，旧运营实例归档；
Kokoro 替换 IndexTTS。数据目录、入口、重建和本次验收边界见 [D 盘游戏运行布局](GAME-RUNTIME-LAYOUT.md)。
早期角色数量和验收为历史阶段记录。

游戏 QwenPaw 升级至 **2.2.1**，运营角色与游戏角色统一在游戏实例；原 10 角色、记忆、会话与
16 项 Cron 保留，官方 MakeSkill 2.0 完整包已接入，见 [升级记录](QWENPAW-221-UPGRADE.md) 和
[能力与市场复用](QWENPAW-CAPABILITY-REUSE.md)。[运营组说明](OPERATIONS-TEAM.md) 保留早期六角色
独立运营阶段的设计与实验，当前服务和角色数量以运行布局为准。

## 2026-09-07 技能整合与精简

**8 项特色秘术、27 槽技能罗盘、原生铁魔法入口和安全传送阵**已部署。新罗盘 10 组实机检查、
传送 8 组检查通过；覆盖真实右键打开、图标、点击施法、一次扣费、请求去重、地点选择与跨维度到达。
鸣人、桐人原生 YSM 已在真实客户端同时显示，女仆配音资源与语音链已有实测记录。

后续按要求精简：默认保留 **8 项特色秘术**，57 项旧主动施法归档停用，7 项被动及原永久奖励保留。
右键指南针改为三行技能罗盘，固定铁魔法/传送阵入口，独立图标与只读档案；传送阵支持全部地点分页、
固定编号、真实维度与安全落点。使用见 [技能说明](SKILLS-UNIFIED-CLI.md)，逐项去留见
[精简审计](SKILL-CONSOLIDATION-AUDIT.md)。此前罗盘精简阶段只更新服务端、兼容 0.1.2 客户端；
后续言灵道具是双端更新，需要匹配新客户端。此前的羽落等 72 技能阶段结果是历史基线。

第一批技能规则/存储、玩家命令和工会规则已作模块提取；实际边界、保留的耦合与后续顺序见
[代码架构与拆分记录](ARCHITECTURE.md)。普通玩家命令执行已从女神模块提取为独立应用服务，保持
`/mycli`、`/myhelp`、罗盘与既有 CLI 队列入口；world 启动不再等待 QwenPaw 健康；明确技能指令不调用
模型，模糊咏唱、问答与祈愿仍使用原集成。验证与限制见 [玩家命令应用服务](PLAYER-COMMAND-SERVICE.md)。

## 整合内容明细（迁入基线）

- 本机开发客户端：**87 个 JAR**，由 24 个基础优化、59 个原内容/依赖、3 个控制器组件和 1 个自研
  言灵道具模组组成。保留 Sodium、Iris、ModernFix、C2ME 等现有配置基础，以及女仆、铁魔法、技能树、
  建筑、YSM 等原世界内容。（注：当前导出包 `reports/pack-export.json` 记录为 88 个 JAR，以报告为准。）
- 服务端：**71 个不同模组 JAR**，包含原生法术桥和新 `qiandeng_chanting` 自制法杖；增加快捷栏编辑和
  录音区间校验，见 `reports/chanting-items-deployment.json`。原包仅去掉一份字节完全相同的 Better
  Combat 重复包；Spawn 动物内容已保留。
- 自研系统：botgate 的 Agent 协议、技能箱、飞行、附魔、光环；本地 Numen 与 numen_act；世界魔法引擎、
  NPC 消费链及 MCP 技能说明。
- 存档：完整 shadow 世界，含下界、末地、魔法口袋维度、女仆归隐之地、原有 59 份玩家数据、成就、统计
  和 spellbooks 数据包。
- 外部进度：72 条原技能定义及魔力/已学技能、传送点、人物档案、SQLite 账本等一并迁入；当前开放 8 项
  特色秘术，57 项旧主动技能归档停用，7 项被动及已有永久奖励保留。SQLite backup 包含 WAL 中已提交的数据。

原 C 盘客户端和 shadow 存档作为来源保留，D 盘是独立运行副本。开始复制时原 MC 服务已经停止，
本项目没有重新启动它。原 59 份玩家数据和各维度进度继续保留；已在正常停服后完成原 4 个 UUID 的
YSM 外观附件绑定，保留其身份、物品、属性、位置、任务和其他进度，注册表未改动，记录见
`reports/character-model-bindings.json`。

## 外观与配音验收（历史）

YSM 的 27 个内置模型完整保留，新增「鸣人 · 木叶忍者」和「桐人 · 黑衣剑士」，用 **Alt+Y** 打开选择
界面。两个专用 Numen QA 身体已完成实际显示、UUID 精确绑定和保存重建验证，见
[模型接入与截图](PLAYER-MODELS-INTEGRATION.md)。原角色签名皮肤已恢复，原四角色的 YSM 附件已离线绑定，
没有为验收召唤原角色；旧 GLB 仅作为源档另行归档。配音与人物外观见 [COSMETICS-STATUS.md](COSMETICS-STATUS.md)。

完整游戏对话测试中，原本地 27B 模型发生断流；mc-herald 已改用与 mc-god 相同的现有云模型，保留各自
角色提示词。原本地模型选择保存在 `server/agents/model-choice-backups/`，没有修改原服务的模型配置。

## 技能罗盘与言灵验收（历史）

键鼠、手柄与 Agent 的统一技能入口见 [SKILLS-UNIFIED-CLI.md](SKILLS-UNIFIED-CLI.md)。右键技能指南针或
按 F6 打开三行罗盘。Controlify、YACL 和千灯控制器已安装；罗盘真实客户端画面见
`reports/skill-compass-visual.json`，实际物理手柄输入尚未验收。原生铁魔法的装备检查、菜单施法、真实
效果、法力/冷却、卷轴消耗、中文咏唱及 Numen UUID CLI 已验证。原生 `casting_started` 回执表示已接纳并
开始施法，不等于最终命中；特色秘术的旧魔力与铁魔法原生法力仍分别使用。

真人言灵入口统一为**长按使用举杖 → 小窗默认语音、显示咒语示例 → 肩键左右选技能 → 松开释放**。左右肩键
在语音与 8 个快捷槽之间循环，键盘备用 Page Up / Page Down；快捷槽在原技能罗盘编辑。每次重新举杖回到
语音，准备与选择不会提前施法。两支自制法杖、录音和原生铁魔法的分工见
[言灵法杖说明](STAFF-CHANTING-DESIGN.md)，物理麦克风与手柄仍需实机验收。详见
[女神言灵：语言即接口](LANGUAGE-INTERFACE.md)。

当前施法证据：[skill-compass-smoke.json](../reports/skill-compass-smoke.json)（10 组通过）、
[waypoint-travel-smoke.json](../reports/waypoint-travel-smoke.json)（8 组通过）、
[irons-bridge-smoke.json](../reports/irons-bridge-smoke.json)（原生铁魔法入口，含中文咏唱和 UUID CLI）。
旧 [skill-cli-smoke.json](../reports/skill-cli-smoke.json) 的 12 项记录属于精简前基线，其中羽落术等已归档。

## 开发与验证证据指针（历史）

静态依赖检查：`reports/client-validation.json`。部分 1.21 范围由 FML 自带兼容表接受，实际客户端已成功
启动和进服。模型及控制器证据：`reports/game-models-smoke.json`、`reports/controller-support-health.json`、
`reports/controller-visual.json`。`manifests/game-models.lock.json` 锁定两目录 26 个模型文件。健康检查
读取当前服务及扩展文件哈希，最新结果见 [runtime-health.json](../reports/runtime-health.json)。另有
[CLI 回应实测](../reports/cli-feedback-smoke.json)、AI/技能结果 `reports/ai-smoke.json`、NPC 书籍交互
`reports/npc-smoke-*.json`。离线测试成功不等同于所有游戏内容已实测。

## 已知的原档遗留问题与验证范围

- 原 NPC 柜台档案仍指向已退役的 settlements 实体类型和新村庄坐标，存量对应实体却在旧区域，并存在大量
  历史重复记录。本轮保留原数据，不自动重召或清理 NPC；技能书消费链已验证，柜台交易未验收。详见
  `reports/npc-trade-runtime.json`。
- 两份孟孟书匣的数据格式已修复并通过 reload。其他可选模组配方、标签等加载提示在原服已经存在，逐项记录
  在 `reports/save-runtime-verification.json`；不将静态依赖通过描述为所有模组内容都已穷尽测试。
- Simple Voice Chat 的实际客户端认证/连接及中文 TTS→ASR 已验证，真人麦克风输入和扬声器实际听感未验证。
  识别名单沿用 MengMeng，可在 compose 的 VOICE_ALLOWED_PLAYERS 中调整。
- 自动重建 NPC/村庄、旧清怪白名单、向量记忆、自动剧情/地形修复未在此次整合运行中启用。完整存档和文本
  记录保留，后续启用需单独核对对应依赖与旧实体状态。
- 世界内容专项检查见 [WORLD-CONTENT-STATUS.md](WORLD-CONTENT-STATUS.md)：已查出未接入的旧群系/地形包、
  NPC 实体与任务错配，并修复现有考古/怪物掉落和探索进度。当前存档的地形生成方案没有更换，未重建或
  删除旧区块。

## 客户端分发包历史

旧分发包 `QiandengJi-1.21.1-0.1.4-local.mrpack`：383,565,975 字节，SHA256
`cdfbee0322452f97ab761bdb6f896458e77dad3c4c60f7fc3a39f339f932935e`（已被 0.1.5 取代，当前包见 README）。
未知注册表报错、补丁安装和分发差异见 [客户端兼容说明](CLIENT-REGISTRY-COMPATIBILITY.md)。
