# Paper 1.21.1 升级候选

2026-10-15：服主指定升级服务器核心。候选已完成隔离验证；**正式仍为 Paper 1.20.6 / AgentFriend 0.4.40 / Eye 0.1.15 / LoginGuard 0.1.1**，没有登记正式待发布计划或重启。正式切换仍需当次确认。

## 固定组件

| 组件 | 候选 | 适配内容 |
| --- | --- | --- |
| Paper | 1.21.1 build 133，Java 21 | 原生协议 767、DataVersion 3955 |
| AgentFriend | 0.4.41 | ResourceLocation 构造器、村民职业注册表；保留玩法与 CLI |
| CortiEyeMirror | 0.1.16 | 按新 API/NMS 构建，原配对与观战协议保持 |
| WorldGuard | 7.0.12 | 官方 1.21/1.21.1 构建，保留领地规则 |
| Citizens | 2.0.35 b3592 | 含 v1_21_R1；现役 b4013 不含该实现 |
| Denizen | 1.3.1 b7074，限定兼容修正 | 修正 CraftMagicNumbers.INSTANCE 字段描述符，保留映射指纹校验与方法字节码 |
| SpectatorPlus | Paper 1.2.1 | 旧 1.2.0 背包点击时因 InventoryView 改为接口而报错 |
| LoginGuard | 0.1.2 | 首次免密码授权晚于切服时补交一次准确成功通知 |

其余插件、现役 LibreLogin 双监听器补丁、YSM Worker、Freesia、Geyser 和 ViaVersion/ViaBackwards 保持。`-Dpaper.preferSparkPlugin=true` 使用现役 spark 1.10.187。

EssentialsX 2.22.0 已启用，原私聊与现役调用经过隔离检查；**上游不再支持 1.21.1，保留 unsupported 警告**，不冒称全部 Essentials 命令均已验收。

