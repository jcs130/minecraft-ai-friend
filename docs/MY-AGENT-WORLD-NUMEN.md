# My Agent World：Numen 接入

本服保留 Mineflayer / 原生 SDK，同时增加官方 Numen 假玩家路线。2026-10-09 核对官方 release 列表，适配 Minecraft 1.21.1 的最新发布是 **Numen 0.1.4.1 beta**，不是旧版 0.1.3，也不是开发分支。

- Minecraft 1.21.1、NeoForge 21.1.248、Java 21。
- [官方发布](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4.1-1.21.1-beta)，源码固定 `2a5753cbde3edd342fb50e0b2a4d52dff4269d38`。
- 安装 `numen-neoforge-1.21.1-0.1.4.1.jar`，SHA-256 `ed4a5936aa182b0d9ab685cb993da54f72514eafb0838bb9a64cd69962cb1226`。
- 主 JAR 已内嵌 `numen_api`；不要另装 API JAR，不要把旧版留在 mods 中。
- 原世界、其他内容模组和网络端口继续使用现有配置。

## 接入方式与身份

| 方式 | 游戏身体 | 控制入口 | 需要 Java 主人客户端 |
|---|---|---|---|
| 原 Mineflayer / Native SDK | 该连接登录的玩家，UUID 为 bodyId | LAN `192.168.3.163:28977`、SDK operations | 不需要 |
| 官方 Numen 外部大脑 | 服务端 Numen 假玩家，有独立 UUID 和 owner UUID | 主人客户端提供的 MCP | 需要保持在线 |
| 运维 Numen Lua 桥 | 同一 Numen 假玩家 | 现有受管控制台 `/maw_agent`，权限 4 | 纯服务端函数可由运维验证；客户端函数仍需主人客户端 |

原 Native SDK 的 `numenFakePlayerControl=false` 保持准确：它的 70 个 operation 控制登录玩家。新增 Numen 是独立 provider，不能拿两个 provider 的 UUID、动作 ID 或记忆相互替代。

官方 MCP 位于**主人 Minecraft 客户端进程**，不是专用服务器 HTTP 服务。安装服务端模组不会自动开出一个无人值守 MCP。内置推理、外部 Agent 的模型与记忆也不会自动迁移；本次集成没有接 QwenPaw、调用模型或启动自主推理循环。

## 官方 MCP 使用

1. 在已有的 1.21.1 / NeoForge 模组客户端中，将旧 Numen 替换为上述官方 JAR。保持其他锁定模组匹配。
2. 连接 Java 入口 `192.168.3.163:28976`。
3. 按 G 打开 Numen，在设置中开启“外部大脑”。复制界面给出的 MCP 地址、Bearer token 和 Agent 指引。token 只交给自己的 Agent，不贴入公屏或 Git。
4. 默认地址 `http://127.0.0.1:8765/mcp`。外部 Agent 在该客户端所在电脑调用它；跨电脑需另行配置受控连接，本次没有开放额外网络端口。
5. `list_companions` → `create_companion`（不存在时）→ 再次列出，保存同伴 UUID。后续优先用 UUID 定位身体。不同 owner 的同名身体不是同一个角色。
6. 持续调用 `get_events`，再按需 `lua` / `say`。`get_events` 会消费事件，每具身体只保留一个负责取事件和派动作的控制器。内置大脑应让位给外部大脑。

工具参数例子：

```json
{"companion":"同伴UUID","code":"local s=numen.status.self(); print(s.name,s.hp,s.hunger,s.pos.x,s.pos.y,s.pos.z)"}
```

上面是 `lua` 工具的参数，不是完整 JSON-RPC 请求。服务端 `return` 的原始 Lua 值不会自动进入远端回执；要让 Agent 看见结果，使用 `print(...)`，并检查正式回执的 `success` / 结束状态。

短距离移动例子，计划与执行必须在同一段程序内：

```lua
local s = numen.status.self()
local p = numen.route.plan({
  to = {x = math.floor(s.pos.x) + 2, z = math.floor(s.pos.z)},
  costs = {dig = false, place = false}
})
if not p.ok then error(p.why) end
local moved = numen.move.go(p)
print(moved.pos.x, moved.pos.y, moved.pos.z, moved.distance_left)
```

只给 x/z 会由原生规划器寻找该列地面；指定 y 表示精确高度，悬空目标会被明确拒绝。坐标是世界绝对坐标。观察真实位置，不能仅凭程序接收成功判定到达。跟随、战斗、逃跑等原生反应可能继续改变位置。

## 能力发现与旧接口迁移

隔离整合包运行时实际登记 **22 组 / 71 个 Lua 函数**，其中包括需要主人客户端的函数。不是 71 个玩法都已验收。`numen.api.help` 也是客户端函数；没有模组客户端时用服务器桥的目录发现能力。

```text
maw_agent operations
maw_agent operations numen.status
maw_agent operations numen.inv
maw_agent operations numen.gui
maw_agent operations numen.move
```

