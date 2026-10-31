# SAO 原生玩法：按需发现与执行

适用本目录的现役 MC 1.20.1 / Forge SAO，千灯纪主服保持独立。目标是让 Agent 知道去哪里查询，而不是把 934 个任务、全部职业技能和攻略预先注入上下文。真实模组物品、配方和菜单条件见 [NATIVE_DATA.md](NATIVE_DATA.md)。

## 查询顺序

自研 core 扩展只增加一个 `mc_sao` 入口，提供准确的操作名短列表。任务条件、物品、技能描述和本人的进度只在请求时读取。工具的 schema、参数校验和单项帮助共同使用 [sao-operations.json](sao-operations.json)，由 [build_sao_contract.py](build_sao_contract.py) 生成。

```json
{"operation":"help"}
{"operation":"help","arguments":{"operation":"sao.quest.show"}}
{"operation":"sao.quests.list","arguments":{"filter":"available","limit":8}}
{"operation":"sao.quest.show","arguments":{"quest_id":"<列表返回的16位ID>"}}
```

默认任务页 8 项、最多 12 项；返回 `returnedCount / remainingCount / nextOffset / complete`。可以按可见标题 `query` 搜索，或按已返回的 `chapter_id` 限定章节。天赋也分页，默认 8 项、最多 12 项。每次读取有本人的 UUID、世界标识、服务端启动代次及 `observedAt`；续页是新观测，不代表同一时刻的快照。接口不自动读取后续页。工具展示层把已观察的任务/职业 ID 组成可直接调用的 `read` 链接；详情里的 `availableActions` 也是待 Agent 选择的入口，不会自动执行。链接属于 SDK 派生的调用参数，不改变服务端事实或观测时间。

`sao.status` 读取本人的 SAO 等级、职业、真实法力/体力、当前技能槽、剩余冷却、天赋点和独立属性点。`sao.professions` 不带参数只返回运行时可选职业；指定返回的 `profession_id` 才读取这个职业的技能及被动。职业表由实际安装的扩展决定，不能写死为基础模组的数量。

技能目录的 `baseCost / baseCooldownMs / baseDurationMs` 是原生声明值。其他已装模组会调整实际耗费和冷却；以施法回执的前后状态、以及新的 `sao.status` 为准。冷却毫秒按服务端剩余 tick × 50 表示。未装备槽位 `equipped=false`，不能把它当作已学技能。没有法力池的职业可以真实返回 `0/0`，体力另有字段。

## 任务、职业与动作

FTB 任务通常在满足前置后自动可做，没有人工制造的“已接任务”。进度属于玩家自己的 FTB 队伍，奖励领取仍按原生玩家/队伍规则；界面隐藏和顺序任务规则保留。一个任务详情提供前置、真实进度、任务/奖励 ID、提交方式及原生定义 SNBT；定义截断有完整性标记。

| 操作 | 原生行为 |
| --- | --- |
| `sao.task.submit` | 触发实际的确认、经验或消耗物品提交；自动、脚本、观察或专属任务屏幕条件不强行完成 |
| `sao.reward.claim` | 对已完成任务领取一个真实奖励，复用 FTB 的领取账本和脚本钩子；物品容量不足先拒绝 |
| `sao.quest.track` | 追踪一个可见任务，不等于完成它 |
| `sao.profession.choose` | 使用原 GUI 服务端入口，照常消耗卷轴并保留战斗/切换冷却 |
| `sao.loadout.bind / sao.skill.cast` | 绑定/释放实际技能槽；保留等级、武器、目标、资源和冷却要求 |
| `sao.talent.* / sao.attribute.*` | 使用各自原生加点/退款 API，不发免费点数，不混淆两个点数系统 |

普通 Mineflayer 玩家不需要 OP。变更通过现有 core 的 `mc_do` 队列发送一个 `/saoagent do` 命令，再由服务端操作当前连接身体；没有新增动作循环、RCON 或超级管理权限。核心受理回执和原生实际结果分别保留。开始施法不等于命中/击杀，任务有进度不等于整个任务完成。

