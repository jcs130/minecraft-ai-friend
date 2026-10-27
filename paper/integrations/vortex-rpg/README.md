# VortexRPG独立候选

本目录是API适配和窄补丁，**不代表正式服已安装Vortex**。现状、修复、原生联机证据、许可和迁移门槛见[集成记录](../../docs/VORTEX_MMO_INTEGRATION.md)。

`patch-vortex.py`要求固定摘要的1.21.1兼容JAR与固定上游源码；保留其他条目，输出到隔离目录。`build.py`只构建本仓库桥，不重建或复制正式服。所有输入使用参数传入；本机回环探针有固定隔离目录和端口门禁，不应对公网服运行。

`BridgeRules`沿用现有 `/mycli status|profession|skills|cast|tasks|trade|waypoint`，早期rpg路径仅兼容。原生职业选择与学习等待保存回执；未完成目标不能领奖；原版村民商店报价可由Java、Mineflayer和Geyser使用，无客户端模组要求。

`survey-city.py`只读原地图，`resources/city-facilities.yml`是七处实际建筑空间的拟用清单。`surveyed_not_operating`不表示已有NPC、交易库存或传送解锁。

真实测试入口为 `probe/prepare.py`、`probe/run.py`。测试生成自己的数据库、Floodgate密钥及玩家，只接受本机标记场地；不复制生产账号、私密配置或玩家物品。纯规则入口为 `tests/run.py`，第三方JAR自行从官方取得，仓库不分发。