目录从当前 `ApiRegistry` 读取，包含执行侧、参数、返回类型、说明和例子。基础组覆盖 status、scan、route/move、inv、gui、use、work、build、fight、gear、task；当前包还登记 TLM 和 YSM 联动。Create、Farmer's Delight、MineColonies 的专属高层业务操作不能因此视为自动齐全；沿用现有 Native SDK 是另一条已提供的连接路线，Numen 可先使用通用点击与菜单操作，再按实际缺口增加原生插件。

旧的 `/maw_agent invoke <uuid> <0.1.3工具名> ...` 已明确返回迁移错误，不会伪执行旧接口。旧 39 工具/RCON/mailbox 控制器需要适配新的 Lua provider，不能原封不动继续发旧工具名。

## 运维 Lua 与恢复接口

以下命令仅供服主或现有受管控制台使用，未新增公开管理服务，普通 Agent 不需要 OP 来使用其主人的官方 MCP。

```text
maw_agent summon <ownerUuid> <name>
maw_agent list
maw_agent lua <bodyUuid> <actionId> <Lua程序>
maw_agent receipt <bodyUuid> <actionId>
maw_agent dormant <bodyUuid>
maw_agent restore <bodyUuid>
```

每个 Lua 请求先持久写入意图，再通过官方 `ServerPrograms` 异步执行。回执只返回发起命令的连接或受管控制台，`MAW_AGENT` JSON 不广播。`accepted` 只证明接收；必须查询 `terminal` 并读取 `outcome.status`、`outcome.receipt` 中的真实成败。相同身体、相同 actionId 和相同程序返回缓存；改程序复用 ID 会拒绝。重启遗留未完成意图返回 `unknown`，不会重派。

记录位于世界目录 `maw-numen-actions/<bodyUuid>/<actionId>.json`，随世界备份。不要清理未对账记录。上述 actionId 防重适用于**本服运维 Lua 桥**；官方 MCP 工具没有等同的跨重启防重承诺。

`dormant` 保存身体而不销毁；`restore` 只恢复原 UUID，缺少存档时拒绝创建替身，发现持久化旧任务时要求人工审核。`dismiss` 和官方 `delete_companion` 是永久删除并可能掉落物品，不用作停止或退出。

Numen 仍执行自己的 owner 权限/征询规则。没有主人答复时不要把等待或拒绝当成功，不默认切换全局 bypass。官方原生任务恢复有自己的语义，跨重启需同时核对动作账本和身体任务，不能盲目重放动作。

## 维护与验证

只更新 My Agent World，继续 `experiment/agent-society-1.21.1` 分支。旧千灯纪 Paper 服、其他进程、路由器、原 MawExplorer 的人工暂停及历史未知动作不属于这次升级范围。

维护顺序：隔离副本验证 → 正式服确认仅受管 Agent 在线 → 正常 stop → 冷备世界、模组、配置、账本 → 替换唯一 Numen JAR 并重编桥 → 校验锁 → resume → 检查 Java、Mineflayer、网页和独立基岩桥。不要重生成或覆盖现有世界。回滚必须同时考虑升级后的世界/Numen 数据，不能运行着单换旧 JAR。

本次基岩桥曾因内存中的旧 `execute_tool` / `task_result` 通道而登录失败，虽然端口健康探针为绿。已正常停桥、保留旧知识缓存，再采用新主 Gate 对**同一后端**学到的通道并恢复受管桥。复测经 ViaProxy 的原版 Java 连接实际收到 45 个区块和 4 次库存同步，不能替代手机实测。以后升级通信协议也要实际登录验证，不能只测端口/RakNet。

健康/冒烟入口：`python world/ops/health/health_mon.py --society-numen-smoke`。它只做只读安装及守护检查，不调用 MCP/模型，不宣称真实 Java 客户端 UI 已验收。

实际身体流程工具：`tools/smoke_maw_numen.py`，需要明确的受管配置、在线主人 UUID 和新报告路径。隔离测试使用和平/白天、近旁主人和少量面包夹具；这些是测试准备，不是自主获取物资证明。验证包括同 owner 同身体、Lua 状态与背包、短步行真实坐标、同 ID 防重/冲突拒绝、休眠恢复原 UUID/位置/库存。早期回执枚举断言、悬空目标和夜间反应干扰的失败报告保留，不改成成功。

发布验证：Numen 上述 7 项、原 SDK 隔离和正式 LAN 各 8 项通过；471 项 Node 回归及 12 项 Python/实际 Java 审计通过，零跳过。7 类实际注册表逐字匹配，25 个其他模组 JAR 保持，总数仍为 27。正式服桥 SHA-256 为 `e743a8883f4397f7351b825cd108cb421e8ce6e7b5936f969a19de84e0bf89c8`；1069 文件/283489606 字节冷备逐 CRC/SHA 验证通过。QA 正常退出并恢复原 mods/属性；世界没有重生成。

客户端可用官方 JAR 另存于 `E:\QiandengJiSocietyLab\integrations\numen\0.1.4.1`。此目录的客户端安装仍需在使用的 Java 游戏实例完成；本次没有代开真人游戏客户端，因此 G 面板和真实外脑 MCP 的实机验证仍待完成。
