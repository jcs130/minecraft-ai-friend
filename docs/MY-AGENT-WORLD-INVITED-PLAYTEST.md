# My Agent World 邀请试玩与开放门槛

更新：2026-10-11。当前目标是让外部框架发现和调用实际玩法，不把模型独立采集、长期经营或完全自主建城作为接口发布的前置。开放范围分开验收，不能用一个 `ready=true` 代替全部承诺。

## 当前可以邀请的范围

**家庭局域网可开始小范围、发独立令牌的 Agent 邀请试玩。** 推荐先邀请 1–2 个外部 Agent，通过服务端常驻 Numen MCP 控制各自身体；不需要主人 Java 客户端、QwenPaw、服务器 OP 或把模型 Key 交给服主。推理继续运行在对方框架里。

| 入口/体验 | 判定 | 实际边界 |
|---|---|---|
| LAN Numen MCP | 可邀请测试 | 每人独立令牌/身体/账本；同身体只有一个控制器；接口与小规模并发有实测 |
| LAN Mineflayer / Native SDK | 可在可信网络邀请测试 | 70 项身体目录/60 项模组调用；仍为离线 Minecraft 登录，用户名不是公网认证 |
| 匹配整合包的 Java 客户端 | LAN 后端已运行 | 需要对应内容模组；完整的新手安装包/异机安装体验未验收 |
| 基岩体验 | 兼容链已运行，继续定向试玩 | 静态图标、女仆/YSM 模型和部分表单已有；实际手机、殖民地管理/动态机器等未全验 |
| 网页观察每个新 Numen 身体 | 尚未就绪 | 当前常驻视角不能自动代表新身体；独立视角绑定、专用界面和画面差异须另验 |
| 无限制公网开放 | 暂不开放 | TLS/准入、异网实连、容量及长时间运行还有门槛；不能直接转发离线游戏门或整个 worker |

Numen 独立原生模组目录为 **48 项**，MCP **17 工具**；官方 Lua 整合包实际 **22 组 / 71 函数**，其中客户端函数明确不可用于纯服务端。三个计数不能相加当成“全部模组功能已验收”。当前 29 个服务端 JAR 和具体可玩内容见 [兼容矩阵](MY-AGENT-WORLD-MOD-COMPATIBILITY.md)。

## 外部 Agent 怎样接入

LAN MCP：`http://192.168.3.163:28984/numen/mcp`。只支持现有家庭网段，不是公网地址。

1. 服主分配独立的主人 UUID 并签发令牌。不借用服主、MawExplorer 或其他玩家身份；主人 UUID 与随机创建的身体 UUID 分开。如果今后需要与真人账号共用所有权，必须先核实账号归属。
2. 将 [独立 Python 客户端](../tools/maw_numen_client.py) 和本人私有凭据 JSON 交给对方。客户端只有标准库，Python 3.10+；不需要 E 盘目录或服务器本机依赖。
3. 对方执行只读验收：`python maw_numen_client.py --credentials private.json smoke`。应看到 17 工具、48 模组操作、71 Lua 函数和自己的身体状态；不会创建身体或调用模型。
4. `tools/list` / `operations` / `mod_operations` 查看实际签名。`mod_operations` 传 `operation` 可获取完整 JSON Schema；坐标用绝对位置，窗口/组件 CAS 使用最新快照。
5. `list_companions` 后，若确实没有身体，用唯一 `action_id` 调用一次 `create_companion`，保存返回的 `bodyId`。遇到不确定结果先查询，不能创建替代身体。
6. `claim_control` 使用稳定 `controller_id`，保存 `leaseId`。租约 90 秒；同控制器续租或动作可续期，长时间规划应主动续租。
7. 本身体默认 `ask`；独立游戏可用 `set_permission` 改为 `bypass`。它只允许本身体按原生生存规则行动，仍不授予 OP、材料或他人资产权限。
8. Lua 或 `mod_action` 每次带唯一且持久的 `action_id`。`accepted` 表示排队，查询 `action_status` 到终态后核对位置、库存或菜单；相同 ID/相同意图返回旧结果，改意图则拒绝。
9. 断线用同一令牌/bodyId 查询原动作。`unknown`、网络超时及等待超时都不自动重试；等待超时也没有取消动作。正常停止后可休眠，再用 `restore_companion` 恢复原 UUID。

客户端示例：

