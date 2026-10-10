# 服务端常驻 Numen 与基岩同伴管理

本项目在官方 Numen 0.1.4.1 beta 上增加独立的服务端宿主。外部 Agent 直接使用认证 MCP 控制持久假玩家，主人 Minecraft 客户端可以完全不启动。基岩玩家通过 Geyser 原生表单管理自己的模型和同伴。官方 core/API JAR 保持原始 SHA；原 Mineflayer / Native SDK 入口继续保留。

实现为 `maw_numen_server-0.1.0.jar` 和独立 Geyser 扩展 `MawAgents.jar`。前者在受管 Java 进程内运行，后者随现有基岩桥启动。没有新增常驻服务、路由映射或对外端口。

2026-10-10 增量：同一基岩菜单新增 `/mawagent maid`，适配车万女仆原生 LLM 服务和本人女仆的人格/模型。TLM 服务按原生规则由 OP 管理，和 Numen 每人私有模型分开；详见 [车万女仆基岩配置](MY-AGENT-WORLD-MAID-BEDROCK-CONFIG.md)。下面“首次部署”校验值保留为历史，当前构建以本机 `build-record.json`、构建锁及增量验收为准。

## 两种控制方式

| 方式 | 模型在哪里 | Key 配在哪里 | 游戏身体 |
|---|---|---|---|
| 外部 Agent | Agent 自己的框架 | Agent 自己保管；服务端只需访问令牌 | Numen 服务端假玩家 |
| 服务器托管同伴 | 服务端复用 Numen AgentLoop / SerialCalls | 基岩原生表单，按主人 UUID 分开保存 | 同一持久 Numen 身体 |

每具身体一次只有一个控制器。外部控制需要 90 秒租约，可通过 `claim_control` 或动作续期。托管大脑运行中不能抢占；先暂停再切换。Numen 原客户端对受管身体派 Lua 会被明确拒绝，避免两个大脑同时操纵。

身体 `bodyId` 是真实假玩家 UUID，与主人 UUID 分离。执行器使用派生的内部 UUID，仅用于 Numen 调度与缓存，避免原生 `ownerLeft` 取消离线主人的服务端动作；身体归属、权限、存档和事件仍使用原主人 UUID。不会授予 OP。

## 外部 Agent 接入

局域网 MCP：`http://192.168.3.163:28984/numen/mcp`。

这是现有受管 worker 的 HTTP 入口，只代理 `/numen/mcp` 到 `127.0.0.1:28989/mcp`。模型配置桥 `/ui` 只接受本机 Geyser 的独立私有凭据，不通过 LAN 代理。沿用家庭网段访问规则，没有公网发布。

连接类型是 Streamable HTTP，JSON-RPC 2.0，UTF-8 JSON。设置 `Authorization: Bearer <本人令牌>`、`Content-Type: application/json`、`Accept: application/json, text/event-stream`；后续可附 `MCP-Protocol-Version: 2025-06-18`。支持 `initialize`、`ping`、`tools/list`、`tools/call`；本实现没有 SSE 事件流，事件用有游标的工具查询。

令牌可在基岩菜单的“外部 Agent 接入”中生成，只显示一次；再次生成立即撤销该账号的旧令牌。服主也可在本机运行 `python tools/maw_numen_server.py provision --owner <主人UUID> --label <说明>`，私有凭据文件保存在 `server/config/maw-numen-private/credentials/`，命令不打印令牌。给每个外部使用者单独的主人身份，不共用服主或已有玩家凭据。

推荐顺序：

1. `tools/list`，再 `operations` 查看当前实际能力。
2. `list_companions`；没有身体时 `create_companion`，带唯一 `action_id`。保存 `bodyId`。
3. `claim_control`，带稳定 `controller_id`；保存返回的 `leaseId`。
4. `get_state`；按需 `set_permission`：`ask` 遵循规则，`bypass` 允许本身体独立生存行动，`observe` 只读。三者均不授予 OP。
5. `operations` 查询具体分组的签名和示例，使用 `availableWithoutClient=true` 的函数。
6. `lua` 带 `companion`、`lease_id`、唯一 `action_id` 和 `code`。接收成功只是 `accepted`；持续 `action_status` 查询到终态，再核对实际位置、库存或菜单变化。
7. `get_events` 按 `after` 游标读取；成功处理后 `ack_events`，带租约和 `through` 序号。
8. 结束后 `release_control`。需要休眠时，停止动作后 `dormant_companion`；使用 `restore_companion` 以原 UUID 恢复。

