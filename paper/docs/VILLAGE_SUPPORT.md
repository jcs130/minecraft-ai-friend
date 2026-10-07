# 村民收购与村庄守望（AgentFriend 0.3.85）

## 当前发布与验证

2026-10-06 13:34 正式发布 0.3.85，SHA256 `E699542FF9DFB55CB1137AE8132F06C958B805E0034243D43241294CD7A272AD`，E/F 快照 `20261006-133355/.complete` 完整，任务结果 0。最终隔离服已实际完成支援位移、8 魔力扣费、罗盘点击、多人避让、接近击杀和守望奖励，并验证所有主要拒绝原因不移动/不扣费；正式服已读回无敌人拒绝与魔力 20→20。回归保持已加载区块的有界扫描。详见 [维护与发布](OPERATIONS.md)。

私有证据在 E/F `repairs\village-support-20261006`：`stage-test.json` 是最终成功报告，早期菜单脚本失败与中间报告另存，`production-probe.json`、`production-final-check.json` 是正式读回。没有在正式服生成测试怪。基岩容器菜单由 Geyser 转换，手机/手柄画面未做真机验收；13:44 原机 CortiEye 仍未回连，隔离观战测试不能代替正式镜头恢复。

## 警报过滤与支援传送

2026-10-06 排查正式 0.3.84 日志，多条警报位于 Y=-35、-13、4、17、25，随后十几秒到数分钟内清除。旧守望只限制 X/Z，因此村庄下方无关的结构怪物也会唤醒 Agent；玩家沿地表赶过去可能看不到目标。区块卸载、死亡或离开边界也会使旧坐标失效。

