# VortexRPG原生接管

2026-10-30 04:48已发布AF.32/桥0.2.12/原生qd30；试炼/集结及原生进服资料见[说明](../../docs/RPG_ACTIVITIES_20261030.md)。qd30的`build-profile-readiness.py`必须接在累计qd29后，固定摘要、只修改一个类并加入有界进服调度；防止角色卡加载及未加载占位资料在关服覆盖存档。JDK21由`--java-home`、JAVA_HOME或PATH提供。ProfileJoinDispatchTest、ProfileLoadingSaveTest和真实Paper冷启动覆盖此路径。两个原稳定JAR文件名继续保留，真实构建与摘要以部署清单为准；下方qd29段落是历史。

本目录是API适配和窄补丁。**2026-10-29已发布**AgentFriend0.4.47.30、VortexRPG qd29、QiandengjiRpg0.2.10；职业实际配置说明、直接远程储物和遗迹存档点见[本轮发布](../../docs/RPG_INTERACTION_20261029.md)，准确版本看[实际部署清单](../../manifests/current-deployment.json)。较早[基础生存修复](../../docs/BASIC_SURVIVAL_RELEASE_20261028.md)、[迁移发布](../../docs/NATIVE_RPG_RELEASE_20261027.md)和[集成记录](../../docs/VORTEX_MMO_INTEGRATION.md)保留各自时点。

**0.2.10已发布：**`status/intro`及原生队伍返回实际世界名称、key、Bukkit UUID与坐标；同世界才计算距离，离线不复用旧位置。只扩充查询，未新建队伍或成长系统。官方EssentialsXChat与本桥组合34项联机、248项原生离线检查通过，正式26项及4项云端观战核对通过；见[插件复用方案](../../docs/PAPER_PLUGIN_REUSE_20261029.md)。`build-location-release.py`仅在固定0.2.9基包上编译三个所属类，保留25个其他条目，资源与账号数据不从QA复制。

此前 `.26 / RPG0.2.5` 的指引已合入正式 `.27 / 桥0.2.6`，并完成[RPG金币与技能统一](../../docs/RPG_UNIFIED_20261028.md)：`intro/status` 以真实生存、装备和任务给一个当前目标，任务列表/详情分清本人状态，`trade wallet` 查任务金币。已在隔离服复现原生拍卖扣款不交货，当前版本明确拒绝新增拍卖操作，不能宣传拍卖交付已修复。构建和验收范围见 [RPG 可用性](../../docs/RPG_USABILITY_20261028.md)，旧余额经停服双盘核验后1:1迁入金币，其他存档保留；不新增Agent循环或模型调用。

`patch-cast-targets.py` 的 qd29 修复已上线，固定 qd28 输入且只改空目标分支；骑士 fortify 的抗性由 `FortifyDefence` 在原生成功回调处理。基础通用技能由既有实现执行，不要求选职或学习；Vortex继续管理职业成长与魔力。

服主明确改用原生六职业，旧职业归档。接管停止旧职业写入及旧战斗成长，保留地图活动、救援、证书和只读归档，通用效果复用既有实现；[接管与实测](TAKEOVER.md)区分最终验证与较早独立预览记录。不能直接部署含其他候选的完整AgentFriend0.4.48。

`patch-vortex.py`要求固定摘要的1.21.1兼容JAR、固定上游源码及 `--vault <官方Vault.jar>`；保留其他条目，输出到隔离目录。`build.py`只构建本仓库桥，要求新输出；不重建或复制正式服。所有输入使用参数传入；本机回环探针有固定隔离目录和端口门禁，不应对公网服运行。

`build-takeover.py`是Windows/JDK21的窄构建入口，使用固定AgentFriend0.4.47.20基包，保留528个无关条目，只编译本轮所属类。基包摘要在脚本和发布清单中固定；它不是第三方Vortex包。上游Vortex、Vault及场景资源须按各自许可自行取得，本仓库不分发这些第三方JAR或地图。

正式接管沿用 `/mycli status|profession|skills|cast|tasks`；原交易、地图、个人箱、照片等入口继续保留。早期 `rpg status` 是兼容别名；独立预览里的shop/town不是新的默认命令。原生职业选择与学习等待保存回执；未完成目标不能领奖。公开列表和资料不代表商店或设施已开业。

`survey-city.py`只读原地图，`resources/city-facilities.yml`是七处实际建筑空间的拟用清单。`surveyed_not_operating`不表示已有NPC、交易库存或传送解锁。

真实测试入口为 `probe/prepare.py`、`probe/run.py`。测试生成自己的数据库、Floodgate密钥及玩家，只接受本机标记场地；不复制生产账号、私密配置或玩家物品。纯规则入口为 `tests/run.py`，第三方JAR自行从官方取得，仓库不分发。