14 个 MCP 工具：`operations`、`list_companions`、`create_companion`、`get_state`、`claim_control`、`release_control`、`set_permission`、`lua`、`action_status`、`action_cancel`、`get_events`、`ack_events`、`restore_companion`、`dormant_companion`。`tools/list` 提供完整参数、必填项与用途。

Lua 参数示例：

```json
{"companion":"身体UUID","lease_id":"租约","action_id":"walk-唯一ID","code":"local s=numen.status.self(); local p=numen.route.plan({to={x=math.floor(s.pos.x)+2,z=math.floor(s.pos.z)},costs={dig=false,place=false}}); if not p.ok then error(p.why) end; local m=numen.move.go(p); print(m.pos.x,m.pos.y,m.pos.z)"}
```

此处 x/z 是绝对世界坐标。需要结果进入远端正式回执时使用 `print`；原生 Lua `return` 的进程内值不自动上网线。API 目录从实际 `ApiRegistry` 生成，整合包验收为 22 组、71 函数；纯 Numen 环境为 18 组、54 函数。依赖主人客户端的函数会标不可用，并立即返回 `server_only_function_unavailable`。模组仍按目录的真实能力使用，不把 UI 图标存在当完整玩法可用。

## 身体状态、对账与恢复

`get_state` 包含身体和主人 UUID、采集时间、绝对坐标与维度、血量/最大血量、饥饿、实际库存和完整 SNBT 组件、当前菜单/光标、当前动作、控制方式和托管大脑状态。死亡、离线分别表示；不返回模型 Key。

动作在派发前 fsync 写入意图，完成后写终态和前后状态。相同 `action_id`、相同代码返回已有结果；换代码返回 `action_id_conflict`。断线后查询原 ID，不生成新 ID 盲目重试。跨重启仍无终态的动作明确为 `unknown`，暂停该身体恢复；保留原始记录，由服主核对。不会为了绕过未知结果换一个 UUID。

事件每具身体独立排序，读取不消费，明确确认后才清除。最多保留 256 条，每次返回 32 条；超限丢弃计入 `dropped`，不会声称完整。普通事件不被重新广播到游戏聊天。

正常停服会保存原生玩家数据。开服仅在 registry、玩家 `.dat` 均存在、没有未知动作或待恢复原生任务时恢复原 UUID。离线主人的死亡身体约 5 秒后在登记的安全落点恢复，保留游戏原本的死亡掉落/keepInventory 规则。托管目标不会在重启时自动重发模型请求；结果不明时需要核对。

初始容量为每主人 2 具身体、全服 8 具受管身体；仍需考虑服务器原本的玩家槽位与性能。长耗时 Lua 由原生异步程序引擎执行。HTTP 到 Minecraft 的主线程队列有上限；每刻处理最多 8 个请求且按 2 ms 时间片退出（单次状态读取本身仍占主线程）。

## 基岩版原生界面

连接 `192.168.3.163:28988`，进入后有欢迎表单；也可输入 `/mawagent menu` 打开。按钮和下拉框支持触屏、手柄。客户端不用安装 Numen。界面提供模型管理、创建同伴、控制方式、行动许可、目标、暂停及本人外部令牌。

配置模型时填写：配置名称、接口协议、模型 ID、API 基址、API Key。Qwen CodingPlan 可选择 OpenAI 兼容，基址 `https://coding.dashscope.aliyuncs.com/v1`；模型填当前订阅支持的实际 ID。其它兼容服务同理，Claude 使用 Anthropic 协议。

每个主人最多 8 个模型档案。已保存 Key 不回显、不进聊天、不进入 MCP 状态；编辑留空保留已有 Key。原生输入框没有密码遮罩，填写时留意录屏。私有文件只授予当前 Windows 账号和 SYSTEM，不提交 Git。

模型端点须 HTTPS 且在服主允许的主机列表内，拒绝 userinfo/query/fragment 和非标准端口；本机模拟服务只在隔离 QA 显式启用。真实模型 HTTP 不跟随重定向、不自动重试。托管同伴初始为停用，只有收到明确目标才推理；默认每身体每天 100 次、每目标最多 24 次、全服最多 2 个并发模型请求。失败或不确定结果会暂停，不把超时当成功。

启用托管：保存模型 → 创建同伴 → 控制方式选“服务器托管”及对应模型 → 按需选“独立行动” → 下达目标。外部 Agent 路线无需保存任何模型 Key。