0.3.85 仅把接近当地地表高度（`MOTION_BLOCKING_NO_LEAVES + 1` 的上下 10 格）的灾厄村民算作巡逻威胁；普通野生女巫不当作巡逻队。属于村庄附近**正在进行的真实原版 Raid** 的成员保留，包括洞穴里的袭击成员。实体查询仍只遍历固定 17×17 已加载区块，不加载远处区块、不全世界找怪；API 含义见 [Paper Raider](https://jd.papermc.io/paper/1.20.6/org/bukkit/entity/Raider.html)。

敌人需连续观察至少 4 秒才发首次警报。每个事件有随机 12 位 `eventId`，同事件每个玩家只提示一次；短暂卸载/返回保留 20 秒事件归组，避免反复唤醒。当前无活敌人立即不可支援，不用这段归组时间假装敌人还在。真实 Raid 两波之间可保持 `active=true`，但 `count=0 / phase=waiting_wave / supportAvailable=false`，不发送“有敌人”的紧急私聊。

```text
/mycli village threat
/mycli village support <eventId>
/mycli village support
/mycli cast support
```

后两种入口自动选择当前事件；Agent 优先用警报 `cmd` 或状态 `supportCommand` 的完整事件编号。**支援传送术消耗 8 魔力，成功后冷却 20 秒**。仅生存/冒险玩家可用，至少 3 颗心，不在试炼/PvP、载具或滑翔中。出发前实时重查：旧编号、敌人消失/未加载、尚未确认、无安全落点或魔力不足均拒绝，不移动、不扣费、不播放成功特效。

落点在活敌人周围约 6–12 格，须是已加载区块、世界边界内、有实体地面、脚和头无阻挡、无危险方块、与敌人视线相通；避开其他实体及敌人近身区域，为多人支援分散落点。不会写方块、生成怪物或接受任意坐标。成功沿用 `TravelMagic` 标题、粒子、音效及 `MC_TRAVEL id=support mana=8`，`mcagent:state` 增加 `mycli:support` 实时冷却。

真人在警报里点击「支援传送」，或从罗盘「传送地点」/「探索法术」选择「支援传送术」。Java 与 Geyser 基岩共用原版容器菜单；聊天按钮是否方便点击取决于客户端，菜单与命令是共同入口。隔离 Java/Mineflayer 已验证真实菜单点击，基岩手柄画面仍需现场操作确认。

`mcagent:village` 状态新增 `eventId/phase/loadedOnly/supportAvailable/supportCommand/supportMana/supportCooldownRemainingMs/enemies[]`；`enemies` 最多 8 个真实 UUID、类型和绝对坐标。`MC_VILLAGE_ALERT` 私聊新增 `eventId` 和 `cmd`，仍保留旧 `action` 字段且小于 256 字符。支援返回私有 `MC_VILLAGE_SUPPORT` 聊天 JSON 与同一频道的 `kind=support`：`success/reason/eventId/requiredMana/spentMana/cooldownRemainingMs`，成功另有实际落点 `position/dimension` 和 `enemy`。到场后识别该 UUID，再接近并攻击敌对实体；传送不替 Agent 自动打怪。

控制台只读复核命令为 `mycli admin villageaudit`，返回 `MC_VILLAGE_AUDIT` 的当前已加载敌情、确认状态、坐标与实体。运营判断以新状态为准，不沿用警报里的旧坐标。

正式服已有的 `VillageTrades` 会给已加载的成年无职业村民分配原版职业，并保持各职业原版交易。2026-10-03 发布前的只读巡检显示：已加载成年村民 37 位，无职业 0、无交易 0，涵盖农夫、渔夫、图书管理员等 13 种职业。远处未加载的村民会在区块加载时再处理。`/mycli admin villagers` 仍限控制台运维使用。

`/mycli village villagers` 供每位玩家查询本人 96 格内最多 12 位已加载职业村民的绝对坐标、职业和前四条**村民收购玩家物资、付绿宝石**的真实报价。查询只读，不替玩家成交；Agent 要走近村民并用原版交易窗口完成购买／出售。生活公会新增 `trader_supply`「村庄收购单」：在真实交易菜单中把物资卖给**两种不同职业**的成年村民，取得绿宝石。向同一种职业重复出售、用绿宝石买商品、看报价但不成交均不计数。完成后用 `/mycli life claim` 领取商旅声望 4、绿宝石 2 和纸 4；同一自然日限一次，奖励进个人试炼箱或待领取队列。`mcagent:life` 进度回执含 `lastProfession`。

主世界村庄安全区 `x=-630..-470,z=-530..-380` 内禁止掠夺者等敌怪生成，村民也受保护；外围仍可能出现巡逻队。服务端每 2 秒检查离边界 48 格内已加载且通过上述过滤的 `Raider` 及正在进行的原版 `Raid`。确认事件时单播 `mcagent:village` UTF-8 JSON；普通玩家收到私有警报和支援按钮，已登记 Agent 收到原版 `MC_VILLAGE_ALERT` 私聊。现有 Cortico 的 Mineflayer `whisper` 会唤醒决策，普通系统聊天不会；均不广播、不周期刷聊天。敌情结束单播 `kind=clear`。中途加入若仍有确认的活敌人，收到同一事件状态；同一事件不重复唤醒同一账号。单条频道负载不超过 16 KiB。

`/mycli village threat` 可随时查询 `active/source/count/dimension/position/priority/recommendedAction` 及新增事件字段。**未加载区域不能据此判为安全**。Agent 收到警报时，优先核查生命、装备、魔力和副本状态，再用当前 `supportCommand` 支援。抵达后核对活实体 UUID，敌人继续移动则重查；只攻击敌对实体，不攻击村民、铁傀儡或玩家。传送失败看 `reason`，不要改用免费 `/tp` 或缓存坐标。

参与者亲手击败边界 48 格内的掠夺者、卫道士、唤魔者或劫掠兽等 `Raider` 后，本人的 `mcagent:village kind=defense` 给出怪物类型、当日击败数和领奖状态。每日首次有效击败自动结算村庄守望奖励：绿宝石 2、面包 2，进入本人个人试炼箱；无需先接冒险委托，不会打断正在办理的生活或冒险任务。创造／旁观模式不领奖。奖励只鼓励真实支援，村民安全区保护规则不因这项玩法放松。

原版商人、绿宝石、村民职业和掠夺者实体被 Java 客户端、Geyser 基岩版和 Mineflayer 共用。隔离服 `probe/village-support-stage.mjs` 用真实 Mineflayer 1.20.6 完成农夫及渔夫两笔出售、重复职业不计数、领奖、职业和报价查询、外围掠夺者私有警报、玩家击败结算及清场回执。`probe/village-agent-alert-stage.mjs` 还验证 Agent 私聊唤醒入口、普通玩家单条文字与两个账号私有频道隔离。正式服发布仍需按 [维护与发布](OPERATIONS.md) 在无人类玩家、无活动试炼时先备份，再替换插件并验证。
