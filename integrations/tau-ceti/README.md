# Tau Ceti ATM / Aincrad 公测

**当前部署及客户端安装以 [PUBLIC_BETA.md](PUBLIC_BETA.md) 为准。** 2026-10-27 的公测配置使用独立的新世界，保留机械动力、殖民地、农夫乐事、女仆等内容。服主明确允许测试期游戏内注册和密码登录，不以尚未发布的网站入口阻塞这次测试。只有实际联机和公网探测通过后，发布清单才能标记已开放。

下面保留早期隔离阶段的排错依据，端口、473 个 JAR、未切换自启动及网站准入等描述均属于历史，不能代替当前发布状态。Paper 千灯纪及其独立 Aincrad 地图属于另一实例。

## 早期隔离记录（历史）

## 真人客户端

真人完整游玩需要 Java 整合包客户端，通过启动器导入 [TauCeti-ATM10-1.3.2](https://www.curseforge.com/minecraft/modpacks/tau-ceti-atm/files/8462075) 即可。Minecraft 1.21.1、NeoForge **21.1.234**，作者 manifest 建议 16 GiB 内存。创建独立实例，保留原有游戏配置和微软登录。

服务端使用作者的 [TauCeti-ServerPack-1.3.3](https://www.curseforge.com/minecraft/modpacks/tau-ceti-atm/files/8462642)。已逐项核对：客户端 494 个下载条目中的 462 个共同模组与服务器完全同版本，没有共同模组版本差异；剩余 32 个是客户端额外条目。服务端原包另附 5 个 JAR，共 467 个，集成后增加 6 个登录和 Agent 组件，共 473 个。

下载包的服务器列表预设指向作者社区，配置自己的实例时需改成自己的服务器地址，不要据此误连作者服务器。原版 Java 客户端、网页画面和基岩资源包不能替代完整 Java 整合包。

当前下载校验：

| 文件 | SHA-256 |
| --- | --- |
| TauCeti-ServerPack-1.3.3.zip | `754e32da8639f0f65202d0e6e03d168bb36d979d81cdeeade37a96ca929d4429` |
| TauCeti-ATM10-CF-1.3.2.zip | `a91acb175bf67ab9deae8ce91ab7716e90d983808dd4c2fbaadc9a5d1ac4080f` |

## 接入分工

| 入口 | 身体与能力 | 当前边界 |
| --- | --- | --- |
| Java 整合包 | 真正的 NeoForge 客户端；使用原模组界面和内容 | 隔离服务端已启动；真人登录仍需联机验收 |
| Mineflayer 网关 | 自己登录的玩家；接收本人数据及原始包扩展 | v11 已在隔离网关真实登录、收到区块与原始数据；完整模组操作和网页渲染未验收；旧 FOM 注册表不能复用 |
| Numen 私有 SDK | 服务端持久化身体；外部控制器拥有独占动作租约 | 已完成同 UUID 重启恢复、真实走动、终态及同 action_id 去重；原生能力 20 组、模组专用接口 35 项；具体玩法仍须逐项验收 |
| 基岩桥 | Geyser 与匹配资源/模型适配 | Tau 尚未验收，不能因为 FOM 曾可用就标为可用 |

规划、模型、人设与长期记忆由自研核心或用户自己的运行时管理。Numen 和 Mineflayer 是不同身体入口，不能让两个控制器同时派发同一身体的动作。GUI 不是 Agent 施法的前提：Numen `operations`、`mod_operations` 可查询具体参数与实际返回，Iron 法术接口使用角色真实装备、魔力和冷却，不通过管理员命令伪造成功。

没有安装的模组能力必须返回缺失，不能把 FOM 的女仆或旧 `/mycli` RPG 功能说成已自动迁移。当前 Tau 的女仆接口和 Numen 原生视觉接口尚不可用；原始 Mineflayer 包扩展与真正渲染素材也不是同一验收项。

## 维护结构

候选：`E:/MC/research/tau-replacement-20261026/server`；正式目标：`E:/MC/servers/tau-ceti-1.3.3/server`。原 `E:/MC/servers/fom-2.42` 保留。已正常停机的旧 FOM 整服 ZIP 共 2239 个文件，E/F 双盘内容与 SHA 校验一致，旧存档不直接塞入不同整合包的新世界。

正式计划沿用 Java TCP 28976、Mineflayer TCP 28977、基岩 UDP 28988。Numen TCP 28989 与健康端口 TCP 28985 仅绑定回环，不开放公网。候选游戏/网关/健康分别使用回环 39476/39477/39485。不能把旧 FOM 自启动与 Tau 同时注册来争抢端口。

`tau_service.py` 复用本项目 `experiment/agent-society-1.21.1` 分支的 `tools/maw_service.py`，目前构建源提交为 `78ec7abb4745f0f5e4a840af03a2fbe3166265cc`。发布时将该固定版本的 supervisor 同置于 ops，保留其单实例锁、自己创建的子进程、stdin 正常停服、请求 ID 账本及回环健康接口。不会按进程名杀 Java，也不会接管端口上碰巧存在的进程。

配置明确写入 serverDir、runtimeDir、gamePort、healthPort、java、maxMemoryMiB、publicGameAccess、modsManifest；网关额外配置 agentGateway.releaseDir、port、publicGameAccess。所有模组及网关文件都锁定哈希，新版本创建新目录。只运行 `run` 不会清除维护暂停，须明确执行 `resume`。

运行命令：`python tau_service.py plan|run|status|pause|resume|stop|shutdown --config service.json`。`console` 只将有界命令送入自己拥有的 stdin；回执 `deliveryKnown=true,resultKnown=false` 不是世界效果成功，必须再核对实际结果。`status` 的过期心跳不能算健康。

原 FOM 的 HKCU Run、自启动控制入口和公网路由必须在正式验收后统一切换；目前没有修改这些入口。也没有改变 Paper、路由器或其他服务的端口。

## 本次实际修复

1. **加载器组合**：使用旧 FOM 的 NeoForge 21.1.250 会产生方块注册错误；作者指定的 21.1.234 已成功启动并正常保存退出。不任意升级加载器。
2. **自己的插件重新编译**：`build_addons.py` 对固定源提交的登录、Numen 可选客户端、常驻宿主及原生玩法组件，使用 Tau 的实际 MC/NeoForge API 编译。只调整自己组件的依赖下限，官方 Numen 与 MixAuth JAR 字节不变；输出逐文件构建记录。
3. **FTB 任务接口**：实际 JVM 检查确认 FTB 2101.1.27 的 GUI 标题方法会在专用服务端被移除，Numen 的旧调用导致登录阶段异常。兼容组件覆盖任务、章节、任务项和奖励的旧标题调用，读取真正保存在服务器的原始标题；没有标题时用对象类型和实际 ID，避免虚构名称。保留原任务事件、权限和奖励逻辑。最初仅调用反射的修复不够，曾出现 AbstractMethodError；最终读取原始标题的补丁已通过新账号实际登录，完整任务书与提交奖励仍待验收。
4. **大注册表**：实际 block-states.jsonl 为 761,463,742 字节，超过 V8 单字符串上限。`build_gateway.py` 对固定快照应用分段 JSONL 读取及分段哈希。精确匹配 26,401 个原版状态；另外 716 个扩展属性状态明确列为无法原版精确表达，保留原始 ID/属性，不冒充精确原版状态。旧协议投影与原始渲染数据各有明确范围。
5. **语言文件**：两份模组语言数据分别使用注释/尾逗号和字符串内控制字符；解析器按游戏接受的等价格式读取并记录正规化方式，不改写原资源。需要 Python `json5` 作为构建依赖，不在游戏 tick 中解析。
6. **实际通道**：AE2 原生注册了合法的空路径 `ae2:`，原网关错误拒绝。现在仍以完整服务端导出为依据，接受该资源路径格式，保留重复项、非法字符和未知加载器版本检查。也修正自己注册表导出器写死旧 NeoForge 版本的字段，使用实际编译目标 21.1.234。
7. **每次启动的注册表**：实测同一模组集在不同 JVM 启动间有 336 个物品 ID 改变，主要来自自动生成的 Botany Pots 内容。静态版本锁不能代替本次运行的映射。`live_registry.py` 在自己拥有的 JVM 就绪后只请求一次只读导出，等待新的完成标记及匹配 PID，再由独立进程建立本次启动的冻结映射；准备成功前网关不启动。旧快照、其他 PID 或准备失败保持关闭。物品显示标记按完整名称保留，不随数字 ID 变动，原始状态表也使用本次导出。
8. **原生实体和物品协议**：按实际安装的 Easy NPC 7.1.1、Apotheosis 8.5.4 / Placebo 9.9.1、Corail Tombstone 9.5.1 的 StreamCodec 补齐 NPC 元数据、装备词缀与墓碑物品组件。模组 JAR 哈希写入构建契约，未经审查的新字节不能静默沿用旧解码器。保留原始字段与未知组件拒绝逻辑，不跳过未知长度的数据来制造登录成功。特别是 NPC 经验是固定 INT、墓碑模型颜色是固定 SHORT，不能误用 VarInt。

部署时还要将 `live_registry.py`、`prepare_live_registry.cjs` 和 `gateway-overrides/bounded-jsonl.cjs` 与 supervisor 同置于 ops。快照写入 `runtime/registries/<PID>-<generation>`，不覆盖运行中的注册表，也不把旧 JVM 的缓存带入新 JVM。注册表导出约 27 秒，在开放网关之前完成；不是每个玩家登录都重新导出。动态原始注册表还需与网页素材解析器、基岩桥的实际资源版本衔接，不能声称完整视觉已经同步。

## 已核对的 SDK 回执

`claim_control` 的租约位于 `lease.leaseId`；调用参数写 `lease_id`。Lua 动作用 `action_id`，受理回执为 `phase=accepted`；同 ID 查询 `action_status`，终态为 `phase=terminal`，结果在 `outcome.status` 与 `outcome.receipt`，不能把顶层 `ok=true` 当成已经走到目标。位置以 `get_state.position` 的实际小数值为准，不从文字提示的四舍五入坐标推断。

真实测试身体从 `(24.5,113,72.5)` 行走到 `(25.57,113,72.5)`，路径为一步 WALK，挖掘/放置都为 0，库存两本模组书不变。终态成功后以相同动作 ID 和相同代码再次提交，返回原指纹/终态，实际坐标没有再次变化，身体数量仍为 1。没有把 HTTP 请求返回成功或动作受理当成目标完成。

原包还存在自身的配方/战利品警告；启动日志的 `Done` 不代表所有内容都已验收。不能把 100 阶段塔进度说成已验证的 100 张独立楼层地图。

## 隔离登录实测与当前缺口

2026-10-27，v11 临时网关按当前 JVM 的注册表接入，普通离线测试账号实际进入原作者出生大厅 `(24.5,113,72.5)`，生命 20，两个初始物品槽保留，并收到 13,288 条原生数据帧。前一候选的 NPC 元数据、Apotheosis 词缀、墓碑颜色组件错误均未再次出现。临时网关按自身 stdin 正常退出，退出码 0；这次短时登录不是长期稳定性或完整模组玩法的验收。

原版 Mineflayer 的 `bot.entities` 不会自动拥有所有模组实体，须走原生实体查询；初始模组书在原版投影中仍显示 paper，尚未证明网页真实图标/模型完成。Tau 本身没有旧 Paper 的 `/mycli` 技能体系，不能把其返回未知命令当作已迁移。基岩入口仍未准备。

后续以 v11 重新启动隔离 supervisor，当前 JVM 注册表已自动重建，语音 UDP 已实际确认仅监听回环。经 supervisor 的复测收到 6,230 条原生帧、9 个区块并进入出生点，随后收到 `gateway maintenance`：网关按正常退出码 0 被重建，Java 进程保持。触发瞬间的依赖就绪错误尚未捕获，不能把自动恢复误报为持续联机成功；后续须记录完整探针时序并解决该中断，再做持续游戏验收。临时网关短时成功与正式监护链稳定是不同结论。

当前 MixAuth 与旧 FOM 首次访客策略允许尚未设密码的账号进服。这与后续要求的“先在网站注册”尚不一致，因此隔离端口继续只绑定回环，不切换公网。网站账号、Token 与游戏准入必须一起核对。隔离实例语音独立绑定 `127.0.0.1:39489/UDP`，不借用正式端口；Numen 的 `28989/TCP` 仍是回环 SDK，协议不同。

## 回归与发布门槛

`python -m unittest discover -s integrations/tau-ceti -p 'test_*.py'`

`node --test integrations/tau-ceti/gateway-overrides/bounded-jsonl.test.cjs`

原生协议检查需将 `NODE_PATH` 指向构建依赖，`TAU_GATE_TEST_SOURCE` 指向准备好的快照中 `world/src/neoforge-handshake`，再运行 `easynpc-wire.test.cjs`、`apotheosis-wire.test.cjs`、`tombstone-wire.test.cjs`；覆盖原始字节、后继字段边界、截断、未知组件及集合预算。另有 `live-registry.test.cjs` 和 `test_live_registry.py` 验证重启 ID 重排、PID/完成标记与启动门禁。

另需：原有状态映射/原始包回归、真实登录及密码重登、Numen 原 UUID 恢复与 action_id 对账、短距移动终态与位置核对、实际法术/容器操作、Mineflayer 原始状态及断线处理。基岩模型/菜单和完整网页材质未实测前单独标明。网站注册与 Token 的准入策略也需和入口实际策略一致。

只提交源码、构建规则与文档；ZIP、JAR、世界、账户数据库、模型密钥和私有验收日志不提交 Git。
