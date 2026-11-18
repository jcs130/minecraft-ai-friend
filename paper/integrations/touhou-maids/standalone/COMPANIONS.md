# 居民对话、同行与独立记忆

TLM Maid Agents 0.2.0 增加公开居民伙伴。玩家和 NPC 都能邀请其他居民，同一位领队可以有多位同伴。招募、等候、跟随、工作和告别先交给角色当前选择的 LLM 思考；答应后服务端才检查并修改真实身体。菜单按钮发送自然语言，也经过同一条对话路径。

这是官方 NeoForge 1.21.1 + TLM 1.5.3 的独立扩展。独立 JAR 不要与现役千灯纪的 `qiandengji_maid_brain` 同时加载；0.3.0 已提供保留旧脑的合并构建与混合服隔离验证，见 [RESIDENTS.md](RESIDENTS.md)。本轮没有重启或替换正式服。

## 角色与身体

`examples/tlm-companions.example.json` 提供禾穗、绒铃、灯守三份人物设计，按已选的奶油桃、Mili、雷米 Black 外观编写，包含性格、喜恶、工作专长与短气泡。它们是本服务器的原创居民，不宣称模型原作者设定了这些人设。

1. 按 README 登记原女仆 UUID、原主人 UUID、独立模型站点与可选后端。
2. 复制示例到 `config/tlm-companions.json`，用实际 UUID 替换示例值。NPC 先设置好驻地、原生日程与工作所需装备。登记不会生成替身，也不会改变主人、背包、模型和原主人私人对话。
3. 正常启动后，`/maidagent companions` 打开名册。空手右键公开居民也会打开菜单；原主人普通右键仍进入原生界面，潜行空手右键进入公开菜单。

示例允许每位领队同时带 8 位，配置范围 2–64；不强制单人单 NPC。每个 NPC 同时只有一个同行领队。居民可以当领队邀请其他居民，暂不允许嵌套领队和循环队伍。

## 游玩入口

| 操作 | 命令或交互 |
| --- | --- |
| 查看名册 | `/maidagent companions`；Agent 用 `/maidagent companions json` |
| 与角色交谈 | `/maidagent companion <NPC_UUID> say 你好，愿意一起探险吗？` |
| 菜单交流 | 名册选角色，再点“邀请同行”“跟着我”“在这里等我”等。选项会说给 NPC 听，并等待回答。 |
| 查看这次对话及实际身体状态 | `/maidagent companion <NPC_UUID> status json` |
| 快捷话语 | `recruit`、`follow`、`stay`、`work`、`dismiss`，同样进入 LLM 对话；可加 `json` 查询受理回执。 |
| 主动结束自己的同行 | `/maidagent companion <NPC_UUID> leave`。这是玩家退出关系的操作，不依赖模型同意，也不要求仍在 NPC 身边。 |
| 运营测试一个自主社交回合 | 管理员用 `/maidagent social <NPC_UUID>`。NPC 自行选择聊天、邀请或休息。 |

公开交流要求同维度、8 格内、可见、双方存活。NPC 可以按自己的性格答应、婉拒或协商。不同意时不会建立契约。繁忙、离线、超时、状态已改变和无合法装备会返回原因，不猜测成功，不自动重放原对话。

新菜单是原版 54 格容器，所有展示物只是按钮，不能拿走、移入、拖动或复制。Java 不必安装这个扩展的客户端部分，但仍需目标模组服本来的 TLM 等客户端模组。基岩与 Mineflayer 使用既有网关转发容器和实体；本次尚未完成真实基岩手柄的界面验收，不能据此声称整个模组已经跨版适配完毕。

## 对话与动作的回执

首次请求返回 `status:accepted`、`conversationId`、`completed:false` 和 `next_safe_read`。稍后查询 `companion.conversation`，以相同 ID 对账：

- `status:answered` 表示这次回答产生了；`decision` 是角色的选择。
- 需要动作时另有 `receipt`。其中 `accepted` 表示指令已登记，`companion.applied` 表示已应用原生状态；跟随并不等于到达目的地，工作也不等于已经收获。
- 拒绝、模型不可用、状态变更和存储异常分别记录。结果未知时查原回执，不重新说一遍来冒充补偿。
- 玩家只能读取自己最新一轮对话和自己的同行记录。其他玩家看不到私人历史、别人队伍的位置或控制身份。`MC_COMPANION` JSON 只回复查询者；自然对白通过原生文字气泡呈现。

动作由 TLM 原生 AI 执行。护卫保留战斗任务，非战斗居民在跟随时暂停工作；让她“在这里工作”才使用所配任务。仍需要真实工具、目标和材料，不由聊天凭空生成资源。同行不授权伤害玩家、居民、宠物或其他 NPC。

