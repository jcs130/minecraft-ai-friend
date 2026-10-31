# 独立源码构建入口

完整说明：[从公开源码自行部署](../../docs/SELF_HOSTING.md)。

- `doctor`：检查 JDK 21 和公开依赖锁。
- `prepare --directory <新目录> --accept-eula`：仅在明确接受 EULA 后，下载校验独立依赖并准备 Paper 编译输入。离线后端默认仅本机、RCON 关闭；不自动启动游戏。
- `build --directory <上述目录> --output <新目录>`：编译 AgentFriend/CortiEyeMirror，包含自研许可证和 SQLite 自身声明；不读取家服目录。
- `export-portal --directory <自己的游戏目录> --output <新目录>`：导出固定的公开正式网站源码，写入无密的本机配置。

`--jdk` 可显式选择 JDK；`--port` 可选择隔离端口。原目录、错误校验的 JAR 和已有构建输出不自动覆盖。

依赖锁包含源码实际调用的 TAB 6.2.1 与 SkinsRestorer 15.12.6 API，使用官方固定发布文件并校验摘要；不以删除外观/榜单功能来绕过编译。Skill 固定包从公开 OSS 镜像下载并校验，已有版本不覆盖，新说明使用新的版本与内容摘要。

构建源码候选不等于复刻现役包。固定地图布局、账号桥、公网认证、基岩、YSM、模型与运营服务需独立配置；缺少 23 村屋/WorldGuard 场景时不会造假通过。所有密码、Key、数据库及玩家数据留在部署者自己的私有目录。
