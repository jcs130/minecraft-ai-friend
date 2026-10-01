# Paper 分支维护与发布

## 0.3.51 星芒箭命中目标显示实体类型（2026-10-01）

19:42:49 CortiLan 施放星芒箭时收到“命中 小林”。19:42:51 的 Paper 日志记录同一附近的命名掠夺者 `Pillager['小林']`，UUID `f81825ab-638c-4bbd-9d9d-8df14361faf3`，位于约 `(-538, 63, -375)`，随后被 CortiLan 的剑击杀。旧版施法没有逐次目标 UUID 审计，不能把死亡日志严格当作 19:42:49 那次法术的目标记录。`Named-Villagers` 的 illager 前缀为空，灾厄村民也会得到人名。星芒箭的准星路径和最近目标路径均要求 Bukkit `Enemy`，玩家、村民、宠物与本服召唤的铁傀儡不在候选中；查找合法目标先于扣魔力/设置冷却。

0.3.51 保留原本私有的单行命中提示，并加入常见敌对实体的中文类型与稳定 ID，例如 `星芒箭命中 小林〔掠夺者 / minecraft:pillager〕（4 魔力）`；未列出的敌对类型也会显示 `minecraft:<类型>`。隔离服用同名村民和掠夺者验证：只有村民时返回“没找到怪物；未消耗魔力”，随后立即施法可命中掠夺者而村民生命不变；最终重编 JAR 后再次通过同一 Mineflayer 测试。测试脚本：`paper/probe/starbolt-target-type-smoke.mjs`。

正式服在无活动试炼且只有 Goddess、CortiLan、CortiEye 服务账号在线时由 `Afu-MC-DailyBackup` 正常保存退出，生成 E/F 双盘 `20261001-200923` 快照（均有 `.complete`，任务结果 0），启用唯一 `AgentFriend-0.3.51.jar`，SHA256 `B8832EA18FF03338F614DD1DA0BB4DB5EEC2933972AA44E4184483EBCD5D4AF6`。重启后 Paper 1.20.6、Java 本机及 LAN 网关、Geyser 基岩 Pong、Goddess 桥、Watchdog 正常；CortiLan 已重连，试炼无活动。CortiEyeMirror 0.1.7 已加载，但截至 20:10 远端 CortiEye 尚未回连，镜头附身需账号上线后复查。基岩真机的聊天显示仍需实际登录确认，Pong 只证明入口应答。运行机 `E:\MC\ops\MAINTENANCE.md` 有本次维护记录。

## 0.3.50 试炼塔第 13 层清场误判与状态回执（2026-10-01）

17:11 的归档服务端日志显示：第 12 层在 17:11:30 结算，第 13 层在约 17:11:40 开始，17:11:49 被判“队伍离开或倒下”并清掉怪物；因此随后空房间内并没有仍待击杀的 7 只怪。旧版未记录这批怪的 UUID 与坐标，清场后无法事后读回其实际存活状态；不能把隔离服新生成的 UUID 当作当时的怪。代码检查发现第 13 层岩浆槽位于地板 Y=-16，玩家脚部可下到 Y=-16，而旧 `inFloor` 只接受 Y≥-15；第 12 层浅水凹槽同样有这一问题。当前版本允许凹槽高度，真实离开楼层则给 15 秒返回宽限，失败结算会送达在线参赛者并持久化 `lastReason`。

`/mycli arena status` 与 `/mycli status` 的 `MC_DUNGEON status` 增加 `selfFloor/remainingMobs/trackedMobs/missingMobs/outsideMobs/anomaly/searchAdvice/lastOutcome/lastFloor/lastReason/lastRunParticipant`。`stop_no_active_run` 表示已经清场，Agent 不再搜索；`return_to_floor` 表示人在房间外且仍有宽限。服主的 `mycli admin dungeonaudit` 新增怪物绝对坐标和 `inFloor`；以后的每次生成、死亡、失踪、越界拉回都记录 UUID、类型和坐标或受伤来源，便于查同类事故。

隔离服用 Mineflayer 1.20.6 从第 3 层恢复并打到第 13 层，现场核到 7 个活怪及其 UUID、绝对坐标、正常 AI；账号进入岩浆槽后连续 16 秒仍处于第 13 层，`remainingMobs=7`，清怪后正常结算进入第 14 层。再模拟短暂越界后返回、超过 15 秒越界失败，均得到预期回执。最终重编 JAR 后重启隔离服，再用 Mineflayer 验证已结束时 `remainingMobs=0 searchAdvice=stop_no_active_run lastReason=party_outside_floor lastRunParticipant=true`。测试脚本是 `paper/probe/dungeon-floor-boundary-smoke.mjs`，运行机临时隔离环境端口 25566；其女巫装备包触发过已知 Mineflayer `PartialReadError` 日志，但没有中断本次挑战和状态测试。

正式服在当前 CortiLan 试炼结束、`dungeon-active-run` 清空，且只有 Goddess、CortiLan、CortiEye 服务账号在线后，通过 `Afu-MC-DailyBackup` 正常保存退出并生成 E/F 双盘快照 `20261001-185713`（两处 `.complete`、任务结果 0），随后启用唯一 `AgentFriend-0.3.50.jar`，SHA256 `9466D23E366C6CAD63ADDA196166F8EAAB3B157DF1E837D7255CD039144C4F78`。Paper 1.20.6、Java 本机入口、局域网 Agent 网关、Geyser 基岩 Pong、Goddess 桥、Watchdog 均通过；正式服临时 Mineflayer 账号从局域网入口读到 `participant=false globalActive=false remainingMobs=0 searchAdvice=stop_no_active_run` 后退出。由于调试期白名单按用户要求关闭，原本以“未知账号被拒”为成功条件的 `agent-lan-smoke.mjs` 返回 FAIL，此处改用正向 Mineflayer 登录和 `mcstatus` 核验网关。CortiEyeMirror 插件已加载，但本次重启后远端 CortiEye 尚未重连，镜头附身状态需客户端上线后复查。基岩真机玩法仍需现场验证，Pong 仅证明入口应答。完整发布记录见运行机 `E:\MC\ops\MAINTENANCE.md`。

## 大背包快捷物品恢复（2026-10-01）

CortiLan 的随身 36 格全满，Minepacks 的入服补发和原版 `/give` 都不能把快捷头颅放进物品栏；`/give` 的成功回执可能只代表物品落在脚边。先用玩家身份的 `/mycli arena stash putslot 1 64` 转存一组物品，再补发带 `minecraft:custom_name`（“大背包”）和 `minecraft:profile` 专属纹理的头颅，RCON 读回其位于随身槽 1。AgentFriend 0.3.49 新增丢弃拦截及入服、每分钟缺失自愈；满格时把一组物品持久化到本人个人试炼箱后补回，不覆盖装备或丢弃物品。隔离服 `backpack-recovery-stage.mjs` 用 Mineflayer 验证实际丢弃、满格转存、重登和在线定时恢复；发布记录及 E/F 双盘备份见运行机 `E:\MC\ops\MAINTENANCE.md`。

## CortiLan 个人奖励清理（2026-10-01）

CortiLan 在维护期间把大批重复战利品从个人箱移入了随身背包，停服后的最终存档为个人箱 6/54、背包 36/36。按完整物品组件核对后，只回收个人箱的重复星弦 1 件和背包中未装备的重复奖励装备 12 件；保留更好的武器、各类备用装备、已装备护甲、技能罗盘、命格书、法杖和大背包。按现有 `ArenaEconomy.unitPrice` 的材质、附魔和耐久规则记入个人绿宝石余额 95；清理后个人箱 5/54、背包 24/36，待领取队列为空。没有修改奖励生成规则或其他玩家数据。

清理前在 Paper 正常保存退出后取得 E/F 双盘完整快照 `20261001-135526`（两处 `.complete`）；运行机另留原始配置与玩家数据的单文件副本，精确操作记录及一次性脚本在 `E:\MC\ops\MAINTENANCE.md`。现有 `recycle quote/sell` 仅接受玩家身份，控制台不能代执行；此次在停服状态同步更新个人箱、玩家背包和余额，不能在服务器运行时直接覆盖这些文件。重启后 AgentFriend 0.3.48、CortiLan 重连、保留/清除的背包槽、Java、Geyser UDP Pong、女神桥与 Watchdog 均核验通过。CortiEyeMirror 已加载，但截至 14:05 远端 CortiEye 客户端尚未重连，直播镜头仍需在它登录后复查。

14:17 补验：远端 CortiEye 已自动重连，RCON `cortieye` 回 `camera=online attached=true cameraNightVision=true`，镜头重新附身 CortiLan。

## 0.3.48 挑战侧翼、商人和游戏日领奖（2026-10-01 已正式发布）

第 11–15 层已在 X=-350、Z=-305 的独立侧翼建成：断桥掩体、浅水与干桥、围住的岩浆、热砖/踏板照明，以及第 15 层星灯主宰。第 10 层保留为中途首领，清怪后 10 秒自动进下一层并补血；第 7 层仍是可提前出发的驿站。新房间仅用原版方块与实体，不增加 Java/基岩客户端模组要求。`/mycli arena layout` 向参赛玩家给当前房间的绝对中心、半径、个人箱位置和危险类型。入口与驿站各有补给商、回收商；原版菜单和既有 `shop/recycle` 机器命令共用个人余额。每名玩家每个游戏日每层最多领一次奖励，重复通关返回私有 `MC_DUNGEON_LOOT category=daily_limit`；`/mycli arena loot` 列出当天已领楼层。第 15 层首通专属武器，后续首领奖励轮换。

隔离服先勘察 X=-430 时发现天然木板而拒绝覆盖，改至 X=-350 后才施工。真实 Mineflayer 跑完十五层，分别从新五层中心算路到个人箱，确认水、岩浆、热砖、踏板和掩体方块；相同游戏日再打第 11 层只收到 `daily_limit`，待领取件数不增加。0.3.47 曾短时发布并建成建筑，整理兼容记录时发现它将成品抗火药水放入第 12 层个人箱，与 0.3.46 已知的 Mineflayer `potion_contents` 解码缺口冲突。立即发布 0.3.48：第 12 层改给岩浆膏，入第 13 层时用原版效果包给予三分钟抗火。隔离服重新实走到第 13 层，Mineflayer 确认真实抗火效果、标准 54 格个人箱可打开且有岩浆膏、无成品药水。此前女巫装备包偶发的客户端解析警告仍存在，但未导致这次测试断线或开箱失败；远端 CortiLan 的自主战斗尚未端到端验收。

