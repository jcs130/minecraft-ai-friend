# Better Combat、桐人剑技与原版表现

2026-11-17。已完成官方资料、源码检查与真实隔离登录/原始粒子包验证。**没有向正式服安装 Better Combat，没有发布新的剑技。** 正式服继续保持原接入方式。

## 选择结论

Better Combat 适合作为武器连段和 Java 动作的增强层。桐人的技能资格、资源消耗、冷却和命中结果仍由现有 Vortex/居民执行端管理；普通 Java、Mineflayer、Numen/女仆身体和基岩入口都应能调用相同剑技。不能把“装了 Better Combat”当作已经实现星爆气流斩，也不能让不同表现路径各扣一次魔力、各造成一次伤害。

已核对的 1.21.1 NeoForge 文件：

| 组件 | 版本 | 用途/当前状态 |
| --- | --- | --- |
| Better Combat | 2.4.0+1.21.1 | 武器组合攻击、交替双持、前摇、攻击范围/动画；下载校验与隔离启动通过 |
| Player Animator | 2.0.4+1.21.1-forge | 发布元数据包含 NeoForge；与 Better Combat 一同启动通过 |
| Cloth Config | 15.0.140+neoforge | 配置依赖；一同启动通过 |
| Better Mob Combat: Reimagined | 1.1.22 | 把武器连段带给生物的候选；本轮仅元数据及源码审查，未安装测试 |

[Better Combat 官方版本](https://modrinth.com/mod/better-combat/version/VhIOvcXP)及[源码](https://github.com/ZsoltMolnarrr/BetterCombat/tree/e4a6a4a2ae109045d7a1eae334728bd726c305ea)说明武器属性可以通过 JSON 数据文件扩展，包括连续攻击、双持条件、范围、伤害倍率和动作。它提供战斗框架，不附送桐人职业、学习树或命名剑技。

## 已实测的接入限制

使用全新、仅监听环回地址的 Youer 1.21.1 世界；只复制已有隔离服的核心与依赖库，未复制正式世界、账号、居民、插件数据库或模型。两个阶段复用同一个未修改 Mineflayer 1.21.1 客户端：

1. 基础核心无 Better Combat：成功进入世界，收到 `crit`、`end_rod`、`sweep_attack`、`dust` 四种原版粒子包，以及 `minecraft:entity.player.attack.sweep` 声音包。彩色尘埃的颜色和大小原始字段可读取。
2. 添加 Better Combat 与两项依赖：服务端正常启动，但客户端在进入世界前被踢，提示需要安装 NeoForge 21.1.252；`spawned=false`。没有假装确认模组握手或修改校验。
3. 两次测试服务器均以退出码 0 正常存档关闭；正式服没有重启或改 JAR。

这证明默认安装不能直接保留原版协议接入；**不是“兼容验收通过”**。本轮未让真人模组客户端、Geyser 或公网登录代理进入这个隔离服，不能声称这些路径已经通过或已发生故障。[原始包与检查证据](../manifests/better-combat-compatibility-20261117.json)

源码原因也明确：NeoForge `NetworkEvents` 用非 optional 的 `PayloadRegistrar` 登记频道，并要求配置同步与武器表同步的 ACK。`CombatFlags` 可以按玩家关闭战斗，但不取消这段登录契约。把未实现的协议直接标记“支持”会让后续攻击、组件或动画仍然失配。

因此，正式接入需要一个真正的可选能力分支：未安装端走现有普通协议与服务端剑技；支持端完成明确的版本/能力协商，再使用 Better Combat 动作。具体适配仍待实现与联机验证，不能只改 TOML 或放宽权限就发布。

## 女仆、YSM 与双持

[Better Mob Combat: Reimagined](https://github.com/Bandit-bytes/Better-Mob-Combat-Reimagined/tree/f6c3167635dbb0e03eacef67485ecbc6384151eb)能为生物提供武器动作、攻击时机、范围与目标上限。它仍有必需的客户端频道，且我们女仆的特殊 AI、双手物品、同行关系、领地与 Vortex 伤害必须逐项联测。其一般敌我识别不能替代本服的队伍/领地权限。

[YSM 官方说明](https://github.com/YesSteveModel/YSM-Wiki-Issues/blob/main/docs/en/notes/wiki/Introduction.md)已有 Better Combat 支持；[2.6.0 更新说明](https://modrinth.com/mod/yes-steve-model/version/2.6.0-fabric%2Bmc1.20.1)介绍 `ctrl.bcombat_attack_animation`，供动画控制器读取招式，并说明还需区分主副手。该说明不是本次 NeoForge 桐人模型已验收的证明。模型没有对应动画时，不会凭空得到十六段专属动作；加密模型也不能当作可随意编辑的源文件。

旧版 Better Mob Combat 的[女仆副手物品丢失报告](https://github.com/Thelnfamous1/Better-Mob-Combat/issues/52)针对 1.20.1/其他版本，不能据此认定当前 1.21.1 分支仍有同一故障。它提供了必须回归的场景：主副手切换、背包数量、死亡/停止、重启恢复，以及是否出现重复攻击或物品复制。

## 原版和基岩可以呈现什么

原版 Java 不需要 Better Combat 即可显示服务器发送的粒子与声音，本轮已在实际网络包验证；未进行真实窗口逐帧或耳听验收。可以用原版彩色尘埃、暴击、末地烛等粒子沿计算出的弧线/交叉线排列，表达剑光、命中与收招。它们不能改变原版人物骨骼，使其自动播放模组的完整双剑动作。

[Geyser 官方粒子映射](https://github.com/GeyserMC/mappings/blob/master/particles.json)中 `crit`、`end_rod` 有基岩粒子映射，`dust` 由内置转换处理；`sweep_attack` 映射到 `geyseropt:sweep_attack`，需要对应资源。扫击贴图来自 [GeyserIntegratedPack](https://github.com/GeyserMC/GeyserIntegratedPack/blob/master/developer_documentation.md)。所以基岩基础剑光不能只依赖 sweep_attack；先用映射已明确的粒子，附加扫击效果再核对正式包和客户端下载结果。本轮没有基岩真机显示验收。

拟定表现，不代表已上线：

| 剑技阶段 | 通用表现 | 支持模组的 Java 增强 |
| --- | --- | --- |
| 二刀交替普通连击 | 交替的短蓝白剑弧；命中火花仅跟实际命中 | 两手交替挥砍，匹配前摇/收招 |
| 水平方阵斩 | 前方水平剑光按连段展开，范围与判定一致 | 对应连续横斩动画 |
| 星爆气流斩 | 交错蓝白斩痕、分段剑鸣和收招效果 | 由支持的桐人模型展示完整双剑连段 |
| 被打断/目标丢失 | 停止后续效果并返回实际已完成部分 | 及时停止对应动作，不继续播放假命中 |

粒子生成必须有每次施法/每 tick/每观察者预算和距离裁剪；声音合并，避免每个粒子都发一个声效。只向能力兼容的连接发送增强数据；Mineflayer 与 NPC 读取原始技能回执、目标绝对坐标和剩余冷却，不需要根据视觉猜命中。

后续必须先完成服务端剑士技能闭环，再分别验收原版表现、可选 Better Combat 协议、女仆双持与 YSM、基岩资源包。当前阻止直接安装的原因是已经实测的协议要求，不是额外的用户审批要求。