离开游戏时同伴停止跟随并等候，默认宽限 5 分钟；重连会恢复。默认同行 120 分钟，到期或退出后按保存的原驻地返回，实际到达后才标为可再次邀请并恢复原工作。冷重启保留契约和原身体。路径受阻报告 `path_needs_attention`。

0.3.2 候选已验证跨维度随行：同一已同意的领队换维度后，检查已加载的合法落点，实际到达才扣 5 魔力并进入 60 秒冷却。等待冷却/魔力/落点时以 `travel_wait` 间隔检查，结果未知则暂停，不重放。撤约后可以跨维度回原住宅。NPC 领队也可以带 NPC 队员；新的 NPC 间对话仍需附近可见，不能把随行测试称为远程私聊已完成。普通玩家的远程私聊/公屏邀请、战斗房间增援沿用 0.3.1 的同意流程。传送到场不自动取得参赛或领奖资格。实际版本与边界见[逐项验收](../../../docs/NPC_ACCEPTANCE_20261117.md)。

## 每位 NPC 可选不同框架

后端由已有 `tlm-maid-agents.json` 的 `choices` 与原生站点决定。Qwen Code 使用独立配置目录及无工具单轮规划；DSH、Codex 等使用已登记的 HarnessRouter `harness_id`。也可以直接使用原生 OpenAI 兼容站点连接 LiteLLM。每位角色独立选择，不共享一个对话进程。

`examples/harness-mixed.example.json` 展示三位居民分别使用 Qwen Code、DSH、Codex。示例模型名需替换成当前 LiteLLM/Hub 实际可用的在线模型别名，站点路径按 `/v1/<NPC_UUID>/<choice>/chat/completions` 配置。示例不会安装或自动启用 Hub 中尚未配置的运行时。

公开社交没有原生工具：Qwen Code/Hub 只需返回原生对话 JSON，网关原样放入 `content`，不再要求模型把 JSON 编码两遍。身体端严格校验语句、动作和目标，再按关系和现场事实执行。有原生工具的主人链路继续使用 `content/tool_calls` 契约。格式错误没有游戏副作用。换后端、关系变化、离开交流范围后的迟到答案不会继续控制身体。某个后端可配置不等于它在当前机器可用，部署前仍需用对应模型实测。

自主社交由 `socialIntervalSeconds` 控制：`0` 关闭；启用后每隔 60–86400 秒至多给一位附近有同伴的空闲居民一个回合。一次邀请至多引出另一位 NPC 的一轮回应，不递归互相唤醒。寻路、作业、打怪仍由原生 AI 逐 tick 执行，不逐 tick 调 LLM。

## 本地记忆与 PowerContext

每位 NPC 的原始经历写入世界的 `data/tlm-companion-memory/<NPC_UUID>/`，每轮的 request/result 分开、不可覆写。记录包括对方身份、原话、角色回答、选择及实际动作回执。只读取当前交流双方共享的近期经历，不把另一位玩家的谈话塞入上下文。

`companion-memory.mjs` 复用 MC 核心的 `GameMemoryBook`、`GameMemoryService`，将这些原始经历同步到独立笔记与可选 PowerContext。没有另外实现一套记忆数据库或绕开核心的版本/去重规则。

1. 安装已构建的 `agent-mc-world`，或在源码目录安装依赖；`coreRoot` 指向包目录。源码用 `source:true`，构建包用 `false`。
2. 复制 `examples/companion-memory.example.json`，设置绝对路径和固定的世界标识 `realm`。每位 NPC 单独使用已创建的 PowerContext Scope，不复用可米、玩家或另一个 NPC 的 Scope。示例中的三位可以各自选择本地或远端。
3. 将现有 PowerContext 凭据放到进程环境 `MAID_POWERCONTEXT_KEY`，配置中仅填变量名称。工作器不创建、枚举或自动选择 Scope。
4. 启动 `node --experimental-transform-types companion-memory.mjs /path/to/private-memory.json`。使用已构建包时不需要实验参数。`--once` 只同步一轮，默认每 15 秒同步；每位每轮至多导入 20 条，检索最近交谈过的至多 16 位。

本地一直保留原始记忆。换模型或 harness 不更换 NPC UUID、世界标识、记忆目录和 Scope，就继续使用同一份经历。PowerContext 不可用时核心回退到本地，未知写入不自动重放；恢复与纠正按 MC 核心记忆接口的原回执处理。每轮检索输出携带历史标记，不被当成当前身体状态。

0.3.2 中，对话答应与实际动作结果是独立的不可覆写证据。动作证据以 `sourceRequestId` 引用原请求，避免同一对话触发施法/拍照时覆盖或丢失结果。同步器每轮检索至多 16 个已知说话者（包括 NPC 本人），即便没有自言自语，也能读取本人的真实动作回忆。旧证据和未知结果不补写为成功。

同一记忆目录只运行一份工作器。`companion-sync.lock` 表示有写入者，异常退出后先确认原进程已退出，再移除该锁。备份时保留世界中的契约与原始 journal，以及工作器的本地笔记和复制账本；不能只备份模型配置。