来源：[Paper 构建 API](https://fill.papermc.io/v3/projects/paper/versions/1.21.1/builds)、[WorldGuard](https://modrinth.com/plugin/worldguard/version/J66QOTLZ)、[Citizens](https://ci.citizensnpcs.co/job/Citizens2/3592/)、[Denizen](https://ci.citizensnpcs.co/job/Denizen_Developmental/7074/)、[SpectatorPlus](https://modrinth.com/plugin/spectatorplus/version/gglfSgWS)、[Paper spark 选择](https://docs.papermc.io/paper/profiling/)。摘要见[候选清单](../manifests/paper-1.21.1-candidate-20261015.json)，不提交第三方 JAR/ZIP、世界或私有回执。

## 数据与客户端

9 个数据包保留原文件名、命名空间、内容 ID。8 个转换至格式 48，Explorify 已含跨版本资源，原 ZIP 保持。合并格式 41 实际启用的 overlays，迁移单数资源目录和已知战利品字段：2937 个路径、73 份 JSON 有逐项记录，结构 NBT 字节保持。原生新核心已加载全部原世界与数据包，没有覆盖村庄或重建建筑。

旧插件 YAML 中 5 份盾牌的 `TILE_ENTITY` 元数据被新核心拒绝。发布时从**刚停服的最新配置**准备 `SHIELD` 类型转换，保留名称、故事、附魔和自定义值；不拿旧候选配置覆盖新进度。遇到未支持的内嵌旗帜/方块状态立即中止。原生世界、玩家和 Minepacks NBT 由 Minecraft DataFixer 处理。

隔离回读：26 份原背包 BLOB/版本一致；公会、奖励、技能账本、领地、传送点和三维度 UUID 保留；5 份盾牌原生加载后元数据一致。ItemStack 的 `v:3839→3955` 为版本标记迁移。测试世界来自完整冷备份 20261014-182425，正式切换必须另做最新完整冷备份。

- **现有 Agent 和相机保持 1.20.6 协议，经 ViaBackwards 接入新核心**，不用同步更改远端客户端。原私聊、CLI、物品、模型与 Eye 协议实测保持。
- 相机用现役 1.20.6 渲染资源实际拍出 1536×1536 照片，169 区块完成网格，鸣人 YSM/手持物及四张海报地图实收；普通皮肤也通过真实玩家列表检查。
- 本次未修改共享 Web 源码或另一台电脑的宿主。**不可只改成原生 1.21.1 连接、继续套用硬编码的 1.20.6 状态/资源表**；原生 1.21.1 Web 资源重建另行迁移，现有消费链已验。
- Geyser 启用且实际 UDP Pong 正常，物品资源包与映射保持。自签名基岩探针被现有 Xbox 校验拒绝，未放宽认证；手机/Xbox真实登录和像素未验。现役 Bedrock YSM 的 `YSM_BEDROCK_SOURCE_REVISION_UNAVAILABLE` 仍是独立限制。

## 验证记录

| 范围 | 结果 |
| --- | --- |
| 数据包 / Denizen / 旧盾牌 | 8 / 5 / 5 个回归测试；Denizen 其余1890条目不变 |
| 维护事务 | Windows PowerShell 5.1 下36项；完整候选影子事务43项、5份盾牌；失败恢复不完整时阻止启动 |
| 登录组件 | 通知8、观察11、首次密码8、正版/Eye21；并发初始化与通知去重 |
| 新旧 Java 连接 / 背包 | 各17项基础联机、各11项存入/重开/取回，核对光标与数量 |
| 登录、YSM、皮肤、Eye、私聊、剧情 | 最终冷启动后22项实际连接 |
| 相机 | 7项实际 WebGL、资源与游戏海报检查 |
| 地下城与群疗 | 实际治疗/三室清场9项；实际奖励读取与去重7项 |
| 冷启动回读 | 11项：31原插件、三维度普通/keepInventory、奖励、交易职业、Aura补丁、旧映射缓存失效 |
| 16受控连接 | 3项；8个旧协议+8个新协议共址查询，5秒平均10.6ms，热启动窗口有104.2ms单tick峰值 |

16连接不是16个LLM长期自主探索/施工压测。早期失败回执保留：Denizen接口、SpectatorPlus接口、旧盾牌、漏发登录成功，以及探针漏配方补丁/频道订阅、村庄免伤、新角色未学储物技能等夹具问题。不得改写失败报告为成功。

## 正式发布与回退

1. 服主当次确认，180/60/10秒中文预告；真人退出、活动副本结束。鸣人只按已确认的 `ag_NarutoPi` 精确登记，不泛化 `ag_*`。
2. 核对冻结包和原静态文件摘要，保存旧维护代码，安装候选维护助手。**此时才**登记批准的 `paper-core-upgrade.pending.json`，不提前排队，不同时登记其他部署。
3. 复用 Afu-MC-DailyBackup 正常停 Paper/网关/代理/Worker；完整备份世界、plugins、配置、认证/YSM到E/F，两份验证完成再替换。
4. 预检所有摘要、准备最新盾牌数据迁移、执行可恢复事务，再由原流程启动；回读版本、插件、UUID、登录/观战、存档和入口，发简短更新说明。

启动新核心前的文件事务失败可恢复旧文件；恢复不完整则保留自动启动暂停。**新核心一旦写入世界，不能仅换回旧 JAR 降级**。停服保留现场，服主确认后从同一升级前完整快照恢复世界、plugins、配置、认证/YSM及旧维护代码；会失去快照后进度。遵循[Paper 更新说明](https://docs.papermc.io/paper/updating/)及[维护流程](OPERATIONS.md)。

私有候选：`E:/MC/research/paper-1.21.1-audit-20261015`；冻结包 `E:/MC/releases/paper-1.21.1-20261015`，均有F盘对应镜像。候选与影子测试快照**不替代正式发布前的新完整备份**。

## 本地验证

```powershell
python -m unittest discover -s paper/ops/tests -p test_datapack_migration.py -v
python -m unittest discover -s paper/ops/tests -p test_denizen_compat.py -v
node --test paper/ops/tests/test_legacy_item_meta.mjs
powershell.exe -NoProfile -File paper/ops/tests/test_paper_core_upgrade.ps1 -PaperJar <官方1.21.1-build133的JAR>
paper/plugins/AgentFriend/build.ps1 -ServerRoot <隔离服目录> -MinecraftVersion 1.21.1
paper/plugins/CortiEyeMirror/build.ps1 -ServerRoot <隔离服目录> -MinecraftVersion 1.21.1
```

动态迁移复用 `E:/MC/ops/yaml-check` 中的 js-yaml；登录组件/API固定摘要与测试见 [LoginGuard](../integrations/login-guard/README.md)。原生联机、冷启动和图片证据留在私有目录。