0.3.47 发布前 E/F 双盘快照 `20261001-132330`，正式世界勘察和一次性施工后 E/F 双盘快照 `20261001-132509`；0.3.48 修正前再次正常停服备份，E/F 双盘快照 `20261001-133623`。三次 `Afu-MC-DailyBackup` S4U 任务结果均为 0，两盘 `.complete` 存在，维护暂停标记清除。正式服唯一启用 `AgentFriend-0.3.48.jar`，279097 字节，SHA256 `18BD55AB50109FE87E16F23EC2BF3A68494FCC4F1A142A59C8A1C461CCBBD433`。正式 Mineflayer 临时账号验证 `maxFloor=15` 与入口购买菜单后已移出白名单；Java、Geyser UDP Pong、女神桥、Watchdog 正常，最近一分钟 MSPT 平均约 5.9 ms。CortiEye 已重连，RCON 回 `camera=online attached=true cameraNightVision=true`。基岩真机的商人菜单与新房间画面需用户实际体验，Pong 不能代替手柄验收。

回退 JAR 前须检查无活动试炼。仅回退到 0.3.47 会重新引入成品药水奖励；回退到 0.3.46 则不认识第 11–15 层的保护与领奖账本，**不可只换旧 JAR 后继续在新侧翼游玩**。如需世界级回退，应在无人游玩时将世界、插件配置、玩家进度作为一组从 `20261001-132330` 恢复，并明示该时间之后的进度将回退；平常保留 0.3.48，优先做前进式修复。

## 0.3.46 试炼身份回执与前层补给（2026-10-01 已正式发布）

`/mycli status` 和 `/mycli arena status` 现把本人 `participant` 与全服试炼状态分开；机器行 `MC_DUNGEON status` 带 `selfState/globalActive/globalState/globalFloor/maxFloor`，活动楼层坐标附 `scope=global`。隔离服两名 Mineflayer 1.20.6 账号分别在塔内和村庄时，两条命令均给参赛者 `participant=true`、未参赛者 `participant=false`；两者看到同一全服楼层，村庄账号仍显示“本人未参赛”。正式服重启后全新账号在两条命令中收到 `participant=false globalActive=false`，入口坐标标记 `scope=public`。

前三层保底材料、金苹果、酿药材料与弓箭，随机额外奖励也限制为材料和消耗品；铁甲保底移至第四、五、八、九层，钻石套装及首领轮换保持。曾尝试直接给成品药水：隔离服十层结算成功，但 Mineflayer 1.20.6 无法解码个人箱的 `potion_contents`，箱子打不开，故最终版改为可正常读取的金苹果、闪烁的西瓜片和河豚。最终候选再跑十层，Agent 逐层读到补给和六件装备，打开 22 格个人箱，钻石套装进度 2，结果 PASS。原有女巫手持药水 `entity_equipment` 偶发解析警告仍存在，本次没有妨碍领奖。规则见 [试炼塔奖励](ARENA_LOOT.md)。

发布前 CortiLan 的上一轮试炼在第七层休息站；等待其自然打完并确认 `dungeon-active-run` 清空后，仅 Goddess、CortiLan、CortiEye 服务账号在线。S4U `Afu-MC-DailyBackup` 正常停服，E/F 两盘 `20261001-124407` 快照均有 `.complete`、任务结果 0，只启用 `AgentFriend-0.3.46.jar`（273525 字节，SHA256 `5E3F607014D171A38683E2C1BDA3F9F8223DDE947810E6A8B7D8CA59B884AC13`）。RCON 读回 0.3.46；Java 状态、Agent LAN 网关、Geyser 基岩 Pong、Goddess 桥和 Watchdog 正常，待发布/自动恢复暂停标记不存在。CortiEyeMirror 服务端已加载，但远端 CortiEye 到 12:49 仍未重连，RCON 为 `camera=offline attached=false`；直播镜头需远端客户端重新上线后再核验 `attached=true` 和夜视。基岩真机的奖励显示与手柄开箱仍待现场验收。

## 0.3.45 试炼塔装备回收、套装保底与奖励轮换（2026-10-01 已正式发布）

0.3.44 的第七层私有回收、余额商店与怪物友伤防护一并随 0.3.45 发布。新奖励在前四层保底附魔铁甲，第六和第十层按玩家进度轮换钻石甲；随机池覆盖所有护甲部位及武器、工具、稀有补给，重复首领战轮换宝藏。`/mycli arena loot` 返回本人下件钻石甲与排队量。规则和经济接口分别见 [奖励设计](ARENA_LOOT.md)、[第七层回收与补给](ARENA_ECONOMY.md)。隔离服同 UUID 两次十层挑战、满 128 件队列后第八层保底装备、重复铁盔回收与专属武器保护均通过。Mineflayer 偶发解析警告已定位为女巫原版药水的 `entity_equipment` 包，不是奖励 ItemStack；这项客户端兼容缺口另行处理。

维护脚本同步修复了 `minecraft:list` 的 `[Agent]` 显示前缀导致真实账号名单解析失败的问题，改读 `minecraft:list uuids`；真实三服务账号和模拟 `.MicroKQ` 真人准入门均通过。正式服发布前只有 CortiLan、CortiEye、Goddess 服务账号在线，第十层活动试炼已经结束，配置没有 `dungeon-active-run`。现有 S4U `Afu-MC-DailyBackup` 正常停服、生成 E/F 两盘 `20261001-121106` `.complete` 快照，任务结果 0，并把唯一启用 JAR 从 0.3.43 切至 `AgentFriend-0.3.45.jar`，SHA256 `EAA258298A00F379C7E088E47AEC492D2825694DDA9ECB198E68A4CBA36DD0B1`。RCON 读回 0.3.45；Java、Agent LAN 网关、Geyser 基岩 Pong、Goddess 桥与 Watchdog 通过，临时调试白名单仍关闭；待发布标记和自动恢复暂停标记均不存在。CortiEyeMirror 服务端已加载，远端 CortiEye 客户端在 12:13 的首次复查仍未上线，直播镜头需其重连后用 `cortieye` 核验 `attached=true` 和夜视。基岩真机奖励名称与手柄菜单尚需实际游玩确认。

## 0.3.43 玩家头顶 Agent 标签（2026-10-01 已正式发布）

通过原版 scoreboard team prefix 给 CortiLan、Kirito、Naruto、corti 按 UUID 显示简短的 `[Agent]` 头顶标签；普通玩家、Goddess 与摄像机账号不加。不会替换玩家的 scoreboard 或夺走其他插件已分配的队伍。配置和多端限制见 [玩家头顶标签](PLAYER_NAMETAGS.md)。隔离服 25566 用全新 Agent/普通 Mineflayer 账号收到原版 `teams` 前缀和成员包，普通玩家不在队伍；隔离服已恢复原 JAR 与配置并停机。

正式服发布前只有 CortiLan 与 Goddess 在线，配置没有活动试炼检查点。`Afu-MC-DailyBackup` 正常停服并生成 E/F 双盘 `.complete` 快照 `20261001-090029`，任务结果 0，唯一启用 `AgentFriend-0.3.43.jar` 的 SHA256 为 `D5E470232DB3AACE8994E3254D2C9E85D92E0D7918579809377310ABCDBE4D3B`。重启后 RCON 读回 0.3.43；临时白名单 Mineflayer 普通玩家收到 CortiLan 的前缀和成员包，自己未进入 Agent 队伍，随后退出并移出白名单。Java、Geyser 基岩 Pong、Agent LAN 网关、Goddess 桥、CortiEye 附身/夜视及 Watchdog 正常，自动恢复暂停标记不存在。基岩真机的标签位置、颜色和中文字体仍待玩家画面验收；Pong 不能替代此项。

## 0.3.42 保护查询独占插件消息（2026-10-01 已正式发布）

`/mycli protect break|place <x> <y> <z>` 保留原判定与 JSON 字段，`deny`、`unknown`、`allow_likely` 只通过请求玩家连接的 `mcagent:protection` UTF-8 JSON custom payload 返回；不发 `MC_PROTECT` 系统聊天、广播、动作栏或标题。0.3.41 曾只删除聊天副本，但正式 CortiLan 的 `getListeningPluginChannels()` 为 `registered=false`，Paper 的 `sendPluginMessage` 会静默跳过这类连接。0.3.42 对已注册连接继续用 Bukkit API，对未注册连接复用 Paper 1.20.6 原生 `ClientboundCustomPayloadPacket`/`DiscardedPayload` 编码发送同一频道与原始 JSON；这个分支与服务端版本绑定，将来升级 Paper 须重新验证。控制台只读 `/mycli admin protectchannel <在线玩家>` 可查询注册状态，不向玩家发消息。

隔离服 `protection-channel-stage.mjs` 用干净角色数据模拟未注册的 CortiLan、未注册的 CortiEye 和已注册的普通玩家，收到状态 `deny/unknown/allow_likely` 各一次；普通玩家自己的回执不泄给 CortiLan，CortiEye 负载 0，三个聊天流均无 `MC_PROTECT`。旧隔离角色数据单文件备份后已恢复。发布前只有 CortiLan、CortiEye、Goddess 服务账号在线且无活动试炼；S4U 维护任务先正常停服，E/F 双盘 `20261001-084034` 均有 `.complete`，结果 0。正式服只启用 `AgentFriend-0.3.42.jar`（SHA256 `AF9E0D3334143D63300D6249D16A4F0E49BCD67CBF0F07BA9DCD4D268C0F658E`）；`paper/probe/protection-live-smoke.mjs` 让未注册的临时 Mineflayer 玩家在正式服收到建筑拒绝、道路拒绝、未知及户外可能允许四条 payload，聊天副本 0，临时白名单已撤。Java、Geyser Pong、Agent LAN 网关、女神桥和自动恢复正常。真实 CortiLan 仍未注册频道，协议层的未注册路径已验证，但其 192.168.3.152 运行程序是否把 `custom_payload` 交给决策层，服主机无法直接观测；不能声称这一层已端到端验收。CortiEyeMirror 插件加载，远端 CortiEye 在发布后首次复查尚未上线。

