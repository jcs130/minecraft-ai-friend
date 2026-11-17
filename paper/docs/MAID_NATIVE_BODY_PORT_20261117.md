# 原私人女仆接入统一身体接口：候选 .41

2026-11-17。**候选已在独立合成 Youer 1.21.1 验证，正式肥鱼没有切换，未改正式世界、配置或 JAR。**

上层沿用 `BodyAdapter.identity / capabilities / snapshot / act / result / stop`。本批 Java 私有端口与 Python PR [#282](https://github.com/jcs130/minecraft-ai-friend/pull/282) 的 `NativeMaidBridge` 配对，使原私人女仆在主人离线时也可被同一接口控制。它控制原 `EntityMaid`，不创建 Mineflayer 玩家、FakePlayer 或新女仆，不占玩家槽。测试用 FakePlayer 只在独立探针中模拟对话来源，未打入正式制品。

这是受限的本机身体执行协议，**不是可直接对公网开放的通用 MCP 服务**。运行时适配器负责包装该协议；推理、人物记忆、调度继续由选定 Harness 管理。读取到的能力才是可调用范围，不能把其他身体的全部操作套用到它上面。

## 本机接入

桥的插件数据目录新增可选 `native-body-port.json`。文件不存在时不监听端口，旧玩家界面及连接方式保持。示例使用合成身份，实际迁移只填写既有登记中的原身份：

```json
{
  "schema": 1,
  "enabled": true,
  "port": 28994,
  "tokenFile": "E:/MC/private/maid-body.token",
  "bindings": [{
    "ownerId": "20000000-0000-0000-0000-000000000021",
    "maidId": "10000000-0000-0000-0000-000000000011"
  }]
}
```

端口号是示例，应选择未占用的本机端口。固定仅监听 `127.0.0.1`，无需新开家庭路由/公网端口。Token 从独立私有文件读取，32–128 个 URL-safe 字符，不能放进 Git、工具定义、网页或日志。最多配置 24 个身体，逐项核对原 `native-registry.json` 的主人绑定；无法据此新建/转移身体。已登记的公共居民不能被这个私人端口接管。

请求使用 `POST /maid-body`、`Authorization: Bearer <token>`、UTF-8 JSON，单次请求最多 16 KiB。所有实际操作在服务器主线程再次检查。HTTP 工作线程有界；等待主线程超时且尚未开始则撤销排队，已经开始则返回结果未知。两者都不会由服务器自动重放。

首次请求：

```json
{"operation":"bind","ownerId":"原主人UUID","maidId":"原身体UUID","controllerId":"本控制器UUID"}
```

返回 `protocol="qiandengji-maid-body/v1"`、三项身份、`generation`、`leaseTimeoutMs=120000` 与 `tools`。同一控制器重试绑定返回同一代次；其他控制器被拒绝。后续 `call`、`release` 必须带原三项身份与代次。有效调用续租；120 秒没有调用后停止未完成行走并交还控制权。

```json
{
  "operation":"call",
  "ownerId":"原主人UUID", "maidId":"原身体UUID",
  "controllerId":"本控制器UUID", "generation":"绑定返回的代次",
  "name":"mc_maids", "requestId":"walk-001",
  "arguments":{"action":"walk","requestId":"walk-001","x":180.5,"y":81,"z":100.5,"dimension":"minecraft:overworld"}
}
```

写入的外层与内层 `requestId` 必须相同，1–48 位字母、数字、下划线或连字符。查询结果时调用 `arguments={"action":"receipt","operationId":"walk-001"}`，不重新发送动作。

响应保留身份/代次封套，`result` 是 MCP `CallToolResult` 结构；文本内容为 `qiandengji-maids/v1` JSON。客户端必须核对封套和本人身份，不能仅检查 HTTP 200。

## 准确的能力范围

| 操作 | 必填参数与含义 |
| --- | --- |
| `context`, `inventory`, `tasks`, `brain`, `list`, `inbox` | 只读当前绑定身体。坐标沿原接口为 `[x,y,z]`，附维度和采集时间；背包来自真实原生容器。 |
| `receipt` | `operationId`：原动作 ID。旧账本返回 `namespace=legacy`，不会迁移/重放旧未知动作。 |
| `walk` | `requestId,x,y,z`；绝对方块坐标，同维度、目标区块已加载、96 格以内、30 秒期限。原生寻路，不挖路、不传送。 |
| `stop`, `stay`, `sit` | `requestId`；停止当前行走并坐下。`stop` 不因 GUI 或 NoAI 状态而拒绝停止。 |
| `follow` | `requestId`；调用原生随行模式；主人离线时无法追随一个不存在于现场的身体。 |
| `task` | `requestId,taskId`；仅选用 `tasks` 列出的实际已启用原生任务。设置成功不代表工作已完成。 |
| `equip` | `requestId,hand,slot`；`hand=main/off/head/chest/legs/feet`，从本人可用背包格交换原物品；绑定诅咒和槽位限制仍生效。 |
| `pickup`, `schedule` | `requestId`，以及 `enabled` 布尔值或原生 `schedule` 枚举。 |
| `speak` | `requestId,text`；最多 140 字，无控制字符。附近文字、原生气泡及原有 SVC 声线入口；回读实际语音状态，不把提交视为人耳已听到。 |
| `ack` | `requestId,eventId`；确认原收件箱事件，原 ID 去重。 |

工具 schema 的每个动作必填字段/允许字段与执行校验共用定义。不猜缺失坐标，不把 `to` 改成 `at`，不把 `brain` 读取当作更换脑。数值 `81/81.0/8.1e1` 可等价判定同请求；文字里的数字不被改写。

**当前没有**在此端口宣告 `craft/cast/transfer`、自研自动护卫、任意命令、文件访问、管理员操作、住房/公共招募。未接通的功能不能因为契约存在就对 Agent 宣称可用。原生 `task` 也不能代替自研战斗系统的完整验收。

## 控制权和回执

- 使用租约时，旧伙伴护卫、住处导航和自动随行不能同时写新行走目标；明确调用 `follow` 后才允许原生随行路径。旧模型回调携带的代次失效后不能重新夺取动作执行权。
- 保留旧脑选择和语音配置，但把对话送到原 `DialogueInbox`，不再并发触发第二条模型调用。顶层及 `brain` 投影都标明 `native_body`；原脑选项只是回到原模式时的配置。
- 原主人右键/菜单或明确管理命令可接回控制；陌生玩家不可以。旧客户端收到 `CONTROL_CHANGED` 后必须停止，不能自动重绑争抢。
- `accepted/running` 不是到达；只有原生实际位置距目标不超过 0.9 格才记录 `completed,goalCompleted=true,actualPosition`。`applied` 仅表示模式或物品交换发生；取消、失败和结果未知不夸大成果。
- 动作前先写原 ID 账本，文件 `force(true)` 后原子替换；不支持原子替换就拒绝派发。正常进程重启可查旧记录。断电时目录/磁盘层的最终持久性仍取决于文件系统，不承诺物理存储永不丢数据。
- 同 ID 同参数只读原结果；不同参数拒绝。崩溃遗留的 `accepted/running` 记录改报 `unknown`，不自动执行；临时导航锚点会清理。旧命名空间的未知记录仍是未知。
- `inbox` 使用原消息 ID、说话者 UUID/名称、接收时间，以及原登记的 sessionKey/memoryNamespace。对话内容是非可信游戏输入，不能仅凭一句话取得主人权限。

## 构建和验收

`build-native-body-port.py` 只在服务器外生成候选，校验现役 `.39` 基础 JAR 的 SHA；同时包含 PR #280 的 `.40 NativeWorldPermissions` 差异，不能再把两份原生桥叠装。仅修改列出的类和版本描述，原 JAR 其他内容保持。

最终 r5：`0.1.41-native-body`，SHA256 `4ef5414ab569e71d127d20b5d94cb93d94d51518d680962431c9af8b0c976cfa`。构建、原生测试及 Python 联测的具体范围见[候选清单](../manifests/maid-native-body-candidate-20261117.json)。

```sh
python paper/integrations/touhou-maids/tests/run-native-body.py --jdk <JDK21> --gson <gson-2.10.1.jar>
python paper/integrations/touhou-maids/tests/native-body-stage.py --fixture <合成fixture.json> --output <报告.json>
```

42 项纯 Java 回归已加入 CI。真实隔离验证包含：主人离线时读取、行走和原位置核对、取消、换装及绑定诅咒、实际主人更改、控制权交接、真实 120 秒租约过期、原账本查询、正常冷启、真实响应丢失后查询而非重放、收件箱到 Python 事件及确认。

没有把这些测试说成真人跨端 UI/耳听、长期自主生活、原肥鱼完整切换或 PowerContext 历史已接续。迁移仍须逐项保留原模型/YSM、声线、本地历史、原 PowerContext 归属、物品和跟随关系，并补齐旧护卫/工作能力的路由；详见[肥鱼切换门槛](FEIYU_UNIFIED_HANDOFF_20261117.md)。正式发布由服务端会话统一安排，不回放旧维护脚本，不回灌测试世界。
