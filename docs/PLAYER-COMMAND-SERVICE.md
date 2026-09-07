# 玩家命令应用服务

2026-09-07。继续既定架构计划：复用已安装模组和原玩法，提取普通玩家命令执行，保留 QwenPaw 及既有 Agent 入口。

## 当前边界

| 部分 | 职责 |
|---|---|
| `gameplay/commands/player-cli.ts` | 原命令解析、帮助、状态和目录展示 |
| `application/player-commands.ts` | 状态、技能、明确施法、罗盘、技能栏、地点、传送和既有普通命令用例 |
| `application/player-command-ports.ts` | 注入游戏执行、技能状态、地点、私密回复、时钟和可选扩展 |
| `gameplay/native/contracts.ts`、`gameplay/travel/contracts.ts` | 原生法术、成长、传送点与执行回执数据 |
| `mc-god.ts` | 装配以上端口，保留旧聊天监听、授权解析、队列生命周期及女神集成 |

新服务的 `handleCli(subject, replyTarget, command, isGuardian, capture)` 分别接收动作主体和回执接收人；两者不能混用。授权仍由原入口查守护登记取得，`sys_` 名字本身不构成授权。

`castUnified(subject, args)` 保留明确技能 ID/名称和技能栏路由；原生法术交给 Iron 桥，特色秘术交给原精确施法器。装备、法力、冷却与原生 `casting_started` 回执语义不变。

`executeRequest({actor, command})` 继续服务本机可信技能队列，只接收原有 11 类命令，固定不授予守护权限。落盘请求 ID、请求过期、执行一次、重复读取同一回执和 `outcome_unknown` 处理仍由原 `skill-cli-queue.ts` 管理，没有新建外部管理 API。

## 玩家如何继续使用

原命令不变：`/myhelp`、`/mycli status`、`/mycli spells legacy`、`/mycli spells irons`、`/mycli menu`、`/mycli menu irons`。指南针右键和 F6 仍走现有模组菜单；技能用法继续以 [统一技能说明](SKILLS-UNIFIED-CLI.md) 为准。

确定性应用模块不导入模型、网络、文件、Minecraft Bot 或定时器。实际动作通过端口执行，脱离 QwenPaw 也可处理明确指令。

实际验收还查出一处回执缺陷：Minecraft 普通私聊限制正文为 256 字符，完整状态 JSON 会被服务器拒绝。`cli-feedback.ts` 为长回执改用仅发给指定玩家的 `tellraw` 文本组件，保持私聊显示样式和完整 JSON；短回复仍使用原私聊包。接收长回执的客户端工具应监听 `systemChat` 并使用 `incomingSystemWhisper` 验证结构和在线发送者，不能只监听 `playerChat`。既有文件 CLI 的结构化回执格式不变。

五类旧扩展仍在女神模块：`pray`、`offering`、`ask`、`chat`、`summon`。其中部分执行供奉或守卫任务，不都属于模型调用。没有注入扩展时，应用服务返回 `integration_unavailable`。`offering` 在旧分支中存在，但原解析器尚未把它登记为正式动词，本次未借整理改变解析行为。

模糊咏唱仍可能经过向量匹配和模型确认；问答、祈愿仍依赖原女神集成。`mc-magic.ts` 的向量预热尚未拆成可选匹配器。不能据本次确定性指令验证推断任意自然语言在断网时都可用。

## 启动与健康

world 只等待 Minecraft 健康，已去掉等待 QwenPaw 健康的启动条件。正常启动仍包含 QwenPaw，默认地址与模型配置保持原样。模型故障时，玩家命令不因 Compose 前置条件被阻止启动。

world 心跳新增 `playerCommands`，记录实际装配的命令服务及队列状态。现有 `restart: unless-stopped` 继续守护该进程；健康巡检同时核对新鲜心跳、当前源文件和模型不可达时的游戏内报告，接入 `probe_panel_smoke`。

玩家命令尚未拆成独立容器。女神化身及其聊天/队列生命周期仍在 world 内，因此停止整个 world 仍会停止这些入口。独立管理台继续位于 `http://127.0.0.1:19091`，原 9090 页面保持原状。

## 验证与回退

