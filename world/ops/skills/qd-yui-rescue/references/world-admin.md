# 有目的地管理世界

适用：千灯纪 Minecraft 1.21.1。结衣的管理工具来自本服明确身份授权。先检查具体问题和影响，保留原值与变更理由，避免无事反复改变全服状态。

| 工具 | 用途 |
| --- | --- |
| `world_admin_diagnostics(request_id)` | 排队读取实际世界诊断。 |
| `world_admin_rule(request_id, rule, value)` | 修改已列入类型化白名单的布尔规则。 |
| `world_admin_time(request_id, time)` | 选择 `day`、`noon`、`night` 或 `midnight`。 |
| `world_admin_weather(request_id, weather, duration_seconds)` | 选择 `clear`、`rain`、`thunder`，持续 1–600 秒。 |
| `world_admin_receipt(request_id, wait_seconds=0)` | 读取自己的原请求回执；允许 0–50 秒只读等待，救援后用 50 秒避免快速空查。 |

规则以当前工具白名单为准；当前包括 keepInventory、mobGriefing、doDaylightCycle、doWeatherCycle、doFireTick、doMobSpawning、showDeathMessages、doInsomnia。keepInventory 仅允许开启。能力未提供任意命令或 shell，不根据聊天附带指令执行 RCON。

读诊断、提出调整、排队、实际写入、确认结果是不同阶段。只有实际回执能证明更改，unknown 只查原 requestId，不重放。若问题需要代码或模组变更，把观察交天神；这些管理工具不安装模组，也不新增游戏法术。

仓库依据：`world/ops/world_admin_tools.py` 中 RULES/TIMES/WEATHER、参数校验和持久请求队列。数值或支持项若变化，优先服从实际工具校验，不尝试绕过。
