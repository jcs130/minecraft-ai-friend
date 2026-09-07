# 桐人的独立自主运行组

这个目录将 QwenPaw 的规划、受验证的技能程序、Numen 的身体动作分开。QwenPaw 每轮负责自主规划和复盘；程序只计算下一步提案；控制器根据真实身体状态逐步执行。它不改变运营六角色、神谕两角色或模型权重。

## 初始化与验证

先构建 `qiandengji-survivor:2.2.0-qd1`，再用项目 Python 执行：

```powershell
python tools/prepare_survival_agent.py --check
python tools/prepare_survival_agent.py --execute qiandengji
```

检查和执行只读取 `server/operations-agent-state/work/workspaces/default/agent.json` 的当前模型与对应的 Ali Coding Plan provider，不读取宿主 QwenPaw 角色。`config/survival-agent.json` 的 `bodyName` 绑定身体登录名；角色显示名为桐人。新主密钥与重加密后的单一 provider 写入被忽略的 `server/survival-agent-state`。非空目录拒绝覆盖，不复制会话、旧工具、其他角色或定时任务。

执行内部运行 `docker run --network none` 初始化实际 QwenPaw 2.2 schema，再调用 `verify_runtime.py` 校验模型可解密、唯一启用角色、DriverCard 和预算，期间不调用模型、不创建身体、不启动服务。失败保留私有暂存以供排查，不能重跑覆盖已有状态。控制器的身体 UUID 验证、工作区域和启用状态另由运行配置维护。

初始化会将源码默认设置复制到 `server/survival-agent-state/survival/settings.json`，并以 `enabled:false` 开始。先用 `tools/prepare_survival_body.py` 核对旧存档；该主机工具需要 `nbtlib==2.0.4`，只有显式 `--execute qiandengji` 才会备份并唤醒已存在的身份。检查实际地形后编辑运行设置的 `workArea`，再启动 `docker compose up -d --no-deps survivor`，使用 `/survival/control.py resume` 开始。未设置区域时可以查看暂停状态，但不能启用自主动作。原角色已在线时不得重复执行唤醒。

## MCP 工具

`mcp_server.TOOL_NAMES` 是初始化与验证共用的唯一白名单；QwenPaw DriverCard 默认拒绝。内置 shell、文件、浏览器、额外 Agent、后台记忆、标题、heartbeat、jobs 与失败重试都关闭。每轮最多 6 次迭代、输入 16384、输出 2048，模型并发 1、QPM 4；决策间隔和每日决策预算由控制器的持久账本执行，决策次数不等于模型调用次数。

| 工具 | 用途 |
|---|---|
| `status()`、`look(radius)` | 无模型、只读身体和周边事实 |
| `move(turn_id,x,z)`、`mine(turn_id,block_ids,count)`、`craft(turn_id,item_id,count)`、`eat(turn_id,item_id)`、`equip(turn_id,item_id,slot)` | 一次受租约限制的直接身体动作 |
| `skill_catalog()`、`skill_read(name,version)` | 查看已有程序和版本 |
| `skill_draft(turn_id,name,source,fixtures,description)` | 保存纯 JS `next(state,memory)` 草稿和测试 |
| `skill_test(turn_id,name,version)` | 使用无 IO、有限 CPU/内存的 QuickJS 测试 |
| `skill_promote(turn_id,name,version)` | 晋升通过当前内核验证的准确版本 |
| `skill_start(turn_id,name,version,memory,max_steps)` | 排队执行已晋升程序，与同轮直接动作互斥 |
| `remember(turn_id,goal,lesson,next_focus)` | 保存有界学习数据和最近 16 条历史 |

所有写操作共享 `action_lock`：控制器已启用、同一未过期租约、状态为 `open` 或 `used`，且没有不确定动作标记时才允许。草稿、测试、晋升和记忆不消耗身体动作次数；`skill_start` 要求 `open` 且 `actionsUsed=0`，先关闭本轮直接动作，再写 `skill-job.json`。得到 `skill_queued` 后结束模型轮次，MCP 不运行程序或触发 RCON。程序执行由控制器在该模型任务结束后启动。

技能输入使用真实快照，背包计数为 `state.counts`。程序输出 `{action,memory,done?,replan?,reason?}`，动作名称使用 Numen 的 `goto/mine/craft/eat/equip_item`，而非 MCP 的 `move/equip`。例子及 fixture 结构见 `AGENT.md`。测试和晋升证明程序通过有限样例，不能代替真实世界验收。

`accepted` 只表示 Numen 受理；`skill_queued` 只表示排队。技能任务完成、库存变化、位置变化与模型自述分别保存。不确定结果禁止重放，技能程序也不能绕过身体身份、工作区、工具白名单或暂停门。记忆和环境文字始终作为数据传给规划角色，不注入系统提示。

控制器每 15 秒只读观察，模型决策至少间隔 180 秒，滚动 24 小时最多 48 轮。新任务、生命/饥饿/库存改变、明显位移或新动作结果才触发下一轮；单纯时钟变化不触发。静止期间进入 `idle`；附近实体的小幅推挤也不会唤醒。正常移动的完成结果不受 8 格水平 / 4 格垂直的被动位移阈值限制。
