# 艾恩葛朗特第一层隔离验收

这是维护者的本机测试工具，不是部署器。固定测试根`E:/MC/staging/aincrad-conquest-20261027`，只监听`127.0.0.1:25924/25925`。不得把测试fixture放进正式服；它会拒绝其他地址和端口。

先阅读`prepare_aincrad.py`中固定输入、地图SHA和白名单，再准备全新目录；已有目录拒绝覆盖。原始地图只读保留，不分发世界、第三方插件、账号库或密钥。Java21、PyYAML、Mineflayer测试依赖需按本机路径配置。

```text
python paper/probe/conquest-stage/run_aincrad.py --jar AgentFriend-0.4.47.18.jar --client paper/probe/conquest-stage/aincrad_client.mjs --label soloeasy123
python paper/probe/conquest-stage/run_aincrad.py --jar AgentFriend-0.4.47.18.jar --client paper/probe/conquest-stage/aincrad_client.mjs --label coldsolo123
python paper/probe/conquest-stage/run_aincrad.py --jar AgentFriend-0.4.47.18.jar --client paper/probe/conquest-stage/rescue_client.mjs --label rescue123
python paper/probe/conquest-stage/run_aincrad.py --jar AgentFriend-0.4.47.18.jar --client paper/probe/conquest-stage/strike_client.mjs --label strike123
python paper/probe/conquest-stage/run_aincrad.py --jar AgentFriend-0.4.47.18.jar --client paper/probe/conquest-stage/tank_client.mjs --label skills123
node paper/probe/conquest-stage/portal_receipts.mjs
```

标签必须唯一且仅含字母数字，避免覆盖旧证据。冷启动用相同数字的角色，必须接在真实通关且正常stop之后，不能单独在空服运行。只允许一份显式选择的AgentFriend JAR；默认参数仍支持历史0.4.48，不能把该整包直接发布到正式服。

`soloeasy*`明确采用现役地图Easy；`solo*`采用Normal。两者只给初始铁装/食物/魔力，之后用真实移动、攻击、持盾、食物、自愈与自然恢复，记录死亡、重试、实际成功剑技和最终回执。Normal一级失败必须保留。`party*`是另外一条带后台恢复的机制验证，不能称为无辅助通关或自主模型测试。

救援夹具只注入一笔真实可取消致命伤并冻结敌人，靠近/中断/清场救起和全队倒下均由正式实现处理；不写复活或通关状态。技能测试核对实际掉血、保护拒绝和费用，受击间隔不清零。坦克与救援伤害夹具让怪物确实以受击者为目标后注入一次打击，再恢复原目标；WorldGuard会把Creature当前目标作为间接来源，先前“目标是队友却强行打另一个人”被当成PvP是夹具错误，不能通过放宽保护掩盖。具体行为见[WorldGuard固定源码](https://github.com/EngineHub/WorldGuard/blob/7.0.12/worldguard-bukkit/src/main/java/com/sk89q/worldguard/bukkit/cause/Cause.java#L308)。

fixture不授予通关或修改生产；它只在QA平地铺测试平台，在原始艾恩葛朗特地图的核查地点战斗。测试僵尸戴铁头盔防日晒，退出时清除本次夹具实体。守卫观察器只读，不替换/重排伤害监听器。

驱动记录JAR摘要、客户端退出码和协议警告，结束正常`stop`。失败返回非零，日志保留。复制旧掩码产生的拒绝、客户端组件解析警告不能算完整兼容通过；实际玩法通过不等于全服或长期自主模型已验。

最小发布包构建器在`paper/plugins/AgentFriend/scripts/BuildConquestRelease.java`，Java21+ASM9.7.1编译后传入：固定0.4.47.17原JAR、完整编译JAR、该编译JAR的SHA256、全新输出路径。它核对原包摘要与双向内部成员引用，保留未参与依赖闭包的公会/领地/照片类，只替换四份评审过的默认资源。运行配置须另行合并，不能用JAR默认资源覆盖生产玩家配置。