## 0.3.40 命格书与技能罗盘防丢（2026-10-01 已正式发布）

AgentFriend 标记的技能罗盘和命格书会拦截玩家丢弃事件，同类型普通物品照常可丢。命格书打开时按玩家本人实时写入生命、魔力、原版经验等级、击败怪物/玩家数、死亡次数、AuraSkills 部分技能等级及八项法术熟练度；公会页前移到战绩之后，保留本人冒险者等级、声望、完成单数、当前任务进度。当前没有自由属性点，书中只说明实际存在的自动经验成长和成功施法熟练度。改动没有新权限、配置或客户端协议要求。

隔离服 25566 用 `book-compass-stage.mjs` 验证带标记与普通物品的丢弃差异、客户端成书组件、打开时经验等级刷新；`journey-guide-stage.mjs` 验证罗盘到指南、地点、公会菜单及重新登录。发布前仅 CortiLan、Goddess 两个服务账号在线，`dungeon-active-run` 不存在；S4U `Afu-MC-DailyBackup` 先正常停服备份，再启用唯一 `AgentFriend-0.3.40.jar`（SHA256 `977DABA5C58AA998378800B43B6DAB97F0CEBDE782996092675ABC253337101D`）。E/F 双盘 `20261001-072303` 都有 `.complete`，任务结果 0；Java、Geyser UDP Pong、Agent LAN 网关、女神桥及自动恢复正常。旧 `0.3.39` JAR 留在服务端目录并禁用，可按现有无人游玩备份发布流程回退；CortiEyeMirror 服务端载入，但远端观战客户端本轮未联机验证。基岩真机的丢弃手势与书页显示仍待现场验收。

## 0.3.39 个人奖励箱扩为 54 格（2026-10-01 已正式发布）

CortiLan 的原 27 格个人箱与 36 格随身背包都已占满；绿宝石堆为 64，木棍没有可合并的箱格，所以普通存入与待入箱奖励都无法继续。试炼、公会和 `/mycli arena rewards|stash` 共用的虚拟箱改为原版 54 格双箱界面，实体入口方块和各玩家 UUID 不变。旧槽位 0–26 原样保留，新增槽位 27–53；`stash list` 和 `stash take` 的范围同步更新。奖励队列继续保留溢出，不直接改玩家背包。

隔离服 `dungeon-standard-chest-stage.mjs` 通过双人 UUID 隔离、标准 Mineflayer `openContainer`/`deposit`/`withdraw`、试炼及公会奖励、重启持久化；正式服临时 Mineflayer 玩家再次验证 54 格标准存取，随后移出白名单。发布前仅 CortiLan、CortiEye、Goddess 三个服务账号在线，没有活动试炼。S4U 备份任务结果 0，E/F 双盘快照 `20261001-070657` 都有 `.complete`，唯一启用的 `AgentFriend-0.3.39.jar` SHA256 为 `3C626FBAE538A6F922185EC3C1C8C60D101C817D94E0E2C36E31D1DF56104C02`。正式服 CortiLan 旧 27 格仍在；以其玩家身份重新开箱后占用 36/54，原待入箱的铁锭、绿宝石、箭均归零。Java、基岩 Pong、LAN Agent 网关、女神桥和自动恢复正常。CortiEyeMirror 服务端已加载，远端 CortiEye 在首次重查时尚未重连，直播镜头需另查 `cortieye`。

## 0.3.38 Agent 低频游玩提醒（2026-10-01 已正式发布）

新增 `/mycli coach status|on|off` 个人开关和只发本人的 `MC_COACH` JSON 系统聊天。Java/Mineflayer 默认开启、Floodgate 基岩默认关闭，旁观者不提醒；默认 30 分钟内死亡 3 次、15 分钟闲置、活跃游玩 45 分钟未用 `/mycli` 触发相应建议，三类提醒共享 30 分钟冷却。不会自动施法、传送或给物品。规则、配置、玩家 PDC 与客户端解析见 [Agent 游玩提醒](AGENT_COACH.md)。

隔离服 25566 将门槛临时缩为数秒、死亡阈值设为 2；`agent-coach-stage.mjs` 用真实 Mineflayer 1.20.6 账号验证个人开关、闲置只发一次、两次死亡后复活提示、持续活动但久未用 `/mycli` 提示、`list/explain coach` 和结构化错误码，结果 PASS。测试结束已恢复隔离服原配置与出生点并正常停机。正式服发布前只有 CortiLan、CortiEye、Goddess 服务账号在线、无活动试炼，自动恢复未暂停；S4U `Afu-MC-DailyBackup` 正常停服，E/F 双盘快照 `20261001-024036` 均有 `.complete`，任务结果 0。只启用 `AgentFriend-0.3.38.jar`，SHA256 `70B4CD8CCC585250836FB3E4BB5F0C367CB1B488DBC7AD733912CA80A608F07B`。正式服临时白名单 Mineflayer 账号核验生产默认门槛、`off` 跨重登保存和 `on` 恢复，随后移出白名单。Java、LAN Agent 网关、基岩 Pong、Goddess 桥、Watchdog 与 CortiEye 观战附身、夜视均正常；基岩真机手动打开提醒时的聊天渲染仍需玩家体验验收，152 上 CortiLan 客户端收集系统聊天的端到端链路也未在此轮直接验证。

## 0.3.37 Agent CLI 自发现（2026-10-01 已正式发布）

玩家命令新增 `/mycli list [分类|命令|all] [页码]`、`/mycli explain <ID>`，以及 `/mycli help <ID>` 别名。每页最多七项，`MC_CLI_LIST`、`MC_CLI_ITEM`、`MC_CLI_DETAIL`、`MC_CLI_ERROR` 是只发给发令玩家的系统聊天 JSON；`list` 和 `explain` 不施法、不传送、不操作物品。目录不包含控制台 `admin` 命令。Agent 用法与字段见 [Agent CLI 指南](MYCLI_AGENT_CLI.md)。现有手柄菜单和 Java、基岩、Mineflayer 原版命令兼容。

隔离服 25566 `mycli-catalog-stage.mjs` 实测 21 项顶层命令、18 项 `cast` 子命令的分页、点号/空格两种解释方式、未知 ID/坏页码错误码，以及查询前后生命、位置、背包一致。正式服发布前只有 CortiLan、CortiEye、Goddess 服务账号在线，没有活动试炼，自动恢复未暂停。S4U `Afu-MC-DailyBackup` 正常停服，E/F 双盘完整快照 `20261001-021354` 均有 `.complete`，任务结果 0，正式服仅启用 `AgentFriend-0.3.37.jar`，SHA256 `BC861D64563C1E036A89DA8600D326BF864F1CEE3594648BFA6E82AC410436DF`。正式服临时白名单 Mineflayer 1.20.6 玩家再次通过同一契约测试，已移出白名单；Java、LAN 网关、Geyser 基岩 Pong、Goddess 桥正常。CortiEyeMirror 已载入，但 02:15 远端 CortiEye 客户端仍未重连，`camera=offline`；附身状态待恢复后补记。基岩真人聊天渲染也待手柄玩家实际验证；Pong 仅证明 UDP 入口。

## 0.3.36 法术分类与熟练度（2026-10-01 已正式发布）

八项 AgentFriend 法术增加按 UUID 保存的个人熟练度：成功施放 8/24 次到 2/3 级；战斗伤害及控制时长、探索持续/感知范围、探矿标记时长有界成长。AuraSkills 战斗等级最多给战斗法术 +2 伤害，既有统一魔力、挖矿半径、公会声望、女神学习和 MagicSpells 生活法术保持独立。罗盘「技能成长」是 27 格原版菜单，命格书有短引导；Agent 用 `/mycli mastery` 取 `MC_MASTERY`，通用 `mcviewer:state` 仍只发本人能力等级。规则和未升级的类别见 [技能体系](SKILL_SYSTEM.md)。玩家进度在 `plugins/AgentFriend/spell-mastery.yml`，旧 JAR 回退时须保留这份文件。

隔离服 25566 用 Mineflayer 测过无目标不计数、第 8 次升级、按 UUID 隔离、菜单、状态包、JVM 重启后等级和实际伤害比例；原 `viewer-state-stage.mjs`、`utility-spells-stage.mjs` 回归通过。只在隔离服临时提高魔力回复做连续施放，随后恢复原 `stats.yml`。正式服发布前只有 Goddess、CortiLan、CortiEye 服务账号在线，无活动地下城；S4U 备份任务结果 0，E/F 快照 `20261001-014541` 均有 `.complete`，单一 JAR SHA256 `4BE39B3DA73E31525437C47BF15B497FFA1F2CAC5AB292226424C9A671C93504`。

首次启动遇到 Minecraft 官方发现服务一次 TLS 握手中断，Geyser 未监听 UDP；Java 仍正常。既有 Watchdog 连续三次探测失败且确认无真人后，于 01:49 自动正常重启一次，01:50 基岩 Pong 恢复，恢复标记清除，Watchdog 结果 0。独立 Java HTTPS 请求得到 200，未改 Geyser 或网络配置。正式服临时白名单 Mineflayer 实测 8 条个人熟练度、罗盘入口和本人 `mcviewer:state`，随后移出白名单；Java、LAN Agent 网关、女神桥、基岩 Pong 正常，最近一分钟 MSPT 平均约 7.1 ms。CortiEye 客户端稍后自动重连，01:58 RCON `cortieye` 回 `camera=online attached=true cameraNightVision=true`，镜头重新附身 CortiLan。基岩真人尚未测试新菜单与光效；CortiEye 客户端的实际技能画面也尚未目视验收。

## 0.3.35 导航回执绝对坐标（2026-10-01 已正式发布）

