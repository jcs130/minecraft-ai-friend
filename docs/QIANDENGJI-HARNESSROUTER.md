# 千灯纪 1.21.1 的 HarnessRouter 接入

2026-10-22。现役千灯纪本体已是 **Paper 1.21.1 build 133**，
本接入也使用 **1.21.1** 协议；旧分支名称中的 `1.20.6` 是历史名称。
本次复用 My Agent World 已部署的 HarnessRouter 和自研 `agent-mc-autonomy 0.1.27`，
为千灯纪增加独立的普通 Mineflayer 接入包。没有替换现役 Agent 的控制器或导入个人资料。

## 运行位置和职责

| 项目 | 本机位置 / 入口 |
| --- | --- |
| 千灯纪游戏入口 | 局域网 `192.168.3.163:25565`；公网 `micro.kangqiang.site:25702` |
| 游戏服务端 | `E:\MC\server`，沿用原登录、技能、公会、保护和试炼插件 |
| 规划服务 | 原 `maw-harnessrouter`，仅 `127.0.0.1:29150/api/harness` |
| 自研框架安装 | `E:\MC\integrations\agent-mc-autonomy-0.1.27-harnessrouter` |
| 千灯纪冻结接入包 | `E:\MC\integrations\qiandengji-harness-20261022` |
| 本轮验收角色 | `E:\MC\agents\qiandengji-harness\ag_HarnQD22`；仅测试，勿复用此账号 |
| 源码 | `integrations/qiandengji-harness/` 和 `tools/qiandengji_harness.py` |

Harness 只提出结构化下一步；原框架校验工具参数、持有唯一控制租约，
再交给同一身体的原动作队列。模型推理不放进 Paper tick，也不再建立一个身体连接。
框架可远程运行并连接已有游戏入口；本机规划 API 没有开放公网。

当前 23 个已启用运行时及模型映射沿用
[运行时矩阵](HARNESS-RUNTIME-MATRIX-20261022.md)。本次不是再安装一套 HarnessRouter。
默认候选 Pi；DSH、Qwen Code、Claude Code、Codex、OpenCode 等可显式切换。
Claude Code 使用 `qwen3.7-plus-messages`，Codex 使用 `qwen3.7-plus-responses`，
其余使用 `qwen3.7-plus`。它们是本机 integration 别名，实际供应商模型均为线上 Qwen。
Cortico 和 Numen 自带循环尚未成为这里的原生运行时驱动。

## 本轮真实验收

独立普通账号在一个身体连接、一个自研控制器中依次切换六种运行时；
使用线上 `qwen3.7-plus`，未发送图片给模型。

| 运行时 | 找回同一条便笺并读取本人技能状态 | 一格步行与原终态 |
| --- | --- | --- |
| Pi | 通过 | `completed`，实际位置吻合 |
| DSH | 通过 | `completed`，实际位置吻合 |
| Qwen Code | 通过 | `completed`，实际位置吻合 |
| Claude Code | 通过 | `completed`，实际位置吻合 |
| Codex | 通过 | `completed`，实际位置吻合 |
| OpenCode | 通过 | `completed`，实际位置吻合 |

每种两次模型决策，共 12 次；加上初次保存便笺与一次验收工具投影纠正，
本轮共 14 次线上决策，14 个已知 Harness 任务都已结束。
六次走动在实测空旷、有实心地面的两格之间交替；没有挖掘、放置、传送或 OP 操作。
最终和重连后都在 `(-1128,64,-599)`，同一角色修订与原便笺保留，导出哈希验证通过。
最终冻结包再连接一次：33 个 SDK 工具、本人两条状态频道可用，拒绝包 0。
8 项 Node 测试和 5 项 Python 测试通过；角色/身体/登录模板匹配校验也通过。

早期失败如实保留：未修正的 1.21.1 客户端在配置阶段被踢；只读验收夹具曾把
异步收单当观测结果、假定存在可选 `mc_result`，后改用实际任务事件；首次模型验收
过滤掉了 `mc_invoke`，模型正确拒绝不存在的直接工具，之后补回真实渐进接口。
没有重做已完成的移动来覆盖失败，也未删除历史或旧便笺。

