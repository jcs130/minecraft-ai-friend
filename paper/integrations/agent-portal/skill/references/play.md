# 先在游戏里学习

通过已有 `mc_do` 的 chat 步骤发送命令，等待本人的真实回执。例如：

```json
{"name":"mc_do","arguments":{"steps":[{"skill":"chat","text":"/mycli status"}]}}
```

先用 `/mycli intro` 或 `/mycli status` 看本人当前目标，按需 `/mycli <分组> --help`。若返回 `requiresWorldAction:true`，下一步是实际走路、击杀或制作；`verifyCommand` 只查进度，不会帮你完成目标。更多故事、技能与任务在游戏里学习，不预读整套玩法。

当前正式服已启用 Vortex 六职业，按需读[原生RPG](rpg-native.md)。原职业已归档，不因资料更新而替已有角色重选职业。命令和参数以服内 `--help` 为准，源码中的新候选不等于已上线。

| 当前需要 | 现有入口 |
| --- | --- |
| 本人下一步、主线/专项/委托区别 | `status`、`progress` |
| 选择探索、战斗、制造、补给或生活路线 | `tasks list`，单项 `tasks info <ID>` |
| 原生任务缺项、旧委托在哪里 | `tasks status` 查RPG任务；`progress guild` 查旧公会单；按真实回执继续 |
| 本人技能、资格、魔力与冷却 | `skills status`；单项 `skills info <ID>` |
| 技能怎样学习和使用 | `skills --help`：通用技无需学习；初始职业技已可用；learn花点学节点，prepare设置点击技，cast施放 |
| 获取公共补给 | `guild shared`，找门口共享箱 |
| 多个位置能否拆放 | `protect batch --help`，批量聚合，按需展开详情 |

表中命令均接在 `/mycli` 后。不同服务端版本默认格式可能不同；程序确需完整字段时，在明确支持的命令后加 `--json`，例如 `/mycli status --json`、`/mycli skills status --json`。不要依赖 `ag_` 自动得到 JSON。旧版本与源码候选的状态以服务器说明为准。

施法用 `/mycli cast <可用ID>`。基础通用技无需学习，职业节点则须按info核对解锁条件；再核对魔力、冷却和目标。基础技能施放不加`--json`，只查询详情时按支持情况使用。闪现瞄准可站立的地面，无安全落点会拒绝且不耗魔。聊天步骤完成仅代表命令发送；施法、交付、参战、领奖均要看服务器最终回执和真实效果。冷却中按回执等待，不连续重发。

试炼塔是 `arena` 按层挑战；遗迹地下城是 `dungeon` 逐室探索。先查询可用入口和本人状态，抵达或看见活动不等于参战。专项完成与主线毕业、公会交付独立；课程明确要求 `list/explain` 的旧阅读实练时按课程执行。

地下城先 `dungeon list` 选地点，`dungeon info <ID>` 按需查规则与准备，`dungeon status <ID>` 查当前场次。`active=false`只是尚无已开启的场次，不等于未开放；空闲时由本人到首室 `dungeon start <ID> normal`，不会等来自动开场。按当前房间清怪，最后回首室 `dungeon claim <ID>` 实际结算。占用、冷却或故障不会靠反复查询推进；按原因改选、整备或联系服主，保留原任务，不自行补完成记录。开场或加入须穿齐四件护甲，携带近战、弓弩或本职业法器，不强制带剑。缺项按回执整备，难度与组队建议另查详情。

NPC沿用 `world npcs` 查实际位置，到8格内 `world talk <ID> <问题>`，`world end`结束；该旧查询不加`--json`。NPC台词不是任务完成证明。当前冒险季玩法见 https://mc.kangqiang.site/aincrad.html ，实际后端以服内status为准，Vortex启用后按需读rpg-native.md。

艾恩葛朗特是独立探索世界，不必从村庄长途走过去。`/aincrad` 查往返说明；已学 `travel` 且有6魔力后 `/warp aincrad` 到起始之城，`/warp village` 回主村庄。核对实际世界与位置再行动。地图建筑受保护，可以开门、开箱和战斗；地图开放不等于百层剧情全部实装。

54格大背包 `/minepacks:backpack open`、任务物品袋和540格个人箱是不同容器。远程个人箱这样用：

1. 先 `/mycli skills info travel`（目录名“传送点术”）；旧后端未学时才 `/mycli skills learn travel`，按回执消耗技能点。若服务器明确说明通用技能已可用，则无需学习。无需特定职业，也不用先传送或走回试炼场。
2. 保持至少2魔力，`/mycli arena stash` 打开第一页；`/mycli arena stash pages` 选页。成功远程开页消耗2魔力，试炼场实体箱旁免费。
3. 在返回的原版箱子窗口正常存取，等待槽位、本人库存与光标确认，关闭重开核对。发出命令不等于窗口已打开；超时先查，不重放。
4. `/mycli arena stash list [页码]` 只查已装入箱格的物品；`/mycli arena rewards list` 查待入箱奖励。领奖后开箱才装入，箱满仍安全保留；空箱列表不等于奖励丢失。没有GUI时按 `/mycli arena stash --help` 的存取语法操作，使用最新查询的槽号。

拍照 `/mycli photo menu`，耗2魔力、无需空地图，成片自动存入个人奖励箱或待入箱队列。

保护拒绝停止操作，unknown 不算授权；同一批目标复用批量结果，相同拒绝不逐格重复刷屏。采集、学习、接单、交易或传送由当前目标决定，提示本身不代替行动授权。私聊用原版 `/msg <在线玩家名> <内容>`，工具反馈不向公屏转发。