`/mycli waypoint` 现在按本人列出公共 warp、试炼场、私人 home 的 `MC_WAYPOINT id=... dimension=... x=... y=... z=...`；`goto` 的 Essentials 地点返回 `MC_DESTINATION` **目标**坐标，真正抵达以客户端位置为准。`locate list|nearest|<玩家>` 返回 `MC_PLAYER`，追踪条继续保留方向/距离并刷新目标绝对坐标；探敌术最多给出五个最近怪物的 `MC_HOSTILE` 坐标；遗迹远征 `MC_SITE` 返回实际安全落点 x/y/z 与仅有水平精度的遗迹中心 X/Z。试炼状态和死亡领箱提示带维度、入口及箱子坐标，公会/试炼场/队友传送成功回实际落点。消息仅发给操作玩家，均走原版聊天或 BossBar；探矿和保护查询原有绝对坐标保持不变。移动目标坐标是快照，Agent 算路前须重查。

隔离服 25566 上 `absolute-location-stage.mjs` 以两名 Mineflayer 1.20.6 玩家验过队友、Essentials 公共和私人地点、探敌、试炼入口、遗迹安全落点与公会抵达，结果 PASS。隔离世界旧出生点会触发传送并把测试玩家移回，脚本临时设置远处安全平台和出生点，结束时恢复；该问题是测试场地，不作为正式服故障。正式服 0.3.35 JAR SHA256 `7A8AEBC489E03943E85E6C47037E97A6D454C31B1EF273D9A0534DC5CB40C5D4`。发布前只有 CortiLan、CortiEye、Goddess 服务账号在线且无活动试炼；S4U 维护任务正常停服、生成 E/F 双盘 `.complete` 快照 `20261001-005202`、发布单一 JAR 并重启，任务结果 0，Watchdog 未暂停。正式服临时白名单 Mineflayer 1.20.6 账号实测 `MC_WAYPOINT`、`MC_PLAYER`、`MC_DUNGEON` 后退出并移出白名单。Java 127.0.0.1、Agent LAN 网关、基岩 Pong、女神桥正常。CortiEye 最初未立即重连，01:00 后已重新上线；RCON `cortieye` 回 `camera=online attached=true cameraNightVision=true`，镜头重新附身 CortiLan。

## 0.3.34 地下城普通个人箱（已正式发布）

试炼塔实体箱、公会看板和 `/mycli arena rewards|stash` 指向同一个按 UUID 隔离的 27 格普通箱子。Mineflayer 使用实体箱的 `openContainer`、`deposit`、`withdraw`；Java 与基岩玩家使用原版箱子菜单。试炼、公会奖励先记入原 `dungeon-rewards`、`dungeon-bonus-items` 队列，下次开箱时移入 `dungeon-personal-stash`，保留附魔等 ItemStack 元数据；箱满时剩余部分继续留在队列，腾格后重开自动补入。`rewards list|take` 仅用于箱满后的待入箱物品，`stash inventory|list|put|putslot|take` 是远程辅助操作。回退 0.3.33 会暂时失去私人箱入口，但保留完整 `config.yml` 后重发 0.3.34 可恢复箱内与待入箱数据；不可用旧版运行配置覆盖现有数据。

隔离服 25566 的 `dungeon-standard-chest-stage.mjs` 用两名 Mineflayer 1.20.6 玩家验证实体箱连续开箱、标准 `deposit`/`withdraw`、UUID 隔离、首层与公会奖励自动入箱；以同一玩家账号跨 JVM 重启再次通过取物验证。测试后隔离服已正常停机。正式 JAR SHA256 为 `B82F4E3AE65ABE4A99F2969638553E5701564127F8F9421580C5F2FA3B0181CB`。2026-09-30 23:53，确认无真人玩家、无活动试炼后触发既有 S4U 备份发布任务，E/F 快照 `20260930-235317` 均有 `.complete`，任务结果 0；正式服只启用 0.3.34 JAR。Java、Geyser 基岩 Pong、LAN Agent 网关、女神桥及 Watchdog 检查通过。临时白名单 Mineflayer 1.20.6 账号在正式服用入口实体箱完成标准 `openContainer`、`deposit`、`withdraw`、重开与取物，随后退出并移出白名单。基岩真机手柄箱菜单仍须人工验收。CortiEyeMirror 已加载，但远端 CortiEye 客户端重启后尚未重新登录，`cortieye` 显示 `camera=offline`；直播镜头要待 152 上客户端恢复后复验，不能把插件加载视作镜头已恢复。

实体箱通过原版容器协议交互，不依赖 Agent 读取指令回执。作为辅助入口，服务端仍只把 `MC_REWARD`、`MC_STASH` 等回执发给本人连接。CortiLan 当前经 `192.168.3.152` 连入，服主机的 `E:\Cortico` 源码副本不是其运行实例；这个副本已在本地提交“斜杠命令收集系统聊天回执”的改动，类型检查与 4702 项测试通过，真实 1.20.6 协议也确认回复为 `system` 消息。运行在 152 的 Cortico 尚未更新，不能把本机源码测试等同于 CortiLan 端到端验收。`paper/probe/stash-live-smoke.mjs` 用临时白名单 Mineflayer 玩家在正式服核对服务器接口。

## 0.3.33 Agent 保护预检（已正式发布）

`/mycli protect break|place <x> <y> <z>` 按发命令的玩家身份查询 16 格内已加载目标；自 0.3.41 起，`deny`、`unknown`、`allow_likely` 结果只通过本人的 `mcagent:protection` 原始 UTF-8 JSON plugin message 返回，不再发送 `MC_PROTECT` 聊天副本。0.3.42 进一步为未注册频道的连接直发同种原生包，避免 Paper API 静默跳过真实 CortiLan。结果覆盖 WorldGuard、村屋原始方块、公会大厅、公共道路、试炼场和十层地下城。Agent 行为见 [接入说明](AGENT_PROTECTION.md)；实际方块事件仍是最终拦截。查询不返回方块材质，防止变成探矿旁路。

隔离服 25566 用真实 Mineflayer 1.20.6 验证：原村屋方块返回 `village_structure/deny`，村庄户外方块返回 `no_known_protection/allow_likely`，试炼塔返回 `dungeon/deny`，公共道路方块与道路净空的放置返回 `trial_road/deny`，远距离返回 `unknown_out_of_range/unknown`；聊天和插件消息一致，另一玩家连接没有收到查询结果。放置事件仍取被替换方块的旧状态；该逻辑用前一构建复测通过，随后只增加 `/mycli guide explore` 的 Agent 提示并重新编译，最终 SHA256 `958239948751A4FA0908A19DA71A1190E57BEE821BFD733F8723A5F107D936DB`。隔离服已停并恢复原 AgentFriend 0.3.31 JAR。

2026-09-30 首次检查正式服时 `.MicroKQ` 仍在线，因此当时没有重启。将 0.3.33 候选按哈希复制到 `E:\minecraft-ai-friend\paper\plugins\AgentFriend\`，把原 0.3.32 待发布计划替换为包含探矿坐标与保护查询的 0.3.33；旧版预期哈希仍是当时的生产 0.3.30。下面记录实际发布与复测。

2026-09-30 18:21，仅 Goddess、CortiLan、CortiEye 服务账号在线且无活动试炼，触发既有 `Afu-MC-DailyBackup` S4U 任务。正常停服快照 `20260930-182118` 在 E/F 两盘均有 `.complete`，任务结果为 0；计划中原 0.3.30 哈希与 0.3.33 候选哈希校验后，只启用 `AgentFriend-0.3.33.jar`，待发布文件已清除。RCON 确认版本 0.3.33；Java 状态、LAN Agent 网关的未授权身份拒绝、Geyser 基岩 Pong、Goddess 桥、CortiEyeMirror 载入与重新附身、Watchdog 未暂停均正常。最近一分钟 MSPT 平均约 5.2 ms。正式服临时白名单 Mineflayer 1.20.6 账号按本人连接查询，村屋返回 `village_structure/deny`，道路净空返回 `trial_road/deny`，户外返回 `allow_likely`；聊天与 `mcagent:protection` 原始 JSON 一致，账号随后退出并移除白名单。基岩真机此轮未入服，Pong 只证明网络入口。Cortico 自动挖掘代码尚未接入预检，不得声称它已经自动避让。

这台主机的普通交互式 PowerShell 会在停止 S4U 启动的 Agent 网关进程时收到“Access is denied”；这次直接运行 `manage-server.ps1 Backup` 在停服前失败并恢复了 Goddess，未创建快照或部署。随后通过 `Start-ScheduledTask -TaskName Afu-MC-DailyBackup` 执行同一维护脚本，成功完成备份、发布、重启和镜像。以后需要立即发布时，先确认无真人玩家、无活动试炼，再触发该任务并检查 `Get-ScheduledTaskInfo` 的结果、`manage-server.log` 和两处 `.complete`；不要强杀网关或绕过备份。若需回退，仅在无人游玩且无活动试炼时，正常停服，禁用 0.3.33、启用备份中的 0.3.30 JAR，再启动并复测；旧版不提供绝对探矿坐标或保护预检，不要直接恢复旧世界覆盖后续玩家进度。

此文档描述源码分支与当前 Windows 家服的关系。仓库是代码及配置基线；正式存档和玩家状态只保存在 `E:\MC\server` 以及已校验备份中。完整本机维护记录仍在 `E:\MC\ops\MAINTENANCE.md`。

## 0.3.32 探矿返回绝对坐标（已并入正式服 0.3.33）

探矿成功时只向施法者发送 `dimension=minecraft:overworld X=317 Y=115 Z=17 ore=minecraft:diamond_ore` 形式的聊天结果；坐标是矿块整数坐标，负坐标和下界使用同样的字段。BossBar 改为显示同一组绝对 X/Y/Z，原来的相对方向/距离不再需要 Agent 推算。矿块描边、基岩墙面光框、Paper 反透视、6 魔力与 30 秒冷却均不改。`prospecting-stage.mjs` 用 Mineflayer 1.20.6 实测了密封矿石仍隐藏、成功聊天与顶栏坐标一致、空搜索不扣魔力和冷却；`focus-outline-stage.mjs` 验证施法者独享描边及旧法杖治疗功能，两项均通过。最终候选 `AgentFriend-0.3.32.jar` SHA256 为 `89755A8D163DECCE9CD9DD733B82BA504F846B28E73F4EAD8FDF5B4BC18EFF20`。

2026-09-30 检查正式服时，真人 `.MicroKQ` 在线且正在试炼塔第八层，因此当时没有重启或替换正式服。随后 0.3.32 的待发布计划被包含本功能与保护预检的 0.3.33 取代；正式服现已运行 0.3.33，上述旧候选哈希仅供追溯。

## 日常检查

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\MC\ops\manage-server.ps1 Status
node E:\MC\probe\rcon.mjs mspt
node E:\MC\probe\agent-lan-smoke.mjs
node E:\MC\bedrock-ping.mjs 192.168.3.163 19132
```

