# 原地图攻略实机检查

`ArchitectureFixture.java` 是一次性 QA 插件，不能装进正式服。仅控制台可调用，且同时核验回环地址、固定测试端口和测试目录标记。只有 `ag_ArchAlice`、`ag_ArchBob` 两个一次性角色可被操作。

当前两个隔离目录为：

- Paper：`E:/MC/staging/communication-contract-20261030`，游戏 29395、RCON 29396。
- Youer：`E:/MC/staging/aincrad-architecture-youer-20261030`，游戏 29397、RCON 29398。

目录须有 `.communication-qa`，内容分别为 `127.0.0.1:29395 20261030`、`127.0.0.1:29397 20261030`。世界必须是独立物理副本，不能联接正式存档。修改本地路径时，应一起修改并审查这些精确门禁，不能改成接受任意目录或端口。

准备 Java 21、Mineflayer、mineflayer-pathfinder、真实地图副本，以及当前 AF、Vortex、RPG 桥和 MythicMobs。编译夹具时使用对应服务端依赖，并将 `DungeonMapArchitectureTest.class` **仅加入 QA 的 AgentFriend JAR**，让九个规则检查在真实方块注册表和正确插件类加载器中执行。正式 JAR 不含测试类。

夹具声明：`name: ArchitectureFixture`，`main: org.qdqa.ArchitectureFixture`，`api-version: '1.21'`，`softdepend: [AgentFriend, QiandengjiRpg]`，命令 `qd_arch_fixture`。端口、世界、当前配置及 `.communication-qa` 校验通过后运行客户端脚本：

```powershell
node paper/probe/aincrad-architecture/architecture.mjs E:/MC/ops/repairs/aincrad-architecture-20261030-r1/run-本次唯一目录
```

Youer 测试额外将环境变量 `QD_ARCH_QA_STAGE` 设置为上述专用 Youer 目录。当前 Youer 使用其配套 `QiandengjiMaidBridge` 保持 Paper 自定义数据包的原始字节；不能只换核心而漏掉这个已有兼容层。独立 QA 采用自己的世界目录，不装生产迁移专用的 `PaperWorldLayoutBridge`，避免它因缺少本机迁移账本停止测试服。

输出目录保存 `result.json`。检查实际地板、各段安全刷怪点、普通客户端不挖不搭的全程导航、Vortex 任务和剧情说明、默认短文本路线、弓手实际射箭、六段配怪与 AI、白天防晒、首领低血量换剑，以及完整参与后的真实结算。当前箭矢统计只在 QA 夹具内监听，不给正式服增加轮询。

夹具的 `position`、`recover`、`strike`、`clear` 用于机制检查；它们不能证明真实玩家的装备平衡或挑战难度。`clear` 只处理本场追踪的敌人，没有世界范围实体扫描。路线段使用真实客户端物理与碰撞；不得把夹具传送写成客户端走通。

结束后正常 `stop`，核验测试插件和临时配置已撤回、原 QA JAR 已恢复，保留失败日志。正式服 JAR 摘要应始终保持不变。更多内容见[关卡说明](../../docs/AINCRAD_ARCHITECTURE_20261030.md)。