QA 已退出、控制租约释放；原四个在线角色继续使用原连接。
Paper、LAN 网关和 FOM 原进程保留，四份关键静态配置 SHA 不变，未新增公网端口。

## 千灯纪专用能力

在原 SDK 通用工具之外增加只读 `mc_qiandengji`：

```json
{"action":"state"}
```

返回登录连接的真实 UUID、采样时间、每个原消息的 `observedAt`、状态和最近回执。
保留原 `mcagent:state` / `mcviewer:state` 中的魔力、技能经验、冷却、职业、学院等字段；
不补造不存在的技能、法力或等级。私有 `mcagent:event` / `mcagent:protection` 回执有界保留。
另可用 `{"action":"guide"}` 读取简明玩法和命令发现方法。
未登录时原运行层拒绝访问；断线会清空这一连接的缓存。
自研控制器对扩展工具采用渐进发现：先 `mc_tool_help name:mc_qiandengji`，
再 `mc_invoke name:mc_qiandengji arguments:{action:"state"}`；直接 MCP 客户端可调用原工具。

频道注册沿用原玩家连接。每包最多 16 KiB，严格 UTF-8 JSON；
显式外来 UUID 或其他角色的观战状态会被拒绝，不向聊天、公屏或第二个连接转发。
没有变化时服务端可能不重发 `mcagent:state`，所以读取工具同时提供收到时间；
`mcviewer:state` 仍按服务端节奏重发。旧值不能直接当作刚采样的世界状态。

`/mycli` 继续由服务端实现，经原工具发送：

```json
{"steps":[{"skill":"chat","text":"/mycli status --json"}]}
```

先发现当前 `/mycli capabilities`，查询技能、公会、学院、保护和地下城的实际说明。
保护查询使用绝对坐标，等待私有 `mcagent:protection`；`unknown` 不等于允许。
本轮实际收到保护 `deny` 包；现役服务端还给请求者返回了一份个人 `MC_PROTECTION`
系统文字。本接入包自身没有向聊天复制数据，本轮未修改服务端的文字回执策略。
技能施放仍需满足本人职业、学习、魔力和冷却；本包没有赠物、OP 或绕过条件的接口。
动作收单不等于动作完成，发送命令不等于技能生效，必须检查原终态与实际结果。

## 准备独立角色

复制 [角色模板](../integrations/qiandengji-harness/agent.toml.example) 和
[身体模板](../integrations/qiandengji-harness/client.json.example) 到新的私有角色目录。
选择未使用的 `ag_` 账号，并填写自己的 `owner_id`、`agent.id`、人设、数据目录。
TOML 与身体 JSON 的服务器、用户名、协议和登录配置必须一致。
不要复制验收账号或在线角色的凭据、数据和控制器。

保持原游戏登录策略：首次进入由服务端决定是否放行；已有密码使用该账号的 `/login`。
后端必须等 `[MC_AUTH_SUCCESS]`，登录大厅的出生事件不能打开动作闸门。
本接入不自动注册新密码。账号设置密码后，按照
[登录模板](../integrations/qiandengji-harness/login.json.example) 配置私有凭据文件。
验收使用当前 Windows 用户保护的原始 DPAPI 字节；文件不放进仓库，
进程运行用户需能解密。重连仍走原网关，不直连 Paper 回环端口来绕过登录。

部署使用已锁定 `agent-mc-world 0.4.0` 包和 `npm ci`，不覆盖现役 Cortico/FOM 的
`node_modules` 或运行资产。冻结目录下 `body/qiandengji/entry.mjs` 是专用入口；
底层 SDK 保持原归档，版本及 SHA 见
[部署锁](../manifests/qiandengji-harness-20261022.lock.json)。
依赖清单与完整解析锁分别在接入目录的 `body-package.json`、`body-package-lock.json`；
部署时以 `package.json`、`package-lock.json` 放入独立 `body/` 后执行 `npm ci --ignore-scripts`。
本轮身体配置关闭新 Web 监听；若启用画面，需显式接上适合 1.21.1 的已验证渲染资源，
不能自动使用 SDK 内历史 1.20.6 资源来宣称画面已适配。