`Status` 应同时显示 Paper、Agent 网关、Geyser Pong、Goddess 桥、CortiEyeMirror、最近 E 盘快照及 F 盘镜像。Pong 和状态包不是基岩真机、Agent 具体动作或直播画面的端到端验收。

## 0.3.30 玩家与 Agent 旅途指引（2026-09-30）

新玩家首次入服得到一次短提示：手持技能罗盘按使用键，从「旅途指南」开始；手柄无须打字，命格书可用页面箭头阅读。提示状态存在玩家 PDC，重连不重复刷屏。旧玩家下一次上线也会收到一次入口提示。原有命格书每次使用都会按当前血量、魔力和挖矿等级重建，书页改为从“开局三步”到手柄、探索、魔法、道具刻印、公会、试炼塔和奖励的短章节。书页不使用聊天点击事件，保持 Java/基岩原版书本可读。

技能罗盘新增「旅途指南」图标，打开 27 格原版容器菜单；选章节直接进入现有地点、公会、队友或技能菜单，命格书章节发真实 `open_book` 包。刻印章节在玩家手持合适工具且靠近附魔台时直接进入刻印菜单，否则发简短操作提示。没有新增必须输入的玩家指令。Agent 用 `/mycli guide` 或 `/mycli guide start|explore|magic|gear|guild|dungeon|team` 获取与菜单对应的精确 `/mycli` 操作，包括公会接单/交付和入口个人奖励箱；`/mycli guide menu` 也能打开相同菜单。

隔离服 `journey-guide-stage.mjs` 以 Mineflayer 1.20.6 验证书本原始物品同步含手柄、试炼和 Agent 章节；罗盘 → 旅途指南 → 地点/公会的真实菜单流、书本打开包、Agent 指令返回及重连不重复欢迎提示。`imprint-prospect-stage.mjs`、`focus-outline-stage.mjs` 复测工具刻印和旧法杖。发布只替换 AgentFriend，不改世界结构、代理或第三方插件；基岩真机的书本排版和手柄按钮仍需游玩时目视验收。

2026-09-30 11:39，仅服务账号在线且无活动试炼时，由 S4U 备份任务正常停服并生成 `E:\MC\backups\scheduled\20260930-113952`，校验候选与原 JAR 哈希后启用唯一 `AgentFriend-0.3.30.jar`（206148 字节；SHA256 `96fac10b4c7f9b4fd519d20292bfb61dee37c7361fa5bd6ea88cc5713a51b7d4`）。同名 F 盘镜像与本地均有 `.complete`。正式服 RCON 确认版本 0.3.30；Java 状态、Agent LAN 网关白名单拒绝探针、Geyser 基岩 Pong、Goddess 桥、CortiEyeMirror 和 Watchdog 未暂停均正常。回退时在无人游玩、无活动试炼时正常停服，禁用 0.3.30，启用保留的 0.3.29；命格书和入门标记在玩家数据中，回退前留完整快照。

## 0.3.29 探矿成长与附魔台刻印（2026-09-30）

探矿基础半径为 24 格；AuraSkills 挖矿等级每 5 级增加 2 格，等级加成为 16 格封顶。手持刻有探矿术的工具再加 8 格，最高 48 格。扫描只查询已加载区块，并从近到远搜索；无目标不扣魔力或进入技能冷却，失败尝试至少间隔 5 秒。反透视仍由 Paper 保持，真实矿物位置只在探矿成功时通过施法者自己的 BossBar、描边和粒子提示。矿物冷却与 6 魔力消耗不变。

玩家手持镐、剑、斧、铲、锄、弓、盾、望远镜等原版工具，在附魔台 4 格内潜行使用附魔台即可打开原版容器菜单，选择法术刻印；普通右键仍打开原生附魔界面。每件物品一次保存一个法术 ID；再次选择可改刻印。生存模式每次消耗 3 原版经验等级和 1 青金石，创造模式免费。刻印保存在物品 PDC，客户端可见说明和附魔光效；已有原版附魔与旧说明保留。潜行使用该物品会以本人身份走同一 `/mycli cast` 路径，因此学习条件、魔力、目标选择和技能冷却仍有效。Agent 在同样的附魔台距离内可用 `/mycli imprint <技能ID>`，并可直接 `/mycli cast <技能ID>`；`/mycli imprint list` 列出可刻印技能。这个“法术刻印”是服务端实现，不占用原版附魔注册表，避免要求基岩或 Mineflayer 安装客户端模组。

隔离服 25566 的 `imprint-prospect-stage.mjs` 使用真实 Mineflayer 1.20.6 客户端验证：未刻印 24 格找不到 26 格外的密封钻石；镐刻印后范围 32 格并能找到；AuraSkills 挖矿等级设为 25 后 `/mycli status` 显示 42 格；附魔台 54 格菜单刻印剑上治疗术并对受伤者实际治疗；经验与青金石各正确扣减，物品原始同步数据包含 PDC 和说明。`prospecting-stage.mjs` 复测原始区块反透视、无目标不扣魔力、BossBar、粒子和冷却；`focus-outline-stage.mjs` 复测旧法杖、只给施法者的矿物描边和治疗。Java/Agent 使用原版协议；基岩客户端仍须真人核对刻印菜单与手柄“潜行使用”的手感。

正式服仅服务账号在线、无活动试炼时，由现有 S4U 备份任务发布唯一启用的 `AgentFriend-0.3.29.jar`（202965 字节；SHA256 `75883b3ff3da16ab40c8b638f82f5e50b71587ec226a177a0d433df5a4ca4145`）。发布前快照 `20260930-112231`、发布后快照 `20260930-112457` 均完成 E/F 双盘镜像；后者两盘 `.complete` 且都包含 0.3.29。正式服 RCON 版本、Java 状态、Agent LAN 白名单拒绝测试、基岩 Geyser Pong、女神桥和 CortiEyeMirror 均通过。若回退，先确认无人游玩与无活动试炼，正常停服，将 0.3.29 禁用并启用保留的 0.3.28 JAR；物品上的刻印 PDC 不应丢弃，回退期间只是不会施法。

自动恢复收尾：交互终端读取不到 S4U Session 0 网关的命令行，旧 `Start` 因此误报“unexpected process”，而 Watchdog 被旧 `auto-start.paused` 暂停。网关新增只绑定 `127.0.0.1:25577` 的只读进程身份端口；维护脚本优先验证原有进程路径，遇到 Windows 跨会话隐藏路径时要求身份端口与 LAN 监听同 PID、且返回精确 PID。2026-09-30 11:25 通过完整备份重启了新网关，`Start` 标准流程确认服务已运行并清除暂停标记；手动触发 Watchdog 后任务结果为 0、状态 Ready，`Status` 显示 `Auto-start paused: False`、基岩与网关可用。身份端口只在本机，不新增公网映射。旧脚本保留在运行目录 `manage-server.before-gateway-identity-20260930.ps1` 与 `agent-lan-gateway.before-identity-20260930.mjs`。

## 0.3.28 深层试炼塔扩建（2026-09-30）

第七层为休息驿站，第八、九层为扩大后的战斗房，第十层为“深渊守卫”首领房。玩家通关第六层后可在地点罗盘或 `/mycli arena rest` 直达驿站；站内工作台、商人和个人奖励箱均为原版界面。商人菜单与 Mineflayer 的 1.20.6 交易包须在隔离服实测；基岩真机及直播显示另做上线体验验收。第八层起奖励增加，第十层保底专属附魔武器。旧塔下方的自然结构不动，新分区位于 `-510,-305`，楼层之间靠原有自动传送连接。

隔离服 `mycli admin surveydeep` 通过后一次建成四层。`plugins/AgentFriend/dungeon-deep-stage.mjs` 用 Mineflayer 1.20.6 跑通前六层、第七层工位和商人包、第八至十层自动推进、首领血条、保底钻石与个人箱前排的专属武器；`dungeon-rest-stage.mjs` 在冷却和重启后验证罗盘直达、持久检查点及面对面原版商人界面六条交易。商人的普通右键测试需要切开玩家初始背包所在的快捷栏第 1 格，以免背包插件接管交互。最终候选 JAR SHA256 为 `E6B6E3B017DD432A94D9F58376BF69894D6E604489EBAB8BB11212EDFA71C2E8`。

2026-09-30 10:56 在仅服务账号在线、无活动试炼时，现有备份任务生成施工前 `E:\MC\backups\scheduled\20260930-105658` 与同名 F 盘镜像，启用唯一 0.3.28 JAR 并重启。正式服 `mycli admin surveydeep` 再次通过后，执行一次 `mycli admin builddeep`，配置显示 `dungeon-expanded: true` 且再次运行勘察会拒绝覆盖。10:59 的施工后完整备份为 `20260930-105935`，E/F 两处 `.complete` 存在，`world/level.dat`、AgentFriend 配置和 JAR 的 SHA256 两盘一致。上线后 `version AgentFriend`、Paper 状态、Agent LAN 白名单探针、基岩 UDP Pong、Goddess 桥和 CortiEyeMirror 均通过；实际基岩手柄交易与直播画面需玩家体验。`auto-start.paused` 仍存在，Watchdog 暂停，见下方维护说明。

施工命令会拒绝容器、结构、活跃挑战及重复施工；若施工中断，停止使用该区域并从施工前完整备份恢复，不重复覆盖。回退 JAR 时先确认新版本没有活跃挑战；已建深层建筑与玩家检查点应与世界一起保留或一起从备份恢复，不能只删除配置中的 `dungeon-expanded`。

## 0.3.27 遗迹远征发布（2026-09-30）

