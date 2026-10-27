# Agent 兼容反作弊候选

2026-10-27：已在回环隔离服验证，**未部署正式服**。当前正式实体防透视继续由 AgentVision0.1.2执行，见[抓包验收](../../docs/AGENT_VISION.md)。本目录不提供玩家或 `ag_` 账号的反作弊全免权限。

## 选择及实际策略

核对了 [Grim 安装要求](https://github.com/GrimAnticheat/Grim#requirements--installation)、[Geyser 兼容列表](https://geysermc.org/wiki/geyser/anticheat-compatibility/)和 [LAC 官方 FAQ/API](https://github.com/tiredvekster/LightAntiCheat/blob/main/F-A-Q.md)。现役 ViaVersion 位于登录/模型代理及 Paper，Grim 明确不支持代理上的 ViaVersion，因此未移动认证和模型链路来迁就它。

候选为官方 LightAntiCheat **1.2.6** 加一处可复现的缓降修复 **1.2.6-qd1**，以及自有 `QiandengjiAntiCheat0.1.0`。这不代表 LAC 是当前持续维护最活跃的项目；选择以实测兼容和保守上线为前提。

- 开启46项检测，关闭11项针对自动点击、自动整理等本服允许行为的检测。
- 只对已实测的三项非法飞行检测开启纠正；其他开启项先记录。关闭自动踢人、封禁、公开告警、Discord及统计上传。检测不等于所有检测都在惩罚。
- 不按用户名、OP、品牌、UUID前缀免检。Java/Mineflayer保留物理检测；Bedrock只使用真实 Floodgate API 识别，不信名称前缀。
- 只有实际加载的 `NumenPlayer` 原生身体属于服务端控制，无外部移动数据流。识别来自安装 API 的真实类加载器，不接受客户端自报。
- 合法法术的远程伤害按**这一次 Bukkit 伤害事件**授权，不开放“施法后若干秒内所有攻击免检”。来源必须是已装可信插件的真实类加载器及包；原伤害类型、护甲和保护规则保持。

## 修复及证据

官方 FlightA 把缓降读成了跳跃效果，导致战士8格跃高后的合法下降误报。`PatchSlowFalling.java`只更正 `onAsyncMovement` 内第一个字段引用，第二个真正的跳跃读数保持。`patch-lac.py`固定官方SHA512，除该class及版本外所有原条目保持；不从未发布的1.2.7源码重建整插件。

LAC在 `HIGHEST` 消费违规事件。桥在同优先级取消会晚于已注册的内部处理器；现在使用 `LOWEST`，且配置必须开启 LAC API，先取消这次可信法术误报。

最终现役AgentFriend0.4.47.18隔离连接 **17项通过**：真实8格跃高/缓降、闪现、限时御空/到期、效率V挖掘、三次10格外法术、真实Numen身体判别、普通Mineflayer不豁免。合法阶段无新增告警；随后同一客户端伪造向上移动，实际触发Flight告警和位置纠正，连接保持。该纠正拒绝了一步非法移动，不夸称每种外挂都能瞬间拉回地面。

早期失败仍保留：跃高误报、远程技能Reach误报、测试区无地面、隔离服原 `allow-flight=false` 的原版踢人，以及将0.32格真实纠正错当成必须超过2格的夹具断言。隔离服现在匹配正式 `allow-flight=true`；这不赋予普通玩家 `allowFlight`。既有隔离保护掩码/结构缺失及旧Mineflayer组件警告未计作修复完成。

## 构建及部署

从[官方发布](https://cdn.modrinth.com/data/9cgarzL8/versions/3P6al9ug/LightAntiCheat-1.2.6.jar)自行取得JAR。`prepare.py --jar <官方包> --output <新目录>`生成策略；`patch-lac.py --base <官方包> --server <只读依赖目录> --output <新JAR> --javac <JDK21编译器>`制作窄补丁；`build.py --server <依赖目录> --lac <补丁包> --output <新桥接包>`构建桥。测试夹具使用 `--fixture`，只接受回环25924，绝不能部署正式服。

LightAntiCheat及其修改适用AGPL-3.0；仓库只放补丁构建逻辑，不打包第三方二进制。生产需当次批准、通知、真人/副本检查、正常停启和E/F完整冷备份，禁止热载。候选清单不是备份完成标记。

回退同样正常停服，移走两个新增JAR并恢复原配置前像；不回滚世界、账号、背包或职业。不要为了回退放宽登录、给所有Agent OP，或关闭已生效的实体过滤。
