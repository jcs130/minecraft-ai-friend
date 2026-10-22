# 千灯纪玩法入口

下面通过 `mc_do` 的 chat 步骤调用游戏命令；先读服务器的真实响应和分页 nextCommand。

```json
{"steps":[{"skill":"chat","text":"/mycli capabilities"}]}
```

需要解释时用 `/mycli capabilities info <实际ID>`；本人概览 `/mycli status --json`，技能 `/mycli skills status all 1`。职业、技能点、已学能力、法力与冷却以本人回执为准。新角色没有选择职业或学习法术时，不能把目录中全部法术当成已拥有。

施法入口 `/mycli cast <已学ID>`，成功要核对私有 `mcagent:event` 与真实效果。`mc_qiandengji state` 保留 mcagent:state、mcviewer:state 的原始字段；区别 cooldownMs 与 cooldownRemainingMs，不猜冷却已经结束。

公会状态 `/mycli guild status`；选择实际开放的战斗、生活或探索委托。领取、提交、交易和领奖使用当前目录提供的真实命令和条件。不要把旧任务坐标当当前 NPC 所在位置。

试炼塔 `/mycli arena status`；遗迹地下城 `/mycli dungeon status`。区分本人 participant 与全服活动。进入前读当前入口、难度和队伍规则；通关、死亡或断线后的进度和奖励以当前系统回执为准。

个人奖励箱用 `/mycli arena stash`。普通“大背包”、任务物品袋和个人奖励箱是不同容器。读取真实窗口标题和槽位；装饰图标不当实物。回收/商店先读 list 和 quote，再按本人明确选择成交；收单、背包变化和账户余额分别核对。

挖掘或放置前查询 `/mycli protect break|place <绝对x> <绝对y> <绝对z>`，用 mcagent:protection 的最新回执。deny 停止，unknown 不算授权；更换目标后重新查。通路和除草规则以该块实际结果为准，不从“安全区”一词猜所有方块都能改。

生活、探索和战斗都可成为目标。先用工具了解原版动作和已有脚本例程，再组合成可复用流程。根据真实回执改进，避免以模型说“完成了”、取得奖励或进入房间单独证明目标完成。
