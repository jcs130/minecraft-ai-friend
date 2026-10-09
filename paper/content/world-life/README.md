# 世界生活配置模板

这是 Paper 1.20.6 的 0.4.0 村庄生活季初始内容，完整用法、版本、验收和回退见 [玩法说明](../../docs/WORLD_LIFE_PLUGINS.md) 与 [固定清单](../../manifests/world-life-plugins.lock.json)。

- 只部署到首次安装的新插件目录；不要覆盖既有玩家照片、任务数据库或 NPC 管理数据。
- NPCSpeak `config.yml` 的 `RENDER_FROM_PRIVATE_ADAPTER_CONFIG` 是占位符。发布时从主机私有适配器配置渲染，两个令牌须一致，实值不进 Git。
- NPCSpeak 人物不携带隔离实体 UUID，正式服启动时生成新实体；其他三个服务 NPC 是本包新建的固定内容定义。
- 预留空的上游 WorldEvents、ConditionalEvents 和 MythicMobs 示例文件，防止缺失后重新生成默认活动或替换原版怪物。
- ImageFrame 配置没有隔离图片 HTTP 地址；测试照片、图片缓存、数据库、玩家账本、世界和第三方 JAR 不在本目录。
- ImageFrame 内置截图上传监听当前 LAN `192.168.3.163:8517`；移植服务器时一并调整 `DisplayURL` 和 `WebServer.Host`，不将离线 Java 后端或上传入口盲目开放公网。使用见[截图相册](../../docs/SCREENSHOT_PHOTOS.md)。

本季设计与九张可热更新居民事务见[村庄生活季](../../docs/VILLAGE_LIFE_SEASON.md)。事务定义和入口分别在AgentFriend资源中的 `resident-contracts.yml`、`world-life.yml`，部署到运行插件目录后可独立热加载。Shopkeepers的save.yml是首次安装种子；已有服务器发布要按UUID合并新增商人、保留所有现有商店及原生物品元数据，不能整体覆盖运行存档。