```powershell
node tools/check_architecture.mjs --self-test
node --test world/tests-ai/player-commands.test.mjs world/tests-ai/skill-cli.test.mjs
python -X utf8 -B -m unittest discover -s tests -p test_player_service_health.py
python -X utf8 -B world/ops/health/health_mon.py
```

应用测试导入真实模块并注入内存端口，覆盖普通命令、主体隔离、守护授权、JSON 原始回执、UUID、目录/技能栏、队列白名单、离线拒绝和失败不重放。当前 AST 核对保留原 22 个普通分支和 5 个扩展分支的覆盖、统一施法及队列回调等价性，并比较 92 个其余函数；其中 `menu` 新增快捷栏编辑入口，`skillbar` 新增显示同步，明确标为用户要求的行为改动，不宣称这两分支全文相同。

真实故障验证工具为 `tools/smoke_player_service.mjs`。它只在带本项目标记、独占 QA 锁的 D world 容器中运行，并要求实际模型地址为专用不可达地址。通过现有 QA 登录验证帮助、状态、技能目录、三行罗盘和原生菜单，不在故障测试中消费施法资源。部署编排用 `try/finally` 恢复默认地址并检查实际容器配置。

本轮汇总见 [player-command-service.json](../reports/player-command-service.json)，故障游戏内结果见 [player-service-offline-smoke.json](../reports/player-service-offline-smoke.json)，恢复后的服务状态见 [runtime-health.json](../reports/runtime-health.json)。源码基线统一由 `architecture-current.json` 指向最新里程碑；以前报告保留为历史。

后续法杖、录音和快捷栏编辑不能由最初的命令提取报告代替验收。最终汇总须核对当前双端构建、真实手势与菜单回执、分别恢复的 QA 正本/镜像、经过人工审阅的当前客户端截图，以及 0.1.4-local 的 87 JAR 成品。Python 测试数来自实际成功日志并核对日志哈希，不能把旧固定计数写成新运行结果。仅模型资源升级可保留代码不变的历史玩法证据；新的代码升级需要对应的新实测，正常女神和玩法检查应晚于最后一次 QA 恢复。

首次故障检查因已清理的旧 QA 档案提前退出；改用保留的 QA 后，定位到上述长私聊限制。失败记录和定向诊断保存在 `runtime/player-service-offline-attempt*.json` 与 `runtime/player-cli-length-failure.log`，未将短 JSON 承载诊断计作状态成功。

最初命令提取的备份在 `runtime/backups/player-service-20260907/`，该阶段仅修改 world。后续用户授权的言灵道具另有 `chanting-items-*` 存档/模组备份，更新了双端包和录音 schema 2；应按 `chanting-items-deployment.json` 的实际范围处理，不应在已注册新道具的世界中直接删除模组。

## 保留问题与下一步

本次整理保持原策略，未把以下历史问题描述为已修复：守护普通施法与专用施法门槛不一致；`guardian-cast` 的字符串结果被包装为成功；`cultivate/growth` 对原生执行失败的回执不够准确；出生天赋选择缺少候选范围与重复选择限制。它们需要独立验证后修正，避免架构搬迁同时改变既有奖励与权限。

按计划，下一步开发玩家可用的实物工会合同：预存报酬、实际交付、稳定合同编号和对账恢复。继续保留旧进度与 QwenPaw，不新增 Agent 身体或大脑。

## 语言主入口

后续同轮接入 `application/spoken-commands.ts`：完整语音咒语使用同一 `executeRequest`，未知咒语不猜测执行，否定/疑问只进独立对话。录音身份、实际首末音包时间与跨重启去重在外层适配器处理。`goddessChat`（语音只回复分支）与 `ensureAvatar`（语音轮询接线）有明确行为改动。见 [语言即接口](LANGUAGE-INTERFACE.md)。

新增 `staff-cast <1-8>` 仅供真人客户端松杖提交，需服务器确认已释放、当前选槽一致、原物品仍在原手中且手势未用；之后调用原 `castUnified`。语音提前识别时只轮询明确的 `gesture_pending`，松杖后才获得同一个一次性手势。未知/丢失回执不重发。`skillbar sync` 只把服务端的八个槽发给本人客户端作显示，客户端名称不参与授权；快捷栏仍是原 `players[login].skillbar`，没有新玩家数据库或新的 Agent 命令白名单。