此版只替换 AgentFriend JAR，不重建世界。新增三处由当前种子定位并在隔离世界实地查看的自然结构，六处遗迹集中在传送罗盘的“遗迹远征”页；15 张公会委托可从原版菜单和 `/mycli` 使用。调查委托只要求抵达中心附近，原生怪物、箱子与探险风险依然属于自然结构。个人奖励箱中排可接收盾牌、铁剑等非固定物品；任务和奖励数据仍保存在 `plugins/AgentFriend/config.yml`，必须随世界一同备份。源码测试为 `plugins/AgentFriend/expedition-expansion-stage.mjs` 和 `dungeon-expeditions-stage.mjs`，隔离服验证了三处新落点与旧三处、任务交付、声望、装备奖励和菜单。回退只需无人游玩时停服，禁用 0.3.27 并重新启用 0.3.26；新增的公会任务记录不应被旧版本破坏，回退前保留完整备份。

2026-09-30 10:12 在仅服务账号在线且无活动试炼时，现有每日备份任务先正常停服并生成 E/F 双盘 `20260930-101252` 快照，两处 `.complete` 均存在。备份完成、启动前一次性启用 `AgentFriend-0.3.27.jar`（193184 字节；SHA256 `af462398ad3c327730910ab05c7db358c65b68c2e767c1d5a0ac9c1713601770`）。重启后 RCON 确认 0.3.27，Agent LAN 白名单探针、基岩 UDP Pong、Paper 状态和女神桥通过；基岩真机与直播画面仍待玩家体验。此前从交互终端直接运行备份时，Windows 不向该终端暴露 Session 0 网关进程的路径/命令行，维护脚本因此拒绝停止未知进程；现有 `Afu-MC-DailyBackup` 计划任务有可验证的运行身份，备份与发布均由它完成。`manage-server.ps1` 新增一次性 `agentfriend-deploy.pending.json` 协议：备份完成后校验候选和旧 JAR 的 SHA256，只保留一个启用版本；失败则恢复旧版本并将标记改为 `.failed`，普通备份没有标记时行为不变。标记不进入备份。直接执行失败留下 `auto-start.paused`，本次自动清理动作被环境审批拦截；服务正常运行，但 Watchdog 需在核查后恢复自动启动。

## 0.3.26 村民交易发布（2026-09-30）

发布范围只有 AgentFriend JAR，不替换世界或第三方插件。新代码给已加载的成年无职业/游手好闲村民分配原版职业，保留有职业者的原版商品及等级；原生 MerchantOffer 调整交易价格和次数，避免 Bukkit 重新编码食物组件导致 Mineflayer 1.20.6 无法解析。各职业新解锁的商品也调整。分配职业和已调整的交易数记录在村民实体持久数据中，必须和世界一起备份。`/mycli admin villagers` 只统计当前已加载的成年村民，适合 RCON 运维检查；远处未加载区块会在加载时处理。

隔离服 25566 使用 `plugins/AgentFriend/villager-trades-stage.mjs` 让 Mineflayer 实际点击新分配职业、屠夫和图书管理员，三种商人菜单均能解析；检查最高绿宝石价不超过 16、其他交付物不超过 24、每条交易至少可用 1024 次。重启后测试村民职业与交易数据持久。最终 JAR 为 `AgentFriend-0.3.26.jar`，193482 字节，SHA256 `d16b07405a046977050afa06a6a7e2f107b8b22992f33726455d1ca826ac16d6`。

在只有 CortiLan、CortiEye、Goddess 服务账号在线且无活动试炼时完成发布；最新发布前快照是 `E:\MC\backups\scheduled\20260930-020045`，F 盘同名镜像，两处 `.complete` 均存在。停服后禁用 0.3.25、放入唯一启用的 0.3.26、核验 SHA256，再正常启动。正式服 RCON 读到 24 位已加载成年村民、无职业 0、无交易 0、最高绿宝石价 16；Paper、Agent LAN 网关、Geyser Pong、Goddess 桥和 CortiEyeMirror 状态正常。自动探针不能代替基岩真机交易界面的目视验收。若需回退代码，先在无真人玩家和活动试炼时正常停服，将 0.3.26 JAR 禁用、启用保留的 0.3.25 JAR，再启动；已分配职业及交易写在世界数据中，单独回退 JAR 不会撤销这些实体变更。

## 变更顺序

1. 对照 [安装内容锁](../manifests/installed-content.lock.json) 和当前服务端文件，确认要修改的源码、配置或第三方版本。AgentFriend 0.3.30 与 CortiEyeMirror 0.1.7 已在正式服运行；0.3.2 是历史源码。
2. 在独立服务端目录及端口构建、测试插件和跨端行为。自研 JAR 不提交 Git；第三方 JAR/数据包从原发布处取得并按哈希核验。
3. 检查没有真人玩家在线，执行 `manage-server.ps1 Backup`。备份会在只有服务账号在线时正常停服约半分钟，写 `.complete` 后重启，再复制到独立 F 盘。若 F 盘镜像失败，可在不重启游戏服的情况下单独执行 `Mirror`。
4. 停服、替换单一启用版本的插件/配置、正常启动；用 Java、基岩、Agent、CortiEye 四条路径复测。不要用 `/reload` 加载新的插件代码。
5. 保存源码修改、版本锁和测试说明到此分支，推送同一分支。运行日志、`server.properties` 实值、`ops.json`、Floodgate 私钥、玩家数据库与世界不提交。

背包界面验收：Minepacks 快捷头颅的 `minecraft:custom_name` 是“大背包”；基岩端接受 Geyser 自动生成的头颅资源包后显示其贴图。CortiEye 的 Fabric SpectatorPlus 客户端应跟随目标打开“大背包”和工作台；目标在自身物品栏点击并徒手合成时，CortiEye 自动打开同步物品栏，最后一次操作 3 秒后关闭。服务端只看到物品栏操作包，无法获知无操作的原版物品栏打开动作；Mineflayer 工具若需在打开时立即出画面，可发送 SpectatorPlus 的 `spectatorplus:opened_inventory_sync` 空载荷插件消息。Mineflayer 的 `item.displayName` 仍是注册表通用名 `Player Head`，物品的真实名称在 `components.custom_name`；Agent 界面应读后者。

需要核验快捷栏第 1 格实际出站数据时，以 OP 身份执行 `/cortieye inspectslot36`，再查 `logs/latest.log` 的 `CortiLan outbound slot36`。此命令让目标玩家重收一次原版物品栏同步包，仅记录 container 0、slot 36 的物品类型、组件名、物品名称和纹理 Base64 长度，不记录纹理正文。2026-09-29 正式服抓到 `ClientboundContainerSetContentPacket`：`player_head`，组件 `minecraft:custom_name` 和 `minecraft:profile`，名称“大背包”，`item_name` 不存在，纹理 1 条、Base64 长度 180。因此网页出现 `Player Head` 应检查客户端对 `components.custom_name` 的解析和显示链。

战斗法术验收：隔离服用同一个 Mineflayer 账号打开罗盘“战斗法术”页并分别咏唱 `starbolt`、`frostnova`、`flamewave`。对无 AI 的僵尸和羊读取施法前后的 `Health`：三招均使僵尸受伤，羊维持 8；无目标提示不耗魔力，重复星芒箭触发冷却；Agent 收到原版 `world_particles` 包。正式服发布后核对 AgentFriend 版本、Java/基岩入口、LAN 网关和 CortiEye 附身；基岩真机粒子外观需由玩家进入游戏亲眼确认。

星芒箭自动锁敌回归：隔离服让 Agent 背对 7 格外僵尸施法，僵尸从 20 降到 15.08，挡在中间的羊仍为 8；第二次立即施法只得到冷却提示。隔墙施法没有目标也不扣血；移除墙、正面瞄准远处僵尸时，优先命中准星目标而不是身后更近的僵尸。Agent 收到 16 个 `world_particles` 包。此逻辑与罗盘按钮及 `/mycli cast starbolt` 共用。

观战状态通道验收：用 Mineflayer 1.20.6 在隔离服以不同名称登录，分别注册 `mcviewer:state` 和旧的 `corti:viewer_state` 并监听原始 `custom_payload`。服务端按每位玩家 UUID 构建完整状态，对每个连接调用 `sendPluginMessage` 发送 `mcviewer:state`；仅注册旧频道的客户端还发送一份旧频道兼容消息。Paper 只向已注册该频道的客户端实际投递，因此新版客户端须注册 `mcviewer:state`；同时注册两个频道时只收到新版。`plugins/AgentFriend/viewer-state-stage.mjs` 以三个账号验证登录首包、独立技能经验、魔力与冷却变化以及 5 秒心跳。负载以 `{` 开头、可直接按 UTF-8 JSON 解析，不加长度前缀；两类列表各不超过 24 项、单包不超过 16384 字节，聊天栏没有 JSON。这个频道只传接收者本人的状态，不镜像目标玩家状态。

0.3.17 发布：最终 JAR 在 25566 隔离服完成三账号新/旧/双频道测试，最大实测 2622 字节；技能经验、魔力、冷却只改变本人负载。2026-09-29 在仅有服务账号在线时备份至 E:\MC\backups\scheduled\20260929-192545 并完成 F 盘镜像，再停服替换唯一启用的 AgentFriend JAR 并正常启动。生产日志确认载入 0.3.17，Agent LAN 白名单探针、Java 状态、Geyser Pong 和 Goddess 桥均通过；基岩真机画面未在本次自动测试中打开。

公会与地下城验收：六层地下城已建成；0.3.19 只扩展原有挑战与个人奖励箱，不覆盖世界结构。`plugins/AgentFriend/guild-stage.mjs` 在 25566 隔离服用两名 Mineflayer 玩家接单、进入第 1–3 层，验证真实怪物死亡事件、同层队伍共享讨伐计数、楼层结算、每日重复交付拒绝、命令和菜单放弃委托、黑铁等级门槛、罗盘原版箱子菜单接单、声望升级与个人奖励箱绿宝石数量。最终候选两次测试均通过，最后一次第 1 层击杀 3 只、第 2 层 4 只，A 声望升至 10（黑铁），B 为 5（青铜），A 箱中绿宝石 8；停服后 `config.yml` 的 `guild-players` 与 `dungeon-rewards` 均保留。公会数据与世界一同备份，不把隔离服玩家记录复制到正式服。Dungeons and Taverns v3.2 已含 `undead_crypt` 刷怪房模板和战利品表，本版不重复注入其自然生成结构。

