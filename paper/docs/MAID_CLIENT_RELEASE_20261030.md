# 原生女仆客户端下载已发布

2026-10-30，服主批准“现在发布官网下载”后，官网在当前 **0.8.32** 上发布客户端资源 **1.0.0-20261030**。本次只正常停启官网；游戏服、登录代理和观战源没有重启。

## 玩家安装

[官网下载页](https://mc.kangqiang.site/downloads.html#maid-client)提供两种方式：

| 下载 | 用途 | 大小 |
| --- | --- | --- |
| [启动器导入包](https://mc.kangqiang.site/downloads/maid-client) | 在支持 Modrinth 的启动器导入，按清单下载官方模组 | 11,580 字节；模组另下载约 24.4 MB |
| [手动安装包](https://mc.kangqiang.site/downloads/maid-mods) | 新建实例，安装 NeoForge，再将 `mods/` 中的女仆放入实例 | 30,295,566 字节 |

配套 **Minecraft 1.21.1、Java 21、NeoForge 21.1.248、Touhou Little Maid 1.5.3**。原版 Java、现有 Fabric、Mineflayer 和基岩版仍可进服；只在需要原生女仆模型和界面时新建这个可选实例。不要混装 Fabric 与 NeoForge 模组。

手动包中的 `loader/` 是官方安装器，不要放入 `mods/`。包内包含中文说明、完整摘要和原许可，不包含账号、密码、Key、存档、测试控制器、服务端改版或 Minecraft 本体。YSM、Numen 和语音是独立可选客户端功能，须选对应加载器版本。

进服后 Agent 使用 `/qdmaid help` 查询现役服务器实际支持的本人操作，不需要 OP。现役桥仍 **0.1.4**；已预置的 **0.1.5** 需要另一次获准的安全重启，不能把本次网站发布当成它已经加载。公共 Skill 1.3.4 没有替换，不声称默认包已带 `mc_maids`。

## 实际发布和验证

两个包及官方模组、安装器共四个对象使用固定 SHA256 路径上传专用 OSS，逐个匿名完整下载校验。官网固定链接由原下载处理器返回 307 和校验响应头，文件由 OSS 分发，保留原每分钟 20 次的下载限频。

本轮原先在 0.8.31 准备候选，发现并行任务已发布 SAO 兼容及账号入口后，重新以实际 0.8.32 镜像做增量构建。运行文件只变化 `public/downloads.html`、`src/download-catalog.mjs`、`src/maid-client-downloads.json`；配置只启用两项已核定下载。没有用旧源码整树覆盖新站。

- 隔离 Linux HTTP 验收 **28 项通过**，不挂生产数据；原下载限频另有明确 20 次成功、第 21 次拒绝回归。
- 公网 1440px 桌面和 390px 手机页面、两个固定链接和 OSS 200、文件大小与摘要头通过，无横向溢出；保留 SAO 入口。
- 原 10 项下载、冻结 Skill、注册与账号设置、观战挂载及容器运行限制保持。
- **20 类账号及内容表原记录保持**；当前 0.8.32 一致在线网站备份在 E/F 两盘校验，切换时另作云端冷数据库副本。这不是游戏服冷备。
- 临时单文件只读传输授权已撤销；私人备份、日志和凭据没有进入公开包或 Git。

原生女仆兼容范围和仍待验收内容见[兼容说明](../integrations/touhou-maids/README.md)，四个对象摘要见[客户端清单](../integrations/touhou-maids/client-release.json)，实际状态见[发布清单](../manifests/maid-client-downloads-20261030.json)。本批六段原图副本仍是[未部署候选](AINCRAD_ARCHITECTURE_20261030.md)，不与网站发布混淆。
