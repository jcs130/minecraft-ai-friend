# Paper 分支维护与发布

此文档描述源码分支与当前 Windows 家服的关系。仓库是代码及配置基线；正式存档和玩家状态只保存在 `E:\MC\server` 以及已校验备份中。完整本机维护记录仍在 `E:\MC\ops\MAINTENANCE.md`。

## 日常检查

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\MC\ops\manage-server.ps1 Status
node E:\MC\probe\rcon.mjs mspt
node E:\MC\probe\agent-lan-smoke.mjs
node E:\MC\bedrock-ping.mjs 192.168.3.163 19132
```

`Status` 应同时显示 Paper、Agent 网关、Geyser Pong、Goddess 桥、CortiEyeMirror、最近 E 盘快照及 F 盘镜像。Pong 和状态包不是基岩真机、Agent 具体动作或直播画面的端到端验收。

## 变更顺序

1. 对照 [安装内容锁](../manifests/installed-content.lock.json) 和当前服务端文件，确认要修改的源码、配置或第三方版本。AgentFriend 0.3.20 已在正式服运行；0.3.2 是回滚用历史源码。
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

## 当前自动恢复

`Afu-MC-Watchdog` 开机及每分钟执行：验证 Java/RCON、Agent 网关、女神单实例、观战绑定和基岩 Pong。基岩连续三次失败，且无人类玩家在线时，才尝试一次完整重启；持续故障不会每分钟或每半小时重启。自动启动暂停标志用于计划停服。`Afu-MC-DailyBackup` 每天 04:00 尝试快照；在线名单中出现真人或读取异常时跳过。

## 恢复

备份目录为 `E:\MC\backups\scheduled\<时间>` 和 `F:\MC-backups\scheduled\<时间>`。只选择带 `.complete` 的快照；F 盘镜像在校验后才写此标记。先停服，把现有服务端目录另存，再从同一快照恢复 `server/`；管理脚本损坏时，还原该快照的 `ops/`、`probe/`、`root/`。恢复世界会舍弃快照之后的进度，因此需要保留事故现场副本。异盘快照能应对 E 盘故障，不能应对整机损毁。

## 公网与身份边界

Paper 使用离线模式供本机 Mineflayer 与 Floodgate 连接，所以 Java 后端必须继续绑定回环。局域网 Agent 网关只接受可信来源，并拒绝 OP 名称；公网 Java 接入需要单独的身份验证入口。基岩由 Geyser/Floodgate 接入，服务端白名单仍开启。不要把 `rcon.port`、Floodgate 密钥或未验证身份的 Java 端口直接发布到公网。
