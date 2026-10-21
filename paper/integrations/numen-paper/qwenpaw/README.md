# QwenPaw ↔ Numen

## 2026-10-21 完整修复已上线

服主批准后已完成预告、原维护正常停启和 E/F 完整冷备份 `20261021-151552`。API `fb4e7a86` 与桥接 `31bf3d1f` 已生效，原桐人已恢复原生 QwenPaw 日常。正式39项状态/原生MCP、8项物品字段及两协议6项登录查询通过，旧未知动作仍被拦截，注释变体不派发，重连后工具可用。原物品、职业和其他角色保持。发布与回退见[完整记录](../../../docs/MESSAGE_AUTONOMY_RELEASE_20261021.md)；下方“候选/暂停”段落为此前时点。

## 2026-10-21 常驻权限回执候选（本轮不重启）

完整候选尚未上线。服主选择保留候选、暂不重启；桐人自主执行暂停，Paper和其他玩家继续运行。现役仅有早期桥接调整，完整方案还需安装Numen内核的外部调用取消修复，不能凭早期归乡成功宣称长期自主运行已恢复。固定摘要、测试和当前状态见 `../../../manifests/kirito-autonomy-repair-candidate-20261021.json`。

桥接使用 MCP 原生 `elicitation/create` 回答需要人工确认的请求。当前常驻连接没有人工确认界面，只能明确拒绝并给出下一步，不能替模型授予许可；游戏内原权限规则不变。动作等待上限150秒，覆盖Numen的120秒确认窗口。

可能写入的Lua、发言和命令在派发前记录本角色的动作摘要。超时、中断或明确权限拒绝后，同名工具与同样参数的请求会返回 `thisCallDispatched=false`，不因查询状态、心跳或重连而再次执行。Lua身份忽略注释和词法空白，保留字符串及词边界，实际发送的程序不变；旧回执依本角色日志迁移。长动作明确提示先读 `print(numen.task.status())`，再查具体库存/位置；`/mycli status`不能确认那个动作是否结束。成功回执解除该次记录，正常的后续操作可以继续；基础状态/任务/库存查询可在临时断线后重查。任意Lua按可能写入处理，不能凭代码外观认定只读。记录最多128条，满时要求人工核对，不自动遗忘未知动作。

记录在私有 `journal_dir/action-receipts.json`。服主确需解除某一项时，先暂停该角色及自主日常，核对原生任务、库存和实际执行结果；权限拒绝还须先解决原许可要求，然后只移除已经核对的摘要项，再恢复。不要清空全部记录或由模型自行解除。回退也先暂停，只恢复本角色桥接、入门Skill与提示的前像，保留当前世界、物品、任务、记忆和未知回执，人工核对后才恢复日常。

Numen内核停止外部调用时，现在同时结清等待方并释放执行槽；以前取消了工具口却遗留等待回调，会使重连永久报忙。源码补丁在 `../patches/external-call-halt-receipt.patch`，在原接管补丁后应用。正常停服、完整E/F冷备份后一起安装固定Numen API和桥接候选，再重连原角色验证；QwenPaw主服务及其他角色设置保持。

新增检查用 `python -m unittest -v test_controller.py test_action_receipts.py`；完整兼容检查沿下文 discover 命令。当前99项Python通过、6项既有独立联机跳过；267项agent和952项API JVM通过，真实Paper8项远程大脑检查通过，包括新加的“权限等待中断线→收到中断回执→原身体重连再查询→物品不变”。早期桥接另20项实际连接检查通过，明确仅对应早期版本；最终候选须在获准维护后做正式核验。

0.3.0原生日常和普通索敌视线过滤已正式上线。E/F冷备份后只重启Paper，27项正式核验与6项原登录网关检查通过；原角色物品与职业对账后已恢复实际日常。范围及验证见 [自主日常与索敌修复](../../../docs/QWENPAW_COGNITION.md#2026-10-21-自主日常与普通索敌修复)。

0.2.1已正式启用原生异步子任务、独立复盘会话、只读快照、Scroll跨会话检索和当前PowerContext接口适配；补齐稍后启用角色时的快照工具注册。配置、权限、验证和需要正常重启QwenPaw的原因见 [多会话认知接入](../../../docs/QWENPAW_COGNITION.md)。只重启QwenPaw，Paper不需重启。

原生游戏频道位于 `native_plugin/`，入门Skill在 `skills/qiandengji-start/`。固定QwenPaw2.2.2；接入、限制、隔离验证和回退见 [原生游戏接入](../../../docs/QWENPAW_NATIVE_GAME.md)。常规检查可用该版本的Python执行 `python -m unittest discover -s . -p "test_*.py"`，6项独立联机检查默认跳过。

私有 stdio MCP 适配器，让一个 QwenPaw Agent 独占控制一个已有 Numen 身体。详细接管和发布规则见 [原桐人与外脑](../../../docs/KIRITO_QWENPAW.md)。

启动参数：Python 3.12（已安装 `mcp`、`httpx`）运行 `numen_controller.py <私有配置JSON>`。配置包含 `upstream_url`、`token_file`、`companion_uuid`、`agent_id`、`qwenpaw_url`、`journal_dir`、`auto_wake`。两个服务 URL 必须是本机 HTTP 回环地址；不要把令牌写入配置模板、日志或仓库。

`event_session_id` 可指定稳定的事件会话；正式启用时使用与隔离测试不同的值，避免沿用测试对话。未配置时保留旧默认值，重连不会更换会话或重放动作。

`event_transport` 默认 `console`，保留已部署兼容路径；配置为 `channel` 时不启动旧自动分发，`events` 返回带ID、唤醒标志及连接状态的有界快照，由原生频道持久去重。`auto_wake=false` 与频道配套使用，不影响原生身体连接。两种入口不能同时启用。

原生端开启 MCP 后，由角色配置账号执行 `/numen token create brain <角色名> 30`，保存只覆盖该角色的原生令牌。QwenPaw 建立独立 Agent 和 stdio MCP 驱动，启用本适配器返回的八个工具；不修改其他 Agent 的模型或工具策略。

```text
python -m unittest -v test_controller.py
```

查询游戏命令使用 `command`，如 `{"line":"/mycli status"}`；它复用 `numen.mc.run`、原有授权流程和原始命令结果。`lua` 仍可按原生 API 编排动作。命令和动作超时均须只读核对，不直接重放。

## 信息读取与复用

实时入口见 `../../../docs/KIRITO_SERVER_INFORMATION.md`。先 `command` 查询 `/mycli status`、`/mycli tasks status`，技能按 `skills status/list/info` 读取；核心目录用 `lua` 执行 `print(numen.api.help("numen"))`。不要给所有旧命令盲加 `--json`。

命令只执行一次。新版原生端把原始命令返回值经可选 MCP `structuredContent.commandReceipt` 交回，避免 Lua stdout 的 6000 字限制；适配器用其原始 output 替换缩略显示，保留附带事件。`complete=true` 仅指回执完整，仍须按实际状态判断成功。旧端明确截断、超限或掉线均不自动重放动作。

独立联机检查默认跳过；仅在现有隔离服就绪时设置 `NUMEN_KIRITO_TEST_CONFIG` 为其私有配置路径，再运行 `python -m unittest -v test_information_live.py`。测试硬性要求 `127.0.0.1:25978` 和原桐人 UUID，不调用模型、不接单、不学技能或挪动物品。常规单元测试为 `python -m unittest -v test_controller.py`。