0.3.19 正式发布：0.3.18 先完成原流程验证并短暂上线；复核发现接高层任务后缺少退出方式，补 `/mycli guild abandon` 与看板红色按钮后重新编译、重新跑双人三层完整验收。最终候选 JAR SHA256 为 `3cccb75797ae0fe4667340f20276fa9d5a6943a9b5c2450f8978cf0782a92d09`。仅服务账号在线时再次完整备份至 `E:\MC\backups\scheduled\20260929-195422`，F 盘镜像完成；停服替换唯一启用的 AgentFriend 0.3.19 JAR 后正常启动。正式服日志确认 0.3.19 与已建六层地下城，Java 状态、Agent LAN 白名单探针、Geyser Pong、Goddess 桥通过。基岩真机手柄看板操作仍待玩家实际体验。

探矿与法杖验收：在隔离服先放密封矿物，再让 Mineflayer 连接并读取原始区块；三个真实矿种应被 Paper mode 1 显示为石头，敲开邻格后真实矿物重新可见。`plugins/AgentFriend/prospecting-stage.mjs` 验证探矿 BossBar、粒子、魔力下降 6、冷却进入状态频道和空搜索不耗资源。`plugins/AgentFriend/focus-outline-stage.mjs` 以两个 Java 协议账号验证：施法者潜行使用法杖选钻石、单次使用施法，只有施法者收到发光方块展示实体（元数据 Glowing 位为 64）和墙面光框，旁观者收不到，矿块消失即清除；换绑治疗后单次使用能恢复生命。正式服重启后核对 `world/paper-world.yml` 与 `world_nether/paper-world.yml` 的反透视配置、Java/基岩入口和 MSPT。基岩版没有 Java Glowing 效果，使用墙面粒子和 BossBar；真机视觉及手柄操作由玩家复核。

探索法术与村庄验收：`plugins/AgentFriend/utility-spells-stage.mjs` 用无 OP 玩家验证法杖绑定跃空后单键起跳、飞行能力包与 15 秒到期收回、探敌 BossBar、守护铁傀儡击败尸壳且不伤羊，并从各玩家自己的 `mcviewer:state` 读取冷却。`plugins/AgentFriend/village-safety-stage.mjs` 在现有 `afu_house_02` 内以无 OP 玩家确认短草可清、地基不能拆，村民受玩家攻击仍 20 血；村庄室外的羊从 8 血降至 7 血。隔离服 WorldGuard 区域配置必须先从正式服当前 `regions.yml` 同步，旧副本的 `damage-animals: deny` 会给出假失败。2026-09-29 发布前已在无人类玩家在线时完成停服备份 `E:\MC\backups\scheduled\20260929-150855` 和 F 盘镜像，替换唯一启用的 AgentFriend 0.3.14 JAR 与两份 Paper 反透视配置，正常重启；插件版本、Java 状态、Geyser Pong 和 Agent LAN 白名单探针通过。基岩真机飞行及手柄操作须由玩家亲测。

Agent 文字指令验收：0.3.15 的同一隔离测试先读取 `/mycli help`、`/mycli spells` 和 `/mycli focus list`，确认世界名称、四种探索法术英文 ID 与法杖绑定 ID 均可从聊天响应直接获得，然后执行 `/mycli focus bind leap` 和使用物品动作。2026-09-29 在无人类玩家在线时备份至 `E:\MC\backups\scheduled\20260929-172947`，完成 F 盘镜像后仅替换 AgentFriend 0.3.15 JAR，正常重启；无需调整现有世界与反透视配置。

村庄建筑保护验收：0.3.16 在隔离服把 23 个 `afu_house_*` 的 `passthrough` 改为 `allow` 后，无 OP Mineflayer 在房屋保护框内完成放泥土、拆自己放的泥土、拆树叶；原房屋的云杉墙体无法拆，村民血量保持 20，羊可受到攻击。AgentFriend 第一次启动将原建筑坐标与材料保存为 `plugins/AgentFriend/village-structure-mask.tsv`，第二次启动从同一世界 UUID 的快照恢复，原有保护数均为 8096。此文件属于世界运行数据，**必须跟随存档备份**；不要把隔离服快照复制到正式服，换世界/改变房屋范围前先核对并重建。加载失败时插件会在村庄范围内拒绝改块。正式服在零真人玩家时先备份至 `E:\MC\backups\scheduled\20260929-181237` 并镜像 F 盘，再替换单一 AgentFriend 0.3.16 JAR 与 WorldGuard 区域配置，正常启动；日志确认 23 栋、8096 个原建筑方块成功捕获。随后完整停服快照 `20260929-181602` 已在 E/F 两盘带 `.complete` 保存，均包含结构快照文件；此快照是 0.3.16 的优先恢复点。再次启动仍读回 8096 个保护块，Agent LAN 白名单探针和基岩 Pong 通过。

## 0.3.20 公会大厅发布与恢复点

隔离服 `guild-hall-stage.mjs` 用无 OP Mineflayer 1.20.6 验证原版任务牌、27 格菜单接单、`/mycli guild hall` 传送、地板防拆和重复施工拒绝；停服重启后同一测试再次通过。正式服现场 `surveyguild -489 -502` 返回地板 Y=66、仅 1 格树干与 42 格树叶，无原房屋或道路冲突。仅服务账号在线时先做 E/F 双盘备份 `20260929-201735`，停服替换唯一启用 JAR 为 AgentFriend 0.3.20（SHA256 `B6E15E8361A4072531355744642FCC97B2357A5967A618797D1C81C5C4C9E95A`），再用控制台/RCON 一次性执行 `mycli admin buildguild -489 -502`。正式大厅中心 `-489,66,-502`；主任务牌在 `-486,68,-495`。构建记录 960 个原版结构方块，写入 `plugins/AgentFriend/guild-hall-mask.tsv`，和世界 UUID 对应。重复建造被拒绝。

建成后又做完整备份 `20260929-202045`，E/F 两份均有 `.complete`、0.3.20 JAR 和大厅保护快照。备份引起的重启成功，日志无公会快照错误，原版任务牌仍在；Java 状态、LAN 网关白名单探针、基岩 Pong、Goddess 桥和 CortiEyeMirror 均通过。基岩手柄右键任务牌的真实画面仍由玩家入服确认。`guild-hall-mask.tsv` 必须和同一世界存档一起恢复，不要单独替换或删除；要回到施工前状态，使用 `20260929-201735` 整套快照并意识到之后的玩家进度也会回退。仅回退 JAR 不会拆除建筑，不应直接降到不认识公会大厅的旧版后继续长期运行。

## 0.3.21 试炼场步行道路

施工蓝图在 `plugins/AgentFriend/resources/trial-road.tsv`。隔离服中 `/mycli admin surveyroad` 对现有 23 栋村庄建筑、头顶空间、原方块材质、桥墩落点和在场玩家做预检；然后一次性执行 `buildroad`。村庄出生点 `-543.5,66,-439.5` 到道路起点 `-570,63,-411`，再到试炼场北入口 `-590,90,-329`，普通 Mineflayer 不挖方块即可全程步行。构建约 312 格三格宽路面，水面为云杉栈道，山坡为石砖阶梯，另有 142 格护栏位置、落到河床的云杉桥墩和路灯。最终候选 JAR SHA256 为 `CA2D8C124B0A4F3B684D7A54CE6A5B54B7ADE9FD48FFD849F8B329CC02703BFB`。隔离服重建后记录 671 个受保护方块，其中 21 个是桥墩木；`plugins/AgentFriend/trial-road-stage.mjs` 用新 Mineflayer 账号从出生点走至入口、不挖方块，并试挖栈道及安全区外阶梯，两处都被插件拒绝。Geyser 隔离服 Pong 正常。原版 Java、基岩和 Agent 无须新增客户端资源。

正式施工仅在没有真人在线时进行：先运行 `manage-server.ps1 Backup` 并确认 E/F 两盘 `.complete`，再正常停服替换唯一启用的 AgentFriend JAR；启动后运行 `mycli admin surveyroad`，结果允许施工才运行一次 `mycli admin buildroad`。施工一旦中断，保留现场并恢复施工前完整世界备份，不删除 `trial-road.building` 标记硬重试。施工完成后再做一次 E/F 完整备份和重启检查。`plugins/AgentFriend/trial-road-mask.tsv` 与世界 UUID 绑定，必须与世界文件一起恢复；仅回退 JAR 不会拆除道路，也会失去道路的保护逻辑。

2026-09-29 正式发布：`.MicroKQ` 下线后，先在 E/F 两盘生成施工前完整快照 `20260929-213910`；正常停服，把 0.3.20 JAR 设为 disabled，仅启用 SHA256 `CA2D8C124B0A4F3B684D7A54CE6A5B54B7ADE9FD48FFD849F8B329CC02703BFB` 的 0.3.21。正式世界 `surveyroad` 通过后执行一次 `buildroad`，保护快照记录 671 个方块，其中云杉桥墩木 21 个。建成后的 E/F 完整快照为 `20260929-214136`，重启后日志再次读回 671 个方块。Java 状态、Agent LAN 白名单探针、Geyser Pong、Goddess 桥和 CortiEyeMirror 加载均通过；基岩真机走路观感需玩家入服查看。要回到施工前世界，使用 `20260929-213910` 的整套快照，意识到之后的玩家进度会一起回退。

## 0.3.22 咏唱画面和观战特效

AgentFriend 在施法实际生效后向施法者发送原版标题、副标题、少量粒子和音效。归乡术只有成功到达村庄后才显示“空间之力，护你归途”；冷却、魔力不足、缺少目标不会播放成功效果。Agent 仍能读取原有聊天结果。CortiEyeMirror 0.1.7 在附身时同步目标收到的标题、声音和世界粒子包，并限制世界特效转发为每秒最多 128 包。隔离服 25566 的 `spell-presentation-stage.mjs` 测得归乡、自疗、星尘均有标题/声音/粒子包，冷却重试不再出标题；`spell-presentation-camera-stage.mjs` 的真实附身关系测得目标和观战者都收到三类包。旧 `utility-spells-stage.mjs` 仍使用过期的 `317,119,17` 高空测试点，在当前隔离世界落至 Y=50，跃空用例因此未通过，需更新地形夹具后才能重跑，不作为本次功能验收证据。

