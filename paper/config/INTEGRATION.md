# 当前关键配置

这些是生产服的配置意图。仓库中的 `server.properties.example` 需要在本机设置独立 RCON 口令；`paper-global.yml`、MagicSpells 文件、WorldGuard 区域与公共 warp 是 2026-09-29 的无口令快照。WorldGuard 区域坐标及传送落点绑定当前世界，不能原样应用到别的种子。

| 组件 | 当前设置 | 原因 |
| --- | --- | --- |
| Paper | `online-mode=false`、`server-ip=127.0.0.1`、`white-list=true` | 本机 Mineflayer 与 Floodgate 连接；不允许未认证 Java 公网直连 |
| RCON | `127.0.0.1:25575`，本机随机口令 | 正常保存/停服与管理；口令不入 Git |
| Geyser | `bedrock.address=0.0.0.0`、`bedrock.port=19132`、`auth-type=floodgate`、服务名千灯纪 | 基岩国际版进入同一 Paper 世界 |
| Floodgate | 名称前缀 `.`，使用本机 `key.pem` | 基岩身份与普通 Java 名称分开；私钥不入 Git |
| ViaVersion / ViaBackwards | 当前锁定版本见清单 | Geyser 提供的 Java 协议版本与 Paper 1.20.6 之间的转换 |
| Paper 包速率 | 全局 `DROP`、每秒上限 500 | 超限丢包，降低基岩手柄偶发操作被踢概率 |
| Paper Timings | `enabled: false` | 保留 Spark 按需性能分析 |
| 法术 | MagicSpells 的 `mana.yml` 关闭独立魔力池；AgentFriend 提供星芒箭、霜环、焰浪 | AuraSkills 是唯一魔力来源；战斗法术仅伤敌对生物，粒子用原版协议，不改地形 |
| Minepacks | `DropOnDeath=false`、`HonorKeepInventoryOnDeath=true`、`OpenContainerOnRightClick=true`、`MaxSize=6`；快捷物品和窗口名为“大背包” | 死亡保留背包、奖励箱与背包快捷物品交互；局部覆盖见 `Minepacks/backpack-overrides.yml` |
| Geyser 自定义头颅 | `enable-custom-content=true`、`force-resource-packs=true`，映射见 `Geyser-Spigot/custom_mappings/qiandengji-backpack.json` | 让基岩背包栏把 Minepacks 的专属头颅纹理显示成背包 |
| EssentialsX | `disabled-commands` 含 `msg` | 原版私聊格式供 Goddess 桥接识别 |
| 造物术缺项申请 | `/mycli cast give <其他物品>` 或罗盘“申请更多物品” | Goddess 审核；OP 账号发放时校验原版物品、数量和背包空间 |
| WorldGuard | `afu_village` 室外允许 `damage-animals`，房屋子区域拒绝改块 | 村庄建筑安全，同时可采集、养殖和冒险 |
| CortiEyeMirror | `target=CortiLan`、`camera=CortiEye`、镜头夜视、私聊/成就同步、额外生命 BossBar 关闭、徒手合成物品栏随操作显示 | 真实 Java 客户端直播画面 |
| AgentFriend 状态通道 | 向每个在线玩家分别发出自己的 `mcviewer:state` 原始 UTF-8 JSON | Java/Agent/直播客户端获得对应玩家的 AuraSkills 魔力、当前等级经验和法术冷却状态 |
| Paper 反透视（待发布） | 主世界和下界分别合入 `anti-xray-overworld.yml` / `anti-xray-nether.yml`，mode 1 | 密封矿石向客户端表现为石头；不制造假矿；服务端探矿术按真实方块判定 |

世界规则还包括 `keepInventory=true`、`playersSleepingPercentage=1`、`doFireTick=false`，出生点在村庄附近，难度简单。它们存于世界数据，必须用存档备份或服务端命令重建；Git 不包含实时世界。

Minepacks 的快捷物品虽然使用原版 `player_head` 作为载体，但有自己的名称和贴图。不要把所有 `player_head` 翻译成“大背包”。变更 `ItemShortcut.ItemName` 后，旧物品需要在玩家下次进服时由 AgentFriend 迁移，避免产生失效快捷物品和重复头颅。Geyser 的头颅映射在启动时生成基岩资源包；改动后应在基岩客户端重新进服验收纹理与名称。

战斗法术从技能罗盘的“战斗法术”页选择，Agent/Java 玩家也能输入 `/mycli cast starbolt|frostnova|flamewave`。星芒箭瞬发，优先命中准星 18 格内的怪物；没有瞄准时自动锁定 12 格内最近的可见怪物（4 魔力、3 秒冷却）。霜环打击身边最多 4 只怪物并减速（7 魔力、14 秒）；焰浪打击前方最多 4 只怪物并点燃（8 魔力、10 秒）。没找到目标不耗蓝；法术只用服务端粒子、音效、伤害与状态效果，不发送自定义物品或要求客户端装模组。Geyser 当前安装包内的 `particles.json` 为使用的 `END_ROD`、`ELECTRIC_SPARK`、`CRIT`、`SNOWFLAKE`、`CLOUD`、`FLAME` 都提供了基岩映射。

`mcviewer:state` 对每名在线玩家按 UUID 读取并发送其自身数据，使用 `Player.sendPluginMessage` 原始字节（没有 `writeUTF` 或额外长度前缀）。入服、客户端注册频道、数值变化以及每 5 秒都会发送；Mineflayer 客户端应在 play 阶段用 `minecraft:register` 声明 `mcviewer:state`。仍只声明旧 `corti:viewer_state` 的运行中客户端会在旧频道收到同样数据；同时声明两者时只在新频道收到一份。单包最多 16384 字节，`skills` 和 `abilities` 各最多 24 项。`mana` 是 AuraSkills 的当前/最大值；`skills[].xp` 是当前等级内进度，`requiredXp` 是下一等级所需值。已解锁的 AuraSkills 能力会列出；无法可靠取得其冷却时 `cooldownMs:null`。已掌握的 MagicSpells 法术以 `magicspells:` ID 列在 `abilities` 中，等级为 1，剩余冷却取插件接口返回的秒数换算为毫秒。`/mycli` 三种战斗法术使用实际剩余冷却毫秒数。未加载的 AuraSkills 用户发 `mana:null`、`skills:[]`。此 JSON 不进入游戏聊天栏。基岩客户端是否消费这个 Java plugin channel 取决于 Geyser/客户端实现，玩法本身不依赖该频道。