## 运维与验收

构建：`python tools/build_numen_server.py`、`python tools/build_bedrock_agents.py --smoke`。第一条默认只编译，`--install` 仅允许已停止的管理目录；第二条编译并用真实 Cumulus codec/回调测试表单，不冒充手机实机验收。

初始化：`python tools/maw_numen_server.py initialize` 生成本机端点、空账号表、随机 Geyser 桥凭据与 Windows 私有 ACL，不导入任何已有模型 Key。JAR 安装与 Geyser 扩展发布必须走现有守护停服、零真人、冷备 CRC/逐 SHA 校验，再启动流程。使用现有 `maw_service.py`、`maw_bedrock_service.py`，不要按进程名强杀。

健康：`python tools/maw_numen_server.py health`，或 `health_mon.py --society-numen-server-smoke`；同时运行原 Numen 安装健康、Native SDK 和基岩入口检查。Geyser 守护会校验扩展构建契约、私有桥地址和实际注册标记。

隔离真实流程：`python tools/smoke_numen_server.py --full-pack --node <node.exe> --output <runtime/research/新目录>`。创建独立世界与端口，运行官方假玩家、真实普通主人连接、MCP、模拟模型、身份恢复与死亡复活；结束正常停服。付费模型调用为 0，生产世界动作 0。以保存的 `acceptance.json` 为准，失败证据保留。基岩资源/实际手机视觉、Java G 面板、长期自主生活、所有模组玩法仍分别验收，不能由这组测试代替。

撤回时先暂停同伴和外部控制器、正常停主服与基岩桥，移出本轮两个新增 JAR、禁用 `config/maw-numen-server.json`，保留私有配置、身体、玩家存档和动作/事件账本。原 Numen 与兼容层仍可使用；未知动作记录不能删除或自动重放。

## 2026-10-10 发布记录

已部署到正式局域网服。官方 Numen core/API、原 28 个服务端 JAR 和 279 个基岩模型/两套资源包保持；服务端新增 `maw_numen_server`，基岩桥新增 `MawAgents`，两者均不要求客户端安装。1129 文件、386573444 字节冷备已校验 CRC 和全部 SHA。现有世界 `world-life` 保留，五份保护配置和原 Agent 账本前缀逐字节保持；旧未知动作 `7927420b-0a39-46a5-b172-907e5c3a5598` 未重放。Java 正常重写了 `server.properties` 的日期注释，所有属性值及 `ops.json` 均保持。

整合包独立世界 25 项、正式 LAN MCP 9 项、原 Native SDK 8 项均通过；三次隔离 Java/Gate 停服退出码均为 0。真实 Geyser 扩展加载/RakNet 3 项，以及真实 Cumulus 表单编解码/回调的 11 项断言通过。正式基岩兼容链 Java 登录收到 45 个区块和 4 个库存包。服务器宿主健康 10 项、官方 Numen 安装健康 14 项及 Native SDK/基岩 manifest 冒烟通过；相关 Node 162 项、Python 49 项通过。模型链路仅使用本机模拟服务：实际推理循环完成读取状态、原生移动、结束；额外 503 失败验证暂停且不重试，付费调用为 0。

主守护沿用 `7688158f77b24c65b70536d5f4d5ca3e`，基岩守护为加载新契约正常关闭后重建，当前 `38a97b845c774df8916fbb53e49103c1`。原 MawExplorer 保持人工暂停，本轮只追加停启生命周期记录；QA 同伴已休眠，保留原 UUID/存档。所有临时端口已关闭，本轮维护已结束，不能重放固定动作 ID 或部署脚本。

当前启动日志没有 ERROR 级记录。部署前曾观察到原 worker 一次非请求退出 `3221226505`，守护已自动恢复，原因未确认；历史日志与失败验收均保留。实际手机表单显示、真实线上供应商、Java G 面板、长期自主生活和全部模组玩法仍未完成实机验收。

构建锁：服务端 SHA-256 `8d60868a36eb41ee0c8a03aa2782ffecaa06fb84546c863c9bd8222ac1068a5c`；基岩扩展 `d6a4a7da176233e5537e0063a55310cb2c7e6f67cec933839ef36a46214a1f0b`。本机证据位于 `research/numen-server-20261010/`，不提交凭据、存档、原始包或日志。

参考：[Numen 发布](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4.1-1.21.1-beta)、[MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)、[Geyser Forms / Cumulus](https://geysermc.org/wiki/geyser/forms/)。
