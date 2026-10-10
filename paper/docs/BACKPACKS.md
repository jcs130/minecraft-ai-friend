# 大背包与任务物品袋

## 使用入口

- **大背包（Minepacks，54格）**：右键随身的黄色「大背包」，或 `/backpack open`、`/bp open`。确切入口是 `/minepacks:backpack open`。普通物品在这个原版箱子界面取放，关闭界面保存。
- **任务物品袋（BetonQuest）**：`/questbag` 或 `/betonquest:backpack`，放剧情专用任务物品、查看任务笔记；普通物品不能存入。它不是公会和试炼奖励箱。标题显示「任务物品袋」，只有一本任务笔记并不表示大背包物品消失。
- **个人试炼奖励箱（540格）**：原有 `/mycli arena stash` 和分页入口，是另一份个人库存。

## 奖励与存档分别在哪里

| 用途 | 实际保存位置 | 奖励与取放规则 |
| --- | --- | --- |
| 普通大背包 | `plugins/Minepacks/backpack.db`，在线时有内存缓存 | 本人主动存取；不是任务结算账本 |
| 剧情任务物品袋 | `plugins/BetonQuest/database.db` | BetonQuest任务物品和任务笔记；当前`qd_life`只同步实习标签与导师对话，没有配置物品奖励 |
| 个人奖励箱及待领取队列 | `plugins/AgentFriend/config.yml` 的 `dungeon-personal-stash`、`dungeon-rewards`、`dungeon-bonus-items` | 公会/任务市场/试炼奖励及玩家委托交货沿用这一套；满箱先留队列，个人箱也可手动储物 |

BetonQuest本身能通过剧情动作发放物品；以后编写新剧情时应明确奖励目的地。当前服公会交付实际调用`queueGuildRewards`，村民教学只调用`qd_life`的标签动作，不会把奖励转到任务物品袋。任务专用物品规则参见[官方说明](https://betonquest.org/RELEASE/Documentation/Advanced/Items/#backpack)。

Agent先关闭当前界面，再打开确切入口；操作后检查服务端返回的槽位和数量，关闭并重新打开核对。不要把任务笔记图标当作全部存货，也不要反复存入或丢弃来尝试修复界面。

## 2026-10-10 配置修复

BetonQuest与Minepacks都注册了`backpack`。Minepacks的快捷物品内部执行未带命名空间的`backpack open`，被BetonQuest接走，显示只有任务笔记的「背包」；直接执行`minepacks:backpack open`能看到真正库存。隔离服已复现相同现象。

2026-10-10正式生效的修复在服务器根目录`commands.yml`明确把`backpack`和`bp`转给`minepacks:backpack $1-`，保留参数和Minepacks原权限。`questbag`转给`betonquest:backpack $1-`，BetonQuest自己的命名空间入口保留；中文标题和任务笔记说明明确用途。没有迁移、清空或补发库存，也没有修改Agent客户端或第三方JAR。命令别名需要正常重启加载，不能用`/reload`发布；正式生效时间及验证结果见[运维记录](OPERATIONS.md)。

## 数据保护与验证

排查先做SQLite一致性备份，再用Minepacks自身的`backup <玩家>`导出当前内存库存，保存到E/F两盘。在线缓存可能比数据库更新，不能只看旧数据库就回滚或重复补发。此次问题已确认实际库存仍在服务端内存；正常维护保存后，维护前导出与停服快照、启动后的库存逐项一致。原18份大背包库存及奖励箱/任务袋数据保留。

隔离验证覆盖快捷物品在世界中右键、物品栏右键、普通命令、确切命令、任务物品袋独立入口、取放数量和正常重启保存。使用原版箱子协议；Mineflayer通过只代表协议验证，基岩手机/Xbox画面和玩家实际操作须分别确认。

若仍有具体损失，记录玩家、时间、物品与数量，比较个人物品栏、内存导出和历史快照后逐项处理。不要整库回滚或按猜测发补偿。
