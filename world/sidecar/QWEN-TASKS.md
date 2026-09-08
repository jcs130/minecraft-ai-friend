# NPC 与公会模型任务

`qwen_tasks.py` 只是 QwenPaw 原生后台任务客户端，不是另一个 Agent 运行时。所有生成工作都由游戏 QwenPaw 角色执行；侧车没有模型名、供应商 URL、供应商密钥或失败后直连模型的路径。

固定路由来自只读 `/etc/qiandeng/model-task-routes.json`：

| 用途 | QwenPaw 角色 | 当前调用策略 |
| --- | --- | --- |
| `npc_dialogue` | `qd-villager-dialogue` | 无人工次数额度，按真实对话需求 |
| `guild_quest` | `qd-guild-planner` | 无人工次数额度，同日请求仍幂等 |
| `maid_dialogue` | 独立绑定角色，模板 `qd-maid-dialogue` | 无人工次数额度，同角色串行 |

当前功能阶段 `dailyLimit:null`、`cooldownSeconds:0`。三个用途按独立角色串行，互不因共享冷却阻塞。提交前持久预留，记录保存在 `/mcdata/village/qwen-tasks`；未知 POST 不会随 24 小时统计窗口过期而释放执行门，也不会自动重发。旧任务没有 active 索引时从持久请求恢复，重叠未决任务需核对。原生任务状态只读轮询，间隔至少 10 秒。相同用途和请求键只接受相同正文摘要。Qwen 并发 1、本地 QPM 0、迭代 gate 关闭；供应商实际限流、超时、身体行动和消息容量检查仍有效。

`NPC_LLM_ENABLED=0` 保持普通村民闲聊为模板。即便另行启用，未取得已完成回答也只用模板；异步回答留在原生任务中，后续相同请求可读取，不让主循环等待推理，也不回退到供应商。每次任务显式附本村民的人设与有界本地回忆，保留原轨迹文件。

`NPC_GUILD_AGENT_ENABLED=1` 独立开启公会策划。策划输入包括全部已绑定且职业匹配的发单人，输出必须是以下候选数据：

```json
{"date":"2026-09-09","quests":[{"villager":"hesu","item":"wheat","count":8,"emerald":2,"pitch":"收八份小麦，酬两颗绿宝石。"}]}
```

物品使用本地白名单，数量为整数 3–24，绿宝石为整数 1–3；一个 NPC 最多一张。额外字段、命令、效果、无绑定人物、超额奖励和日期不符都拒绝。人物名与物品中文名由可信配置补齐。候选不能直接扣物、发奖或改现有合同。

预案保存在 `village/agent-plans/YYYY-MM-DD.json`，含状态、角色、原生任务 ID、UUID/职业绑定与校验后的 `quests` 字典。已有日期的 `quests-YYYY-MM-DD.json` 始终保持原样。新日发布时只读消费当天预案；原始绑定变化会拒绝使用。随后最多异步提交一次次日预案，不等待模型；无可用候选时使用原有审核模板。猎杀、拜访、领取、真实物品交付、功勋与未知结果防重继续走原公会流程。

可提前按需规划明天，不必等跨日，也不能为了测试覆盖今天：

```sh
python /opt/sidecar/npc_planner.py --day 2026-09-09 --submit
python /opt/sidecar/npc_planner.py --day 2026-09-09 --poll
```

`--submit` 要求策划开关已开且对应日的正式任务文件不存在，只允许今天或明天；默认日期为明天。`--poll` 从不创建付费任务。原生失败、取消和超时记录为失败；传输不确定只读原任务，不清空预算。预算不足不会另换角色或模型重试。

策划开关打开时，已有 NPC 进程中的 `guild-planner` 线程每 45 秒收集今天和明天的已有待完成预案。它只轮询已保存原生任务，不提交新请求；没有预案或预案已完成时不访问 QwenPaw。完成文本及时校验并落盘，不等到次日才获取。并发的旧轮询不能把已完成答案或预案改回运行中；异常保留原有资料，不改正式任务、预算或重新生成。

部署需要 `NPC_DATA_DIR=/mcdata`、上述路由只读挂载，以及 `QWENPAW_CONSOLE_TOKEN_FILE=/run/secrets/qwenpaw-console-token`。令牌只用于内部 QwenPaw API，不能输出到页面或加入源码。`MAID_AGENT_ENABLED=1` 启动已有 NPC 进程内的 `maid-agent` 线程，另由 `MAID_AGENT_TOKEN_FILE` 校验女仆文本入口；这轮桥接的是文本生成，不宣称已迁入女仆模组的工具调用。