2026-09-29 正式发布：仅 CortiLan、CortiEye、Goddess 服务账号在线时生成 E/F 完整快照 `20260929-220753`，两盘 `.complete` 均存在。正常停服，将旧 AgentFriend 0.3.21 与 CortiEyeMirror 0.1.6 设为 disabled，只启用 0.3.22（SHA256 `BB3BAAED18ED967AEE4AFF3F9C31E4B8BD2884C33C023F6C1C2A4123507A2B8C`）及 0.1.7（最终 SHA256 `7D5912AD12D37070B2D3ECC3E36AAAFC9D334C49E7F52E20F7DE81A3596B4C9E`）。首次启动发现 ProtocolLib 对不存在的 `CUSTOM_SOUND_EFFECT` 包发出注册警告；删除该多余监听后，隔离服以最终 JAR 重新验证附身画面三类数据包，再替换正式服 0.1.7 JAR，未改世界。最终重启后 RCON 版本、Java 入口、LAN 网关白名单探针、Geyser Pong、Goddess 桥和道路/房屋保护快照均正常，启动日志无上述警告；CortiEye 真实直播观感仍需在开播时目视验收。回退这次代码只需无人游玩时正常停服、禁用两个新 JAR、启用对应旧 JAR 后启动；不需恢复整个世界而丢失玩家进度。

## 0.3.25 地下城死亡领奖指引

试炼中死亡的玩家会立刻收到原版聊天指引；复活后再次收到聊天和标题。指引区分已通关奖励与尚未结算的当前层：已有奖励保存在按 UUID 隔离的个人箱，不会在死亡地点掉落；未通关的楼层不产出奖励。玩家可走到地面入口箱 `(-594, 91, -313)`，Agent 可执行 `/mycli arena rewards` 打开同一份奖励。死亡后断线，待发提示写入 `plugins/AgentFriend/config.yml` 的 `dungeon-death-guide`，重登后补发并清除。已有奖励仍存于原 `dungeon-rewards`、`dungeon-bonus-items`，此次不迁移物品或世界结构。

隔离服 25566 的 `dungeon-death-guide-stage.mjs` 用两个 Mineflayer 账号验证首层未结算死亡与通关首层后在第二层死亡两条路径；两种提示、复活后补发、入口箱坐标、命令及已结算铁锭/随机奖励均通过。正式发布前需确认无人类玩家在线、无活动试炼，再按本文件流程完成 E/F 双盘备份、正常停服和唯一启用 JAR 替换；发布后核对 Java、基岩、Agent 网关及 Goddess/观战服务。

2026-09-29 正式发布：CortiLan 六层试炼结束、`dungeon-active-run` 清空后，确认仅服务账号在线；正常停服快照 `20260929-235745` 在 E/F 两盘均有 `.complete`，随后正常停服并只启用 AgentFriend 0.3.25（184365 字节，SHA256 `496F232BF26D43722DF41B0795F5E9ED701E61EDA431B85E52EB1F0565FC4FD9`）。重启后 RCON 读到插件 0.3.25、六层加载成功；Java 状态、Agent LAN 网关拒绝未授权账号、Geyser 基岩 Pong、Goddess 桥与 CortiEyeMirror 插件加载均通过。原生 CortiEye 观战插件会在观察者客户端下次登录时附身；维护脚本的旧 watcher 因原生插件已加载而保持停止。回退须在无活动试炼时正常停服，把 0.3.25 设为 disabled 并启用 0.3.24；奖励和死亡提示配置必须与世界一起保留，不要用旧备份覆盖新进度。

## 0.3.24 地下城断线续打

原实现于 2026-09-29 23:14:43 在 CortiLan 与 CortiEye 同时显示 `Disconnected` 后，当秒把第二层判为失败；CortiLan 于 23:14:52 重连，但队伍已清空。日志足以证明不能续打的服务端原因，尚不能证明最初两条连接为何同时断开。第一、二层的已结算奖励仍在各自个人箱中。

新版在所有参赛者离线时暂停当前层、怪物波次和自动下楼计时，最多保留 10 分钟；同 UUID 重连自动返回当前层。队友仍在挑战时，掉线玩家重连进入队伍已到的楼层，错过的楼层不补发奖励。暂停前未通关的当前层重开完整怪物波次；已通关的层不重新结算。正常停服时把 `dungeon-active-run` 检查点与原有奖励一起写在 `plugins/AgentFriend/config.yml`，重启后仍按原宽限期等待；过期则结束并启动常规冷却。插件启动与暂停时明确加载试炼房四个区块再清理带标签旧怪，防止卸载的旧波次与重试波次叠加。主动返回地面和死亡照常退出。**恢复整个世界时必须连同 `config.yml` 一起恢复**；单独回退到 0.3.23 不能识别活动检查点，必须等队伍退出后再回退。

隔离服 25566：`dungeon-reconnect-stage.mjs` 通过倒计时中断线与战斗中断线两条路径；`dungeon-party-reconnect-stage.mjs` 通过队友继续下楼、迟归成员回到当前层且无离线奖励；`dungeon-restart-stage.mjs prepare|verify` 在真实 JVM 停启前后通过检查点、倒计时和不重复发奖。最终 JAR `AgentFriend-0.3.24.jar` 为 183526 字节，SHA256 `DF865EB830B2E6F3CD5A430754765F99EB89F6F659C291435131131D769AE795`。基岩真机的断网重登体验仍需用户入服核对。

2026-09-29 23:39 在无人类玩家在线、无活动试炼时，正常停服备份至 `20260929-233951`，E/F 两盘 `.complete` 均存在。随后把唯一启用的 AgentFriend 0.3.23 JAR 设为 disabled，复制并校验上述 0.3.24 JAR，正常启动。正式服 RCON 确认新版本和六层载入；Paper、Agent LAN 网关、Geyser Pong、Goddess 桥和 CortiEyeMirror 状态正常，Agent LAN 白名单探针通过。回退代码须在无活动试炼时正常停服、禁用 0.3.24、启用 0.3.23 再启动；0.3.23 不认识 `dungeon-active-run`，不能用于续打新版本的活动挑战。

## 0.3.23 地下城自动推进与远征

发布范围只有 AgentFriend JAR。六层试炼现从入口按钮附近取最多 12 格内队伍；每层清怪后等待 10 秒，幸存且仍在该层的队员自动下楼并补满生命。第六层结算后不再下楼。旧绿色按钮只提示状态，旧路牌在插件启动时按原文案自动更新。奖励由原有固定物资和新增独立随机物品组成，均留在个人箱子；`dungeon-bonus-items` 与 `dungeon-rare-misses` 存在 `plugins/AgentFriend/config.yml`，不能只恢复世界而丢失该配置。公会菜单扩为 36 格、12 项；遗迹远征只使用现有世界中已生成的 Dungeons and Taverns 结构，安全落点约距中心 70 格。若更换世界种子，`DungeonExpeditions.java` 的三处坐标必须重新勘察，不能沿用。

隔离服 25566 验证：`dungeon-flow-stage.mjs` 测双人入场、远处排除、清怪 10 秒自动下楼、12→20 血、个人奖励及组队/领箱任务；`dungeon-six-floor-stage.mjs` 测六层完整推进与稀有保底；`guild-stage.mjs` 测旧任务接取、结算、声望与日限；`dungeon-expeditions-stage.mjs` 测三处遗迹落点与调查委托；`dungeon-loot-persistence-stage.mjs` 在重启后核对随机物品 `custom_name`、`lore`、`enchantments` 和配置持久化。最终 JAR 为 `AgentFriend-0.3.23.jar`，181252 字节，SHA256 `7BB79464481347A964A33C3AE77EDE81E26621C12FE1D4B643F9252099DFDB49`。隔离服最终启动还查到第一层旧指示牌已更新为“自动下楼 / 清怪后等待 / 10秒 / 无需按键”。

2026-09-29 22:53 在仅服务账号在线时完整备份 `20260929-225357`，E/F 两盘 `.complete` 均存在。随后正常停服，将 0.3.22 JAR 设为 disabled、复制唯一启用的 0.3.23 JAR，并正常启动。正式服 RCON 确认 AgentFriend 0.3.23、六层初始化，`Status` 确认 Paper、Agent LAN 网关、基岩 Geyser、Goddess 桥及 CortiEyeMirror 正常；Agent 网关白名单探针和基岩 Pong 通过。若要回退插件代码，在无人游玩时停服、禁用 0.3.23 JAR、启用 0.3.22 JAR 再启动；不要删 0.3.23 写入的奖励配置。若需恢复整套进度，使用上述 E/F `.complete` 快照，但会失去快照之后的玩家进度。基岩手柄界面与真人战斗仍待入服目视验收。

## 当前自动恢复

`Afu-MC-Watchdog` 开机及每分钟执行：验证 Java/RCON、Agent 网关、女神单实例、观战绑定和基岩 Pong。基岩连续三次失败，且无人类玩家在线时，才尝试一次完整重启；持续故障不会每分钟或每半小时重启。自动启动暂停标志用于计划停服。`Afu-MC-DailyBackup` 每天 04:00 尝试快照；在线名单中出现真人或读取异常时跳过。

## 恢复

备份目录为 `E:\MC\backups\scheduled\<时间>` 和 `F:\MC-backups\scheduled\<时间>`。只选择带 `.complete` 的快照；F 盘镜像在校验后才写此标记。先停服，把现有服务端目录另存，再从同一快照恢复 `server/`；管理脚本损坏时，还原该快照的 `ops/`、`probe/`、`root/`。恢复世界会舍弃快照之后的进度，因此需要保留事故现场副本。异盘快照能应对 E 盘故障，不能应对整机损毁。

## 公网与身份边界

Paper 使用离线模式供本机 Mineflayer 与 Floodgate 连接，所以 Java 后端必须继续绑定回环。局域网 Agent 网关只接受可信来源，并拒绝 OP 名称；公网 Java 接入需要单独的身份验证入口。基岩由 Geyser/Floodgate 接入，服务端白名单仍开启。不要把 `rcon.port`、Floodgate 密钥或未验证身份的 Java 端口直接发布到公网。