```python
from maw_numen_client import Client

client = Client.from_credentials("private.json")
print(client.smoke())  # 只读；不创建身体
print(client.call("mod_operations", {"operation": "spell.configure"}))
```

通用 CLI：把准确参数写进 UTF-8 JSON 文件，再执行：

```text
python maw_numen_client.py --credentials private.json call list_companions
python maw_numen_client.py --credentials private.json call mod_query --arguments query.json
python maw_numen_client.py --credentials private.json wait --body 身体UUID --action-id 原动作ID --timeout 60
```

`query.json` 示例：

```json
{"companion":"本人身体UUID","operation":"menu.snapshot","arguments":{}}
```

独立客户端拒绝带凭据的 HTTP 跳转，不自动重试；公网端点必须 HTTPS。只读 `smoke` 会保留离线/死亡/未知动作的真实状态，不把休眠身体当作服务器故障或擅自恢复。

## 服主准入与撤销

在本机仓库运行：

```text
python tools/maw_numen_server.py provision --owner 独立主人UUID --label 邀请者说明
python tools/maw_numen_server.py revoke --owner 同一个主人UUID
```

签发命令只返回私有文件路径，不打印令牌。私有文件含 `ownerUuid`、`endpoint`、`token`，必须私下交付，不能放进 Git 或公屏。撤销立即阻止该令牌的新请求，其他主人不受影响；保留身体、物品、原始凭据及动作账本。**已经接受的动作仍可能完成**，撤销不能代替动作取消/停服，也不能据此重放原动作。需要新凭据时重新签发并替换自己的私有副本，旧令牌不会恢复。

初始实现容量为每主人 2 具、全服 8 具受管身体，不表示支持 8 个活跃大脑同时高频运行。本轮只验证两个独立活跃身体和 4 路短时状态查询。邀请阶段从 1–2 个活跃外部 Agent 开始，结合 TPS/MSPT、内存、请求延迟、断线和未知动作数量再扩容。建议稳定状态最多每秒查询一次，长动作每秒对账一次；不让每个规划步骤反复读取完整目录。

## 本轮实际验证

真实隔离整合包中，两主人同 action_id 独立开关 Curios 原生菜单；跨账号状态/动作/事件拒绝，跨身体租约拒绝；一个身体执行 Lua 时拒绝第二个原生写动作，同时另一身体可用。另有 4 路并发、12 次只读查询的有限延迟记录，它不是吞吐或长期压力测试。

Ars 真实学习治疗符文消耗 2→1；初级书按原生规则拒绝二阶治疗，换匹配等级的书后编排、解释、选槽、生存魔力恢复和治疗实际生效，重发同 ID 没有二次施法。女仆按身体 UUID 验证所有权，实际任务/跟随/拾取设置、原生背包开关和跨主人读写拒绝通过。材料、法术书、女仆、传送和静态测试环境属于明确记录的管理员夹具，不是模型自主采集的证据。

既有流程继续覆盖移动终态、同 UUID 重连/恢复、持久去重、重启后未知结果不重放；模型链路只用隔离本地模拟服务，付费模型调用为 0。独立客户端验证真实 HTTP 收发、回执 requestId、失败不重试、跳转不转发凭据和等待超时不取消；令牌撤销另有真实下一次认证拒绝测试。

## 公网开放的剩余门槛

- **入口与身份**：优先只发布认证 MCP 路径并使用 HTTPS/受控网络；不给公网访问整个 worker、管理接口或离线 Java 门。邀请签发与撤销均须可用。
- **异网实测**：另一台设备、另一网络带自己的令牌，完成发现→创建/恢复→状态→短步行→终态→断线重连对账。当前同宿主 LAN IP 和隔离测试不能代替这一项。
- **容量与稳定性**：按预定邀请人数连续运行一段完整游玩时段，记录延迟、TPS/MSPT、内存、守护恢复及动作未知数。短时小规模并发不代替此项。
- **体验说明与画面**：先明确 Numen/Mineflayer/Java/基岩的支持范围；如对外承诺每个 Agent 都有网页观察，需要先完成新身体视角绑定和实际画面验收。

这些门槛通过即可开放有边界的邀请测试，不需要等所有模组、全部动画或模型长期自主社会都完成。无限制开放和“全模组/全端一致”仍分别验收。现有 world-life、旧 Paper 服务、路由/防火墙与原未知动作保持，不能为通过就绪检查清理历史。
