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
| MagicSpells | `mana.yml` 关闭独立魔力池 | AuraSkills 是唯一魔力来源；插件负责效果与冷却 |
| Minepacks | `DropOnDeath=false`、`HonorKeepInventoryOnDeath=true`、`OpenContainerOnRightClick=true`、`MaxSize=6`；快捷物品和窗口名为“大背包” | 死亡保留背包、奖励箱与背包快捷物品交互；局部覆盖见 `Minepacks/backpack-overrides.yml` |
| Geyser 自定义头颅 | `enable-custom-content=true`、`force-resource-packs=true`，映射见 `Geyser-Spigot/custom_mappings/qiandengji-backpack.json` | 让基岩背包栏把 Minepacks 的专属头颅纹理显示成背包 |
| EssentialsX | `disabled-commands` 含 `msg` | 原版私聊格式供 Goddess 桥接识别 |
| 造物术缺项申请 | `/mycli cast give <其他物品>` 或罗盘“申请更多物品” | Goddess 审核；OP 账号发放时校验原版物品、数量和背包空间 |
| WorldGuard | `afu_village` 室外允许 `damage-animals`，房屋子区域拒绝改块 | 村庄建筑安全，同时可采集、养殖和冒险 |
| CortiEyeMirror | `target=CortiLan`、`camera=CortiEye`、镜头夜视、私聊/成就同步、额外生命 BossBar 关闭、徒手合成物品栏随操作显示 | 真实 Java 客户端直播画面 |

世界规则还包括 `keepInventory=true`、`playersSleepingPercentage=1`、`doFireTick=false`，出生点在村庄附近，难度简单。它们存于世界数据，必须用存档备份或服务端命令重建；Git 不包含实时世界。

Minepacks 的快捷物品虽然使用原版 `player_head` 作为载体，但有自己的名称和贴图。不要把所有 `player_head` 翻译成“大背包”。变更 `ItemShortcut.ItemName` 后，旧物品需要在玩家下次进服时由 AgentFriend 迁移，避免产生失效快捷物品和重复头颅。Geyser 的头颅映射在启动时生成基岩资源包；改动后应在基岩客户端重新进服验收纹理与名称。