本机验收使用已有 PowerContext 1.4.1 与专门的隔离 NPC Scope。没有将测试经历写入正式玩家 Scope。

## 维护和验收

纯回归覆盖多同伴、单体归属、冷读取、过期菜单契约、循环队伍拒绝、原子存储失败、模型输出结构、经历不可覆写、角色/对方隔离、重复同步和 PowerContext 故障降级。原生联机还须验证菜单点击、真实跟随/工作/战斗、双方对话、断线及重启。

本地验证：

```sh
python tests/run_companion_ledger.py --jdk /path/to/jdk21 --gson /path/to/gson.jar
python -m unittest discover -s tests -p 'test_*.py'
node --experimental-transform-types --test tests/companion-memory.test.mjs
```

`tests/RecruitmentProbe.java` 仅供隔离服验收真实身体和菜单，构建器不将它打入发布 JAR。不要安装在正式服。实际联机记录见同目录验收说明。

## 居民关系记忆

靠近桐人或结衣时，面对角色用平常的附近聊天，或在话头自然地叫他的名字，例如
「桐人，今天去哪里探险？」。有启用 Simple Voice Chat 的玩家也可用附近语音。
空手与桐人互动会得到一句问候。正常回复和同行回执会自动积累关系。

玩家和外接 Agent 都可直接交谈。需要查看关系时可用 `/npcsocial Kirito`，查询加
`json` 可从本人的消息中读取 `MC_NPC_SOCIAL`。指定私聊用
`/npcsocial Kirito tell <消息>`，随后可按发给本人的 UUID 查询
`/npcsocial Kirito receipt <请求UUID>`。也可使用居民登记 UUID。
已有女仆伙伴状态 `/maidagent companion <NPC_UUID> status json` 可附带
`socialRelationship`。查询固定为当前认证账号。公开对话只引用明确公开的经历，私聊
可以回忆该对身份的经历。缺少可验证资料时省略关系字段。
普通附近聊天的回复使用原消息的在场受众。语音转写使用原听众范围，
语音经历作为双方可读的记录。空手问候只回复互动发起者。

每位居民对每个玩家或登记居民独立维护一份关系。一天内成功交谈或共同抵达最多
增加 1 点熟悉度。已同意的同行契约下，同一原生抵达凭据可增加 2 点信任度，每份
契约只计首次、每天最多 2 点。按 UTC 自然日结算。等级、生命、装备和技能由原玩法
结算。当前共享抵达来源为 TLM 同行契约的真实到场记录。托管 Numen 角色的聊天与
原地或普通移动依各自回执记录，后者不产生抵达证明。

运行时配置在原统一 NPC 服务的 `npc.json` 设置 `relationshipDataPath` 为世界
`data` 目录的绝对路径，再为试点角色设置 `social_memory: true`。在原身体完成
正式交接时，才在同一 `character_id` 登记 `social_previous_bodies`。
在现有 `npc-voices.json` 的对应角色下可用 `aliases` 登记「桐人」等常用称呼。
投影原子写入 `world/data/tlm-companion-memory/<bodyId>/relationship-*.json`；
原则上约 10 秒更新。对话交付回执和同行原回执可单独回放，不依赖
PowerContext 或 Graphiti。取消角色试点时保留数据目录配置并将其 `social_memory`
设为 `false`，原始日志可用于恢复。私聊若中断，查原请求状态。

统一 NPC 服务可在 `npc.json` 增加 `dialogueMemory`，提供 `node`、`script`
（`companion-memory.mjs`）、`config`（已有 NPC 笔记配置）和 `tokenFile` 的绝对路径。
笔记配置必须与该服务使用同一个世界和原始对话目录。每个已登记的角色使用自己的
PowerContext Scope。提取当前话题的中英文关键词并查找该角色和对方最近 256 条已验证
经历，同时在配置了专属 Scope 时使用 PowerContext 的全文与向量混合查询。
只接受与本地版本和原始交付记录一致的来源，最多给本轮模型 3 条经历。
服务不可用、未配置独立 Scope 或超时时继续使用本地关键词和近期记录。
查询只读，原笔记同步任务仍负责入库。健康文件每角色的 `dialogueMemory` 记录
最近一次检索方式，分别是 `hybrid`、`local` 和 `local_fallback`。

统一 NPC 服务也复用本机 Graphiti。已核实的交谈及同行经历会异步加入图谱。
按世界、居民、交谈对象和可见范围分别保存，公开回复只查公开经历。
检索用图谱关联找到原始回执，与本地关键词和已配置的 PowerContext 共同排序。
模型继续读取最多三条原始经历摘要。Graphiti 超时或没有合适的来源时，其他检索照常工作。
恢复或升级服务时保留 `social-graph-outbox.sqlite3` 和原始世界回执。