## 启动、切换和收尾

在 PowerShell 中先指定本次要运行的独立角色。下面路径是本机安装，
`$Role` 请换成已经配置好的角色文件。

```powershell
$Python = 'E:\MC\integrations\agent-mc-autonomy-0.1.27-harnessrouter\.venv\Scripts\python.exe'
$Release = 'E:\MC\integrations\qiandengji-harness-20261022'
$Role = 'E:\MC\agents\qiandengji-harness\ag_NewAgent\agent.toml'
& $Python "$Release\qiandengji_harness.py" check --config $Role --entry "$Release\body\qiandengji\entry.mjs" --key-file 'E:\MC\private\harnessrouter\api-key.json'
& $Python "$Release\qiandengji_harness.py" list
& $Python "$Release\qiandengji_harness.py" select --config $Role --harness pi
& $Python "$Release\qiandengji_harness.py" run --config $Role --entry "$Release\body\qiandengji\entry.mjs" --key-file 'E:\MC\private\harnessrouter\api-key.json' --goal '先查询本人的职业、技能和工会状态，制定下一项生活目标'
```

`run` 启动前台框架；另一个终端可以执行 `select --harness dsh` / `qwen` / `codex`。
选择只原子替换最后一个 `[planner]` 表，保留身体、人设、服务器、数据目录与旧账本。
正在执行的动作不重复派发，配置更换后才返回的旧推理会被拒绝。
运行时名称不等于新角色，也不自动导入该运行时原来的个人记忆。

```powershell
& $Python "$Release\qiandengji_harness.py" status --config $Role
& $Python "$Release\qiandengji_harness.py" stop --config $Role
& $Python "$Release\qiandengji_harness.py" agent-export --config $Role --output 'E:\MC\private\my-character-export.json'
```

停止需等待原动作对账并确认进程退出。出现未知结果时查询原 action ID，不能删租约、
清空目录或换 ID 重投。导出目标必须是新文件，包含人设修订和历史，不含游戏存档与密钥。
一致性备份、原 HarnessRouter 加密卷和游戏备份分别维护，见
[共用维护手册](MY-AGENT-WORLD-HARNESSROUTER.md)。云同步与玩家选择网页仍未实现。

## 1.21.1 登录切换修复

初次连接经过原 Velocity 登录大厅，登录成功切换 Paper 时，Mineflayer 4.37.1
的物理定时器还在发送 `position`，但 `minecraft-protocol` 已切到 CONFIGURATION。
实际抓到的最后序列是 `start_configuration → configuration_acknowledged → settings → position`，
随后代理报 `ClientConfigSessionHandler` 解码失败并踢出。
1.20.6 的对照可进入，不因此降低主协议版本。

专用接入通过 SDK 公开的 `createBridge` / `onBotCreated` 接点安装
`configuration.mjs`：配置期间暂停物理模拟、丢弃过时移动/输入包；
保留登录确认、配置、心跳及传送确认；新世界位置包到达后恢复原物理开关。
丢弃的输入不排队、不重放；不修改代理配置，也不重启游戏服。
这是本接入包的修复，未声称已经升级所有现役 Agent 的依赖或中途切服动作恢复逻辑。

官方协议库也明确区分 CONFIGURATION 与可以发送游戏包的 PLAY 状态：
[node-minecraft-protocol API](https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/docs/API.md)。

真实联机、模型决策、原动作终态及退出检查记录见
[验收汇总](evidence/qiandengji-harness-20261022.json)。本接入验证不代表长期自主生存、
全部技能或所有地下城已重新验收。现役世界、人物和其他服务沿用原实例。
