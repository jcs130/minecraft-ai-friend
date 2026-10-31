# 千灯纪原生冒险与新版外观：隔离候选

2026-10-31。**正式服未安装本批新增模组，官网客户端未更新，没有新增公网入口。**

后续 Agent 接入已单独完成隔离验收：Mineflayer 握手桥 + 原生 SDK，以及服务端 Numen 身体都实际完成移动、个人箱取物、魂符召唤女仆和铁木剑攻击。接入说明与边界见 [AGENT_ACCESS.md](AGENT_ACCESS.md)，最新事实见 [agent-acceptance.json](agent-acceptance.json)；下方原 [acceptance.json](acceptance.json) 保留前一阶段“普通 Mineflayer 直连被拒”的历史，不是新桥接入口的状态。正式发布仍未就绪。

本轮在新建的回环测试世界验证暮色森林、Lootr、YSM 和 Better Combat。使用正式服同字节的 Youer 核心、原生平台适配模组及女仆服务端改版；没有复制正式世界、玩家数据库、登录凭据、女神配置或全部 54 个插件。原生测试客户端使用原作者发行文件，不安装服务端改版。

## 锁定的发行文件

完整来源、大小、SHA256、SHA512 见 [artifacts.lock.json](artifacts.lock.json)。

| 内容 | Minecraft 1.21.1 候选 | 用途 |
| --- | --- | --- |
| 暮色森林 | 4.8.3345 / NeoForge | 独立冒险维度、遗迹、Boss 进度 |
| Lootr | 1.11.38.127 / NeoForge | 带战利品表的探索箱按玩家分配物品 |
| Yes Steve Model | 2.6.5 / NeoForge | 原生人物与女仆模型、动画 |
| Touhou Little Maid | 1.5.3 / NeoForge | 当前对应版本的官方最新正式版；不是新换一个更高版本 |
| Better Combat | 2.4.0 / NeoForge | 原生近战输入、连击、武器动作 |
| Cloth Config | 15.0.140 / NeoForge | Better Combat 依赖 |
| playerAnimator | 2.0.4 / Forge、NeoForge | 上游发布类型为 **Beta**，不能标成正式版 |

服务端为 Youer 1.21.1-e3158632 / NeoForge 21.1.252；实际原生客户端为 NeoForge 21.1.248 / Java 21。暮色要求 NeoForge ≥21.1.209，Lootr 要求 ≥21.1.195。不能将 Forge 1.20.1 的 SAO 运行树直接换成这批 JAR。

## 已测到什么

固定的事实和边界见 [acceptance.json](acceptance.json)。详细原始回执、正常退出记录、失败尝试、截图及测试世界保存在本机 `E:/MC/research/twilight-lootr-20261031`。这些是本轮新世界的证据，不是正式世界的冷备。

- 两个真实原生客户端分别右键同一个 Lootr 箱，执行实际窗口 Shift-click，各拿到 2 绿宝石和 3 面包；不是控制台分别发奖。服务端保存的两个玩家背包和同一 Lootr 容器内的两个 UUID 库存已分别核对。
- 加入新版外观和战斗模组、正常重启后，原账号再次右键该箱仍为空，背包奖励保留，没有重发。
- 实际进入 `twilightforest:twilight_forest`，客户端识别暮色群系、鹿、大角绵羊、鸟和兔的原生实体及渲染器。这里的跨维度传送是测试布景，不是已经验收的生存门户或公会任务。
- 原生 Better Combat 配置和武器注册表完成同步；通过攻击按键命中训练尸壳，客户端与服务端实读生命变化一致。训练怪关闭 AI，本项不证明正常敌人 AI、Boss 通关或 Agent 自主战斗。
- 原生 YSM 客户端能显示其人物模型。用户提供的大肥鱼已从实际原生目录取得完整 ID `大肥鱼_1.1.ysm`，完成单模型授权、分配和原生截图核对；同一身体继续按键攻击，服务端生命变化一致。不解密，该文件不进入 Git 或客户端包。初次猜测短名被拒绝的记录保留，不把重载开始当作已经换模。

本轮未验证全部正式插件、Vortex 伤害叠加、公会结算、暮色 Boss 奖励箱、全部配方、CortiEye、远端正版登录、手机或 Xbox。不能把原生 Java 结果换算成这些路径已经通过。

结束时隔离 JVM 已正常退出 0，两个测试账号的临时管理员权限清空，测试强制加载区块解除。最后只读检查主服核心和原两项模组摘要与开始前一致，Java 状态及基岩 Pong 都正常；这些入口检查不是新增模组的基岩验收。没有正式维护、旧请求重放、路由器或防火墙变更。

## 为什么暂不装进主服

普通 Mineflayer 在本候选上实际收到“需要 NeoForge”的拒绝。Lootr 注册必需通道；Better Combat 2.4.0 也注册必需通道和配置阶段确认。仅声明握手成功，不会自动补出物品组件、模组菜单、实体或攻击输入。

