# 独立核心的线上模型实跑

2026-10-13：按用户“实际跑起来试试”的要求，在正在运行的 My Agent World 正式世界创建普通玩家 **KiritoCore**。身体为 Mineflayer 1.21.1，环境来自 `integrations/agent-mc-world/v4-20261013`，模型为线上 CodingPlan **qwen3.7-plus**。宿主是本次新增的有限试玩程序 `world/src/agent-mc-runner/trial.mjs`，使用独立核心的真实回合、工具与动作回执；不是 Numen AgentLoop，也没有启动 Neko 或 QwenPaw Agent。

## 实际结果

脱敏数据见 [core-live-trial-20261013.json](evidence/core-live-trial-20261013.json)。累计48次模型请求均有正常返回，最后按预算停下，主管和最后一次子进程正常退出。角色的背包、社会状态、对话、模型请求和原生动作账本保留在私有 `E:\QiandengJiSocietyLab\agents\kirito-core-trial`。

- 初始坐标 `(-439.5, 66, 410.5)`，最终 `(-439.5, 65, 410.5)`；没有验证水平寻路或远距离探索。
- 模型先查询保护、方块和物品，再尝试挖掘；几次预条件不匹配明确失败后，实际挖掉脚下草方块，取得 **1个泥土**。原生终态为 `native_block_removed`，实际库存增量与位置相符。
- `society.join` 返回成功，最终 `joined=true`，等级为“木牌见习”。余额40、声望0；不把余额称为本轮交易所得。
- 查询了公会与生活委托，并尝试 `society.submit`；参数被拒，**没有完成委托**。没有制作、种田、机械、魔法、殖民地建设或地下城的完整流程验收。
- 这轮没有正常的模型目标完成声明，不能因角色退出码为0就判断整个生活目标成功。实际停止原因由48/48请求、无在途请求、退出记录和运维复核确认为预算停止。

前两段分别在第22、27次请求后遇到只读查询参数错误而结束。原结果与日志分别保存在 `runs/first-input-validation-failure` 和 `runs/second-input-validation-failure`；后续沿用同账号、同UUID、原账本与累计请求计数，没有删记录、换身体或重放未知动作。

## 实跑补齐

只读查询的 `MOD_CALL_ARGUMENT_INVALID` / `MOD_CALL_ARGUMENT_UNSUPPORTED` 现在返回字段、缺参和 `mc_help` 指引，供模型修正。变更操作、网络未知、损坏账本仍结束试玩，不转成“可重试”的普通输入错误。两项回归测试覆盖这条边界。

宿主在进入模型前读取实际操作索引，按需查完整签名，减少模型为了发现基础动作而反复翻页。完整的大结果保留为带SHA的私有制品，可按字段读取；对话持久保存，恢复时保留此前工具结果。当前状态包含选中快捷栏，避免让模型猜持有物品；停止状态使用明确的 `stopReason`，不把最后一条行动意图当作停止原因。

这些是调用与宿主能力补齐，不代表模型已熟练使用全部接口。本次大量请求用于学习签名、读取手册和修正CAS条件，行动效率仍低；还需要把常用采集、制作、交付流程整理为可复用的高层游戏技能，并验证委托闭环、连续生活目标、应急反射和长期记忆。

## 启动和健康

```powershell
python tools/start_agent_mc_trial.py --config <绝对私有配置.json> --credential-file <现有CodingPlan提供器.json>
python tools/maw_agent_mc_trial_health.py --state-directory <角色的绝对状态目录>
```

启动器复用已有有限进程主管、私有密钥读取器和模型请求账本；只在进程内解密现有Key，不调用QwenPaw HTTP或修改提供器。Node 22；模型固定为qwen3.7-plus，没有本地模型、备用供应商或自动重试。

私有配置除 `stateDirectory`、`username`、`node`、`nodePath`、`runnerFile`、`durationSeconds`、`maxModelCalls` 外，还需 `worldPackageFile` 指向已安装宿主入口，`worldConfigFile` 指向[原生SDK连接配置](MY-AGENT-WORLD-AGENT-MC-WORLD.txt)，`objective` 给出目标。凭据不进入配置模板、命令行参数值、源码或公开报告。

试玩不自动永久常驻，不重置累计模型计数。续跑需要由上层调度对账并设置新的累计上限，仍使用同一个状态目录、原生账本和身体。角色离线不等于进度丢失；不要复制新目录绕过未知动作或模型请求。

`status.json` 每5秒更新，`stop.requested` 请求正常停止。主管只管理自己启动的子进程，心跳失效或超过时限才收口；未知请求保留供对账。手动健康检查10项通过，包括角色绑定、请求预算、生命周期，以及原服务与MawExplorer的保留检查；它本身不调用模型或执行游戏动作。

此次未新增端口、网页、OP或防火墙规则，未重启正式游戏服、基岩桥或现役Agent。现有28984仍是MawExplorer的画面，不能把它当作KiritoCore的第一人称；本次没有新增视觉验收。原角色保持暂停第464轮、旧账本前缀不变，两生产owner保持健康。
