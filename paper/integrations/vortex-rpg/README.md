# VortexRPG原生接管

本目录是API适配和窄补丁。**2026-10-28已发布**AgentFriend0.4.47.22、VortexRPG1.2.2-alpha-qd27和QiandengjiRpg0.2.1（[引导修复](../../docs/RPG_GUIDANCE_20261028.md)）；[发布与回滚](../../docs/NATIVE_RPG_RELEASE_20261027.md)、[固定摘要清单](../../manifests/native-rpg-release-20261027.json)为当前状态。较早[集成记录](../../docs/VORTEX_MMO_INTEGRATION.md)保留调查历史。

后续 `.24 / RPG 0.2.3 / qd29` 是**未部署候选**：帮助统一、任务分页、原生组队与明确失败指引，补齐坦克实际防御及空目标攻击退款。构建与验收范围见 [RPG 可用性](../../docs/RPG_USABILITY_20261028.md)，不覆盖原玩家配置或迁移存档。`patch-cast-targets.py` 只接受固定 qd28 输入，改空目标分支，复用原生失败退款和清冷却；`self/ray/location` 目标类型不改变。`FortifyDefence` 在原生 fortify 成功回调补抗性I，耗魔、冷却和原恢复效果仍归 Vortex 管理。

服主明确改用原生六职业，旧职业归档。接管停止旧职业写入及旧战斗成长，保留地图活动、救援、证书和只读归档，通用效果复用既有实现；[接管与实测](TAKEOVER.md)区分最终验证与较早独立预览记录。不能直接部署含其他候选的完整AgentFriend0.4.48。

`patch-vortex.py`要求固定摘要的1.21.1兼容JAR、固定上游源码及 `--vault <官方Vault.jar>`；保留其他条目，输出到隔离目录。`build.py`只构建本仓库桥，要求新输出；不重建或复制正式服。所有输入使用参数传入；本机回环探针有固定隔离目录和端口门禁，不应对公网服运行。

`build-takeover.py`是Windows/JDK21的窄构建入口，使用固定AgentFriend0.4.47.20基包，保留528个无关条目，只编译本轮所属类。基包摘要在脚本和发布清单中固定；它不是第三方Vortex包。上游Vortex、Vault及场景资源须按各自许可自行取得，本仓库不分发这些第三方JAR或地图。

正式接管沿用 `/mycli status|profession|skills|cast|tasks`；原交易、地图、个人箱、照片等入口继续保留。早期 `rpg status` 是兼容别名；独立预览里的shop/town不是新的默认命令。原生职业选择与学习等待保存回执；未完成目标不能领奖。公开列表和资料不代表商店或设施已开业。

`survey-city.py`只读原地图，`resources/city-facilities.yml`是七处实际建筑空间的拟用清单。`surveyed_not_operating`不表示已有NPC、交易库存或传送解锁。

真实测试入口为 `probe/prepare.py`、`probe/run.py`。测试生成自己的数据库、Floodgate密钥及玩家，只接受本机标记场地；不复制生产账号、私密配置或玩家物品。纯规则入口为 `tests/run.py`，第三方JAR自行从官方取得，仓库不分发。