| 接入方式 | 本轮状态 | 发布前所需工作 |
| --- | --- | --- |
| 完整 NeoForge Java | 已完成下列具体操作；仍为隔离测试 | 全插件及正常游玩回归 |
| 原版/Fabric Java | 普通协议被拒绝 | 保留原接入，或另做经过验证的兼容入口 |
| 普通 Mineflayer | 直接接入被拒绝 | 对接真实注册表、组件、容器和战斗操作；不猜测投影物品身份 |
| 基岩 | 本候选未验收 | 原连接、资源包、动态实体、菜单和交互逐项适配 |
| CortiEye/Web | 本候选未验收 | 观察身份、模型分发及画面验证 |

现役模型代理、原模型目录、基岩/Web 映射与原生 YSM 是一条完整链路。不能只升级一端，也不能让两个实现同时争用同一个角色的模型控制权。Better Combat 的按玩家禁用 API 可作为兼容设计参考，但它不消除必需通道；本轮没有靠关闭校验或伪造命中来声称兼容。

按服主本轮要求，不满足现有 Agent/基岩条件时继续在独立测试服推进，主服保留当前玩法。隔离候选不接入公开注册、正式账号或网站下载目录。

## 配置与撤回边界

本轮只在私有测试树应用以下设置：

- Lootr `whitelist.dimension_whitelist = ["twilightforest:twilight_forest"]`，使将来的候选只转换新维度中的探索箱。
- `conversion.bypass_spawn_protection = false`，`breaking.disable_break = true`，保留假玩家不能随意拆 Lootr 箱的原规则。
- 暮色 `"Portal Settings".destructivePortalLightning = false`；新玩家仍出生主世界，进度限制不关闭。
- Better Combat `server_target_range_validation = true`；不开放隔墙攻击，不降低冷却或碰撞门槛。

两人宝箱用的是人工放置的确定性测试箱，不能冒称证明了所有自然结构的自动转换。个人奖励箱、共享补给箱和手工放好物品的箱子不迁移。暮色 Boss 掉落箱能否得到独立战利品另验；Lootr 不保证转换手工填物品、没有战利品表的容器。

**Lootr 转换不是简单可逆的配置。** 它的原方块与 `world/data/lootr`、玩家背包、世界必须一起留存。不能直接卸载后假定箱子和物品仍在，也不能用旧玩家数据覆盖新进度。正式部署前应完成当时的完整双盘冷备、验证已有玩家/箱子不变、准备与当前进度相容的迁移或回退；本轮没有进行正式迁移。

## 客户端候选构建

```text
python paper/integrations/native-adventure/build_client_pack.py --downloads <已下载且按锁核验的原始JAR目录> --output <新文件.mrpack>
python -m unittest discover -s paper/integrations/native-adventure/tests -v
```

构建器只读取七份锁定 JAR 验证摘要，包内仅有 `.mrpack` 下载索引和中文说明，从原作者公开链接下载；不扫描和打包目录内其他文件。服务端改版、QA 模组、账号、Key、存档和用户 `.ysm` 都不进入包。产物只标记为隔离候选，不自动上传或发布。

实际原生测试客户端的七份内容摘要已与候选索引逐项对照。此证明不等于已经在另一台启动器完成全新导入和联网下载。

[qa/NativeTwilightQa.java](qa/NativeTwilightQa.java) 是本轮原生回归夹具。它只允许指定回环端口和两个测试身份，使用真实右键、菜单点击与攻击按键，退出时释放攻击键。测试装备、地面、训练怪和模型授权由单独的私有布景回执记录；夹具不进入面向玩家的分发包，也没有启动 LLM 或替代用户的 Agent loop。

## Agent 网关准备

服务端加完所有候选组件、正常启动后，由维护者在空测试服控制台执行一次 `maw_registry dumpids`。导出来自当前 JVM；不能拿旧 Tau 注册表替代。准备工具只创建新的代码、注册表和回环启动清单，不启动进程、不开放端口：

```text
node paper/integrations/native-adventure/prepare_agent_gateway.cjs <当前导出目录> <既有冻结网关模板> <全新输出目录> <当前JVM_PID> 39771 39761
```

它核对当前 NeoForge 21.1.252、PID、10 分钟新鲜度、通道声明及导出一致性，为实际当前注册表生成映射和摘要。宿主启动前还须核对自己持有的 JVM 回执与 `launch.json`，监督器负责所有权、终态、停止及重启；模板依赖应保存在正式运行的冻结发布目录中，不能随清理旧实验世界一起删除。兼容载体映射不成为 Agent 的真实物品或碰撞证据，SDK 保留原生数据。

本轮最终 75 项离线检查通过，独立 SDK 分发包真实解包消费者接入通过；两个 Java 客户端分别在不装/安装原始 Numen 时完成个人箱回归。有 Numen 的客户端实际观察到外观“穿上→脱下→穿上”，未安装的连接不接收该可选附件且保持在线。最后四人背包及同箱四 UUID 独立库存经过正常停服冷盘核对；隔离 JVM 退出 0，主服仍在线、原核心/两模组摘要保持。训练怪 NoAI、脚本验收不是模型自主生存或完整 Boss 战证明。原 Java 未安装 Numen 时的附件注册表拒绝、首版观察夹具收尾计时错误及纠正回执均保留。
