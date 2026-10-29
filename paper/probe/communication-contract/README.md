# CLI生命周期和聊天事实的隔离验收

这两个文件只用于可丢弃的 Paper 1.21.1 QA，不是生产插件。Java夹具明确拒绝非 `127.0.0.1:29395` 的服务器；测试会修改测试世界、三个QA角色的物品、怪物和任务，绝不能放入正式服。

`CommunicationFixture.java` 提供可观测的真实状态；`client.mjs` 使用三个普通非OP Mineflayer角色验证命令和实际效果，不调用模型。客户端中的依赖、RCON、场地和输出路径属于本次本机QA，需要按自己的隔离环境修改；不能把生产RCON配置传进去。客户端默认每个角色至少间隔1250ms发命令，服务器原spam限制保持。

验收顺序：

1. 用JDK21完整编译AgentFriend和RPG桥，保留正在使用的依赖摘要；AgentFriend构建包括SkinsRestorer API。
2. 建立新的回环Paper实例，随机生成只属于QA的RCON凭据。启用Essentials/EssentialsChat、Vortex qd29、Vault及所需现役依赖；不复制生产玩家、认证或模型Key。
3. 将夹具编译成独立JAR，main为 `org.qdqa.CommunicationFixture`，声明仅QA命令 `qd_comm_fixture`，softdepend为 EssentialsChat、QiandengjiRpg、AgentFriend。
4. 原生模式运行 `client.mjs <私有输出目录> vortex`。正常 `stop` 后再启动，运行 `cold`，核对放弃任务的持久记录与activeCount。
5. `language` 模式不使用会话内反射替换消息，验证原生中文目录路径 `plugins/Essentials/messages/messages_zh.properties`、生效locale和无人接收提示。
6. 正常停机后，在QA切换旧后端并移出Vortex/RPG桥JAR，再跑 `legacy`；不允许在运行中卸载、替换JAR或调用全服 `/reload`。

纯规则测试入口为 Vortex 的 `RulesTest`、`RpgFailureTest`、`QuestTextTest`，以及AgentFriend的 `AgentCommunicationContractTest`、`DungeonExitAdviceTest`。本批共102项；真实联机结果和候选摘要见 [候选说明](../../docs/CLI_TASK_LIFECYCLE_20261030.md) 与固定清单。

测试明确区分发送、收包和实际状态变化：验证真实饱食、造物、星芒箭伤害；放弃任务前后库存/余额保持；错误命令不传送、不扣魔；同XYZ跨世界不算附近，@不扩大范围，原版私聊不广播。native权限提供器可能与单个Bukkit节点观测不同，不能用后者承诺送达。本场未安装LuckPerms，生产权限组合仍须发布后复核。

本次私有驱动、世界、凭据和原始日志不随源码提交。失败记录保留，包括初始反射方法名、语言文件位置、过快指令和英文反馈匹配错误；不能将这些夹具错误称为生产故障。正常停机后的QA数据也不能复制回生产。

活动批次另用`RpgActivitiesFixture.java`和`rpg-activities-client.mjs`，相同回环门禁。装入候选AF.32/桥.12/原生qd30和本批配置；先`flow`，正常停止重启后`cold`，二者使用同一个新输出目录，以native-before-cold.json核对真实职业、等级、经验、技能点和已准备技能。夹具只创建两个一次性房间，使用实际出怪和攻击回调；敌人冻结/位移不等于自主战斗平衡。还验证真实迎新加载器、3个WorldEvents集结和全部18项目录，说明见[RPG活动](../../docs/RPG_ACTIVITIES_20261030.md)。