所有原生回执只通过该玩家连接的 `maw_agent:sao_state` 单播，不发送聊天副本。只读请求走 `maw_agent:sao_query`，原始 UTF-8 JSON，查询上限 4 KiB、回复上限 16 KiB；超出回复预算明确标记部分/信息不可用。保护查询和 Forge 自动合成拒绝规则保持。

### 工具展示层（autonomy 0.2.129）

`mc_sao` 的只读 ToolOutcome 把完整原生回执放在 `data.response`，`text` 只保留操作、状态和原因，避免同一 JSON 再次转义复制。写操作仍分别保留原队列的 `execution` 和 `data.serverReceipt`；排队受理、原生操作完成、玩家目标完成分别表达。提交后的未知状态同时写入结构化 `data.status=unknown`，原宿主门禁继续阻止重放。

任务页提供准确的 `read`、`queryOptions.unclaimed`、`queryOptions.available` 和必要的 `next` 调用链接；续页保留原筛选、章节和搜索条件。无效任务 ID 保留 `quest_not_found`，并给出安全的任务列表查询入口，不替玩家挑选任务。所有链接都由模型自行决定是否调用，不自动遍历全部任务。

`sao.status` 仅为本人已经装备且解锁的槽位提供 `castRequest` 和单项 `castHelp`，带真实的 `kind/slot` 参数。冷却读数保留，`requestIsNotAvailabilityGuarantee=true` 明确链接不是可施放保证；资源、目标、原生风格等门禁仍在执行时检查。没有自动绑定、施法或消耗。

后续施法修复加入 `weaponStyle/mainHandItem` 和每槽的已知前提 `available/blockedReason`。已明确不可用的槽位不提供 `castRequest`；职业名称来自原生数据，普通木剑不支持剑技的事实不会被“已解锁”覆盖。实际冷却按武器风格和技能读取，发动证据与命中分开。详见 [FAILURE_REPAIR.md](FAILURE_REPAIR.md)。

这些是工具展示层的兼容改动，原始插件消息、SDK `read()`、服务端回执格式和动作 ID 未改。旧的文本回执证据仍可由 `record_gameplay_acceptance.py` 读取；直接消费当前 ToolOutcome 的程序应读 `data.response`，不能继续对简短 `text` 做 JSON 解码。

## 重连对账

写操作使用调用 ID 派生或调用者指定的 `request_id`。服务端按本人 UUID 持久化请求和参数指纹，相同请求返回历史结果，换参数复用 ID 明确拒绝；中断的不确定结果保持 `unknown`。不要换编号重放未知操作。

```json
{"operation":"sao.action_status","arguments":{"action_request_id":"<原请求ID>"}}
```

`sao.action_status` 的外层成功只说明“查询成功”；实际动作结果在 `data`，查不到记录是未知，不是未执行。历史结果保留原观测时间，不能当成新鲜的库存/冷却；另查当前状态。

## 直接 SDK 与 Numen

普通连接可以附加 `attachSaoGameplay(bot)`（[sao-client.cjs](sao-client.cjs)）。`read(operation,args)` 只读；`prepare` 仅准备命令和回执等待器，不会自行发动作。接入运行时应像 [sao-tools.cjs](sao-tools.cjs) 一样复用自己的唯一动作队列。

Numen 身体通过现有 Owner Token、控制租约及 `mod_operations / mod_query / mod_action / action_status` 使用同一服务端实现。`mod_operations` 带具体操作名获取一项契约；不带名称只取短索引。不会建立额外身体或跳过 Numen 授权/单控制器限制。

## 验收与限制

`gameplay_probe.cjs` 是显式逐行驱动的非 OP 验收客户端，完整证据保存在实验目录的 `acceptance/gameplay-*.jsonl`。单元检查覆盖单页查询、本人回执、格式错误、取消/停机、同一核心队列及提交后的未知结果；正式联机证据见本目录的 gameplay 验收记录。

本接口先覆盖 FTB 任务、职业、技能、天赋和属性。特殊观察任务、选择型奖励、其他模组专属界面以及 Forge 自动配方仍有明确边界；不宣称已完成全部剧情、所有模组玩法、真人 GUI、Web 或基岩渲染。现役服未因这项实验更换组件。
