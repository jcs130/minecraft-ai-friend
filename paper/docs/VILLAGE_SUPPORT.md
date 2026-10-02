# 村民收购与村庄守望（AgentFriend 0.3.73）

正式服已有的 `VillageTrades` 会给已加载的成年无职业村民分配原版职业，并保持各职业原版交易。2026-10-03 发布前的只读巡检显示：已加载成年村民 37 位，无职业 0、无交易 0，涵盖农夫、渔夫、图书管理员等 13 种职业。远处未加载的村民会在区块加载时再处理。`/mycli admin villagers` 仍限控制台运维使用。

`/mycli village villagers` 供每位玩家查询本人 96 格内最多 12 位已加载职业村民的绝对坐标、职业和前四条**村民收购玩家物资、付绿宝石**的真实报价。查询只读，不替玩家成交；Agent 要走近村民并用原版交易窗口完成购买／出售。生活公会新增 `trader_supply`「村庄收购单」：在真实交易菜单中把物资卖给**两种不同职业**的成年村民，取得绿宝石。向同一种职业重复出售、用绿宝石买商品、看报价但不成交均不计数。完成后用 `/mycli life claim` 领取商旅声望 4、绿宝石 2 和纸 4；同一自然日限一次，奖励进个人试炼箱或待领取队列。`mcagent:life` 进度回执含 `lastProfession`。

主世界村庄安全区 `x=-630..-470,z=-530..-380` 内禁止掠夺者等敌怪生成，村民也受保护；外围仍可能出现巡逻队。服务端每 2 秒检查离边界 48 格内已加载的 `Raider` 及正在进行的原版 `Raid`。首次发现一个敌情事件时，给每位在线玩家的连接单播 `mcagent:village` 原始 UTF-8 JSON；普通玩家只收到一次简短私有文字，已登记的 Agent 账号收到一次由服务器发出的原版私聊 `MC_VILLAGE_ALERT {"kind":"village_alert","source":"patrol","count":1,"x":-638,"y":80,"z":-450,"action":"check_health_then_defend"}`。私聊采用精简字段以满足原版 256 字符限制；完整状态仍在插件频道，Agent 也可用 `/mycli village threat` 查询。现有 Cortico 的 Mineflayer `whisper` 处理会将私聊作为紧急输入唤醒决策；普通系统聊天不会。两者均不广播、不周期刷聊天。敌情结束时再单播 `kind=clear`。玩家中途加入时若敌情仍在，会收到当前警报。单条负载不超过 16 KiB。

`/mycli village threat` 可随时查询本人可见的服务端状态：`active`、`source=raid|patrol|none`、已加载敌人数 `count`、`dimension`、绝对 `position{x,y,z}`、`priority=village_defense|none`、`recommendedAction`。**未加载区域不能据此判为安全**。Agent 收到 `kind=alert` 或 `MC_VILLAGE_ALERT` 时，应把村庄支援排在普通刷塔、采集和闲置任务之前；先核查生命、护甲、路线和当前副本状态，再去边界支援。血量过低或正在不能安全退出的战斗时先自救、求援，不盲目传到敌人面前。行动前后重新查询 `threat`，只攻击掠夺者等敌对实体，不攻击村民、铁傀儡或玩家。

参与者亲手击败边界 48 格内的掠夺者、卫道士、唤魔者或劫掠兽等 `Raider` 后，本人的 `mcagent:village kind=defense` 给出怪物类型、当日击败数和领奖状态。每日首次有效击败自动结算村庄守望奖励：绿宝石 2、面包 2，进入本人个人试炼箱；无需先接冒险委托，不会打断正在办理的生活或冒险任务。创造／旁观模式不领奖。奖励只鼓励真实支援，村民安全区保护规则不因这项玩法放松。

原版商人、绿宝石、村民职业和掠夺者实体被 Java 客户端、Geyser 基岩版和 Mineflayer 共用。隔离服 `probe/village-support-stage.mjs` 用真实 Mineflayer 1.20.6 完成农夫及渔夫两笔出售、重复职业不计数、领奖、职业和报价查询、外围掠夺者私有警报、玩家击败结算及清场回执。`probe/village-agent-alert-stage.mjs` 还验证 Agent 私聊唤醒入口、普通玩家单条文字与两个账号私有频道隔离。正式服发布仍需按 [维护与发布](OPERATIONS.md) 在无人类玩家、无活动试炼时先备份，再替换插件并验证。
